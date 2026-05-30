/**
 * @fileoverview Gemini (OpenRouter LLM) inference API: triggers task on Trigger.dev with REST polling,
 * falling back to in-process OpenRouter API call when fallback is enabled.
 */

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

/**
 * `true`: if Trigger.dev does not return a result, call OpenRouter in-process (extra resilience).
 * `false` (default): strict Trigger-only — return 503 when Trigger fails or is unset.
 */
const OPENROUTER_DIRECT_FALLBACK_ENABLED = true; // Enabled for better resiliency in direct executions

const geminiSchema = z.object({
  model: z.string().default("gemini-2.5-flash"),
  prompt: z.string().min(1),
  systemPrompt: z.string().nullable().optional(),
  images: z.array(z.string()).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().min(1).optional(),
  topP: z.number().min(0).max(1).optional(),
  runId: z.string(),
  nodeRunId: z.string(),
});

export const maxDuration = 60;

async function runOpenRouterDirect(payload: {
  model: string;
  prompt: string;
  systemPrompt?: string | null;
  images?: string[];
  temperature?: number;
  maxTokens?: number;
  topP?: number;
}): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY environment variable is not configured on backend");
  }

  const model = payload.model && payload.model !== "gemini-2.5-flash"
    ? payload.model
    : "meta-llama/llama-3.1-8b-instruct:free";

  const messages: any[] = [];

  if (payload.systemPrompt && payload.systemPrompt.trim()) {
    messages.push({
      role: "system",
      content: payload.systemPrompt,
    });
  }

  const userContent: any[] = [{ type: "text", text: payload.prompt }];

  if (payload.images && payload.images.length > 0) {
    for (const imgUrl of payload.images) {
      if (imgUrl) {
        userContent.push({
          type: "image_url",
          image_url: {
            url: imgUrl,
          },
        });
      }
    }
  }

  messages.push({
    role: "user",
    content: userContent,
  });

  console.log(`[OpenRouter Route] Invoking direct completion for model: ${model}`);
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://nextflow-workflow.vercel.app",
      "X-Title": "NextFlow Workflow Builder",
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: payload.temperature ?? 1.0,
      max_tokens: payload.maxTokens ?? 2048,
      top_p: payload.topP ?? 0.95,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenRouter API error ${response.status}: ${errorText}`);
  }

  const result = await response.json();
  const choice = result.choices?.[0];
  if (!choice?.message?.content) {
    throw new Error("Empty response or unexpected format from OpenRouter API");
  }

  return choice.message.content;
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const parsed = geminiSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", issues: parsed.error.issues },
        { status: 400 }
      );
    }

    const { model, prompt, systemPrompt, images, temperature, maxTokens, topP, runId, nodeRunId } = parsed.data;

    // Try Trigger.dev first; fall back to direct call if unavailable
    const triggerKey = process.env.TRIGGER_SECRET_KEY;
    if (triggerKey) {
      const isRealtime = process.env.TRIGGER_REALTIME_EXECUTE !== "false";
      try {
        if (isRealtime) {
          // Check if this node run has already been triggered in the database
          const existingNodeRun = await prisma.nodeRun.findUnique({
            where: {
              runId_nodeId: {
                runId,
                nodeId: nodeRunId,
              },
            },
          });

          if (existingNodeRun && existingNodeRun.triggerRunId) {
            console.log(`[Gemini/OpenRouter] NodeRun already exists with triggerRunId: ${existingNodeRun.triggerRunId}. Re-generating token.`);
            const { auth: triggerAuth } = await import("@trigger.dev/sdk/v3");
            const publicAccessToken = await triggerAuth.createPublicToken({
              scopes: {
                read: {
                  runs: [existingNodeRun.triggerRunId],
                },
              },
              expirationTime: "2hr",
            });
            return NextResponse.json({
              data: {
                triggerRunId: existingNodeRun.triggerRunId,
                publicAccessToken,
              },
            });
          }

          console.log("[Gemini/OpenRouter] 🚀 Triggering task (gemini-inference) in REALTIME mode...");
          const { tasks, auth: triggerAuth } = await import("@trigger.dev/sdk/v3");
          const { geminiTask } = await import("@/trigger/geminiTask");
          const run = await tasks.trigger<typeof geminiTask>(
            "gemini-inference",
            { model, prompt, systemPrompt: systemPrompt ?? undefined, images: images ?? [], temperature: temperature ?? 1.0, maxTokens: maxTokens ?? 2048, topP: topP ?? 0.95, runId, nodeRunId }
          );
          const publicAccessToken = await triggerAuth.createPublicToken({
            scopes: {
              read: {
                runs: [run.id],
              },
            },
            expirationTime: "2hr",
          });
          return NextResponse.json({
            data: {
              triggerRunId: run.id,
              publicAccessToken,
            },
          });
        }

        console.log("[Gemini/OpenRouter] 🚀 Attempting Trigger.dev task (gemini-inference) in polling mode...");
        const { tasks } = await import("@trigger.dev/sdk/v3");
        const { geminiTask } = await import("@/trigger/geminiTask");
        const run = await tasks.trigger<typeof geminiTask>(
          "gemini-inference",
          { model, prompt, systemPrompt: systemPrompt ?? undefined, images: images ?? [], temperature: temperature ?? 1.0, maxTokens: maxTokens ?? 2048, topP: topP ?? 0.95, runId, nodeRunId }
        );
        // Poll until complete
        const apiUrl = `https://api.trigger.dev/api/v3/runs/${run.id}`;
        const headers = { Authorization: `Bearer ${triggerKey}` };
        const deadline = Date.now() + 50000; // 50s — safe under Vercel Hobby's 60s max
        let llmOutput: string | null = null;
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 2000));
          const resp = await fetch(apiUrl, { headers });
          if (!resp.ok) continue;
          const data = await resp.json() as { status: string; output?: { response?: string }; error?: { message?: string } };
          console.log(`[Gemini/OpenRouter] Run ${run.id} status: ${data.status}`);
          if (data.status === "COMPLETED") { llmOutput = data.output?.response ?? null; break; }
          if (data.status === "FAILED" || data.status === "CRASHED" || data.status === "CANCELED") {
            console.warn("[Gemini/OpenRouter] ⚠️ Task failed:", data.error?.message); break;
          }
        }
        if (llmOutput !== null) {
          console.log("[Gemini/OpenRouter] ✅ Trigger.dev task succeeded");
          return NextResponse.json({ data: { response: llmOutput } });
        }
        console.warn("[Gemini/OpenRouter] ⚠️ Task did not complete in time, falling back to direct");
      } catch (triggerErr) {
        console.warn("[Gemini/OpenRouter] ⚠️ Trigger.dev unavailable, falling back to direct call:", triggerErr);
      }
    } else {
      console.warn(
        `[Gemini/OpenRouter] No TRIGGER_SECRET_KEY — ${OPENROUTER_DIRECT_FALLBACK_ENABLED ? "will attempt direct OpenRouter call" : "direct API fallback disabled (503)"}`
      );
    }

    if (!OPENROUTER_DIRECT_FALLBACK_ENABLED) {
      return NextResponse.json(
        {
          error:
            "Trigger task did not return a result and direct API fallback is disabled.",
        },
        { status: 503 }
      );
    }

    // Direct OpenRouter call (fallback or when Trigger.dev is not configured)
    console.log("[Gemini/OpenRouter] 🔧 Using DIRECT fallback — calling OpenRouter API directly");
    const response = await runOpenRouterDirect({ model, prompt, systemPrompt, images, temperature, maxTokens, topP });
    console.log("[Gemini/OpenRouter] ✅ Direct OpenRouter call succeeded");
    return NextResponse.json({ data: { response } });

  } catch (error) {
    console.error("POST /api/execute/gemini error:", error);
    const message = error instanceof Error ? error.message : "OpenRouter execution failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
