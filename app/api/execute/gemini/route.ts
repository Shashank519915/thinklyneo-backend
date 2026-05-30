/**
 * @fileoverview Gemini inference API: triggers `gemini-inference` on Trigger.dev with REST polling,
 * optionally falling back to in-process `@google/generative-ai` when `GEMINI_DIRECT_FALLBACK_ENABLED`.
 */

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { GoogleGenerativeAI, type Part } from "@google/generative-ai";

/**
 * `true`: if Trigger.dev does not return a result, call Gemini in-process (extra resilience).
 * `false` (default): strict Trigger-only — return 503 when Trigger fails or is unset (no direct API).
 */
const GEMINI_DIRECT_FALLBACK_ENABLED = false;

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

/** Builds multimodal parts (fetch images → base64 inlineData) + text prompt, then calls `generateContent`. */
async function runGeminiDirect(payload: {
  model: string;
  prompt: string;
  systemPrompt?: string | null;
  images?: string[];
  temperature?: number;
  maxTokens?: number;
  topP?: number;
}): Promise<string> {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const geminiModel = genAI.getGenerativeModel({
    model: payload.model ?? "gemini-2.5-flash",
    systemInstruction: payload.systemPrompt ?? undefined,
    generationConfig: {
      temperature: payload.temperature ?? 1.0,
      maxOutputTokens: payload.maxTokens ?? 2048,
      topP: payload.topP ?? 0.95,
    },
  });

  const parts: Part[] = [];

  if (payload.images && payload.images.length > 0) {
    for (const imageUrl of payload.images) {
      if (!imageUrl) continue;
      try {
        const response = await fetch(imageUrl);
        if (!response.ok) continue;
        const buffer = await response.arrayBuffer();
        const base64 = Buffer.from(buffer).toString("base64");
        const mimeType = response.headers.get("content-type") ?? "image/jpeg";
        parts.push({ inlineData: { data: base64, mimeType } });
      } catch {
        // skip failed images
      }
    }
  }

  parts.push({ text: payload.prompt });

  const result = await geminiModel.generateContent(parts);
  return result.response.text();
}

/**
 * Runs Gemini via Trigger.dev (`tasks.trigger` + poll, ~50s deadline for Vercel), else direct Gemini if fallback enabled.
 *
 * NOTE: `triggerAndWait` is unavailable from Next routes; inline polling mirrors `crop-image/route`.
 */
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

    // Try Trigger.dev first; fall back to direct Gemini call if unavailable
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
            console.log(`[Gemini] NodeRun already exists with triggerRunId: ${existingNodeRun.triggerRunId}. Re-generating token.`);
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

          console.log("[Gemini] 🚀 Triggering task (gemini-inference) in REALTIME mode...");
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

        console.log("[Gemini] 🚀 Attempting Trigger.dev task (gemini-inference) in polling mode...");
        const { tasks } = await import("@trigger.dev/sdk/v3");
        const { geminiTask } = await import("@/trigger/geminiTask");
        // trigger() + REST polling — triggerAndWait() only works inside task.run()
        const run = await tasks.trigger<typeof geminiTask>(
          "gemini-inference",
          { model, prompt, systemPrompt: systemPrompt ?? undefined, images: images ?? [], temperature: temperature ?? 1.0, maxTokens: maxTokens ?? 2048, topP: topP ?? 0.95, runId, nodeRunId }
        );
        // Poll until complete
        const apiUrl = `https://api.trigger.dev/api/v3/runs/${run.id}`;
        const headers = { Authorization: `Bearer ${triggerKey}` };
        const deadline = Date.now() + 50000; // 50s — safe under Vercel Hobby's 60s max
        let geminiOutput: string | null = null;
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 2000));
          const resp = await fetch(apiUrl, { headers });
          if (!resp.ok) continue;
          const data = await resp.json() as { status: string; output?: { response?: string }; error?: { message?: string } };
          console.log(`[Gemini] Run ${run.id} status: ${data.status}`);
          if (data.status === "COMPLETED") { geminiOutput = data.output?.response ?? null; break; }
          if (data.status === "FAILED" || data.status === "CRASHED" || data.status === "CANCELED") {
            console.warn("[Gemini] ⚠️ Task failed:", data.error?.message); break;
          }
        }
        if (geminiOutput !== null) {
          console.log("[Gemini] ✅ Trigger.dev task succeeded");
          return NextResponse.json({ data: { response: geminiOutput } });
        }
        console.warn("[Gemini] ⚠️ Task did not complete in time, falling back to direct");
      } catch (triggerErr) {
        console.warn("[Gemini] ⚠️ Trigger.dev unavailable, falling back to direct Gemini call:", triggerErr);
      }
    } else {
      console.warn(
        `[Gemini] No TRIGGER_SECRET_KEY — ${GEMINI_DIRECT_FALLBACK_ENABLED ? "will attempt direct Gemini call" : "direct API fallback disabled (503)"}`
      );
    }

    if (!GEMINI_DIRECT_FALLBACK_ENABLED) {
      return NextResponse.json(
        {
          error:
            "Gemini Trigger task did not return a result and direct API fallback is disabled.",
        },
        { status: 503 }
      );
    }

    // Direct Gemini call (fallback or when Trigger.dev is not configured)
    console.log("[Gemini] 🔧 Using DIRECT fallback — calling Google Gemini API directly");
    const response = await runGeminiDirect({ model, prompt, systemPrompt, images, temperature, maxTokens, topP });
    console.log("[Gemini] ✅ Direct Gemini call succeeded");
    return NextResponse.json({ data: { response } });

  } catch (error) {
    console.error("POST /api/execute/gemini error:", error);
    const message = error instanceof Error ? error.message : "Gemini execution failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
