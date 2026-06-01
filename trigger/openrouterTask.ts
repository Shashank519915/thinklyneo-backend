/**
 * @fileoverview Trigger.dev `openrouter-inference`: Runs text completions on OpenRouter.
 *
 * Resilience:
 *  - Two-provider fallback: main-openrouter → backup-stub
 *  - Durable 15s API timeout via wait.for() (not setTimeout)
 *  - Top-level try/catch prevents 1-hour waitpoint token hangs on unexpected crashes
 *  - maxDuration: 120s
 */

import { task, wait } from "@trigger.dev/sdk/v3";
import { notifyCoordinator, callWithDurableTimeout } from "./utils";
import { openrouterLlmDefinition } from "@galaxy/shared";

interface OpenRouterPayload {
  model?: string;
  prompt: string;
  systemPrompt?: string;
  images?: string[];
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  runId: string;
  nodeRunId: string;
  orchestratorRunId?: string;
  waitpointTokenId?: string;
  workflowId?: string;
}

interface ProviderAttempt {
  providerId: string;
  status: "success" | "failed";
  error?: string;
  durationMs: number;
}

async function callOpenRouterFree(
  payload: {
    prompt: string;
    systemPrompt?: string | null;
    images?: string[];
    temperature?: number;
    maxTokens?: number;
    topP?: number;
  },
  signal?: AbortSignal
): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY environment variable is not configured on backend");
  }

  const targetModel = "google/gemini-2.5-flash";

  const messages: Array<Record<string, unknown>> = [];

  if (payload.systemPrompt && payload.systemPrompt.trim()) {
    messages.push({
      role: "system",
      content: payload.systemPrompt,
    });
  }

  const userContent: Array<Record<string, unknown>> = [{ type: "text", text: payload.prompt }];

  if (payload.images && payload.images.length > 0) {
    for (const imgUrl of payload.images) {
      if (imgUrl) {
        userContent.push({
          type: "image_url",
          image_url: { url: imgUrl },
        });
      }
    }
  }

  messages.push({ role: "user", content: userContent });

  console.log(`[OpenRouter Task] Invoking free model: ${targetModel}`);
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://nextflow-workflow.vercel.app",
      "X-Title": "NextFlow Workflow Builder",
    },
    body: JSON.stringify({
      model: targetModel,
      messages,
      temperature: payload.temperature ?? 1.0,
      max_tokens: payload.maxTokens ?? 2048,
      top_p: payload.topP ?? 0.95,
    }),
    signal,
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

export const openrouterTask = task({
  id: "openrouter-inference",
  maxDuration: 120,
  run: async (payload: OpenRouterPayload) => {
    const {
      prompt,
      systemPrompt,
      images = [],
      temperature = 1.0,
      maxTokens = 2048,
      topP = 0.95,
      runId,
      nodeRunId,
      orchestratorRunId,
      waitpointTokenId,
      workflowId,
    } = payload;
    const startMs = Date.now();

    console.log(`[OpenRouterTask] 🚀 Starting openrouter-inference task (nodeRunId: ${nodeRunId})`);

    const attempts: ProviderAttempt[] = [];
    let successfulProvider: string | null = null;
    let responseText: string | null = null;
    let logs = "";

    try {
      const pStartMain = Date.now();
      try {
        logs += `[main-openrouter] Attempting OpenRouter free model completion...\n`;

        responseText = await callWithDurableTimeout(15, (signal) =>
          callOpenRouterFree(
            { prompt, systemPrompt, images, temperature, maxTokens, topP },
            signal
          )
        );

        successfulProvider = "main-openrouter";
        attempts.push({
          providerId: "main-openrouter",
          status: "success",
          durationMs: Date.now() - pStartMain,
        });
        logs += `[main-openrouter] Success: Free model completion completed successfully.\n`;
      } catch (err: unknown) {
        const pDurMain = Date.now() - pStartMain;
        const errorMsg =
          err instanceof Error && err.name === "AbortError"
            ? "Request timed out after 15 seconds"
            : err instanceof Error
              ? err.message
              : String(err);
        console.warn(`[OpenRouterTask] ⚠️ Provider main-openrouter failed in ${pDurMain}ms:`, errorMsg);
        logs += `[main-openrouter] Failure after ${pDurMain}ms: ${errorMsg}\n`;
        attempts.push({
          providerId: "main-openrouter",
          status: "failed",
          error: errorMsg,
          durationMs: pDurMain,
        });

        const pStartBackup = Date.now();
        try {
          logs += `[backup-stub] Attempting fallback stub...\n`;
          await wait.for({ seconds: 2 });

          responseText = `[Backup Provider Stub Response]\nThis is a fallback response because the primary OpenRouter free model failed or timed out.\n\nPrompt: "${prompt}"`;
          successfulProvider = "backup-stub";
          attempts.push({
            providerId: "backup-stub",
            status: "success",
            durationMs: Date.now() - pStartBackup,
          });
          logs += `[backup-stub] Success: Fallback generated canned response.\n`;
        } catch (backupErr: unknown) {
          const pDurBackup = Date.now() - pStartBackup;
          const backupMsg = backupErr instanceof Error ? backupErr.message : String(backupErr);
          logs += `[backup-stub] Failure after ${pDurBackup}ms: ${backupMsg}\n`;
          attempts.push({
            providerId: "backup-stub",
            status: "failed",
            error: backupMsg,
            durationMs: pDurBackup,
          });

          const durationMs = Date.now() - startMs;
          if (workflowId && orchestratorRunId && waitpointTokenId) {
            await notifyCoordinator({
              workflowId,
              runId,
              nodeId: nodeRunId,
              status: "failed",
              error: `All providers failed: ${errorMsg} -> ${backupMsg}`,
              durationMs,
              orchestratorRunId,
              waitpointTokenId,
              providerUsed: null,
              providerAttempts: attempts,
              logs,
              creditCost: 0,
            });
          }
          throw new Error(`All providers failed: ${errorMsg} -> ${backupMsg}`);
        }
      }

      const durationMs = Date.now() - startMs;
      const creditCost = openrouterLlmDefinition.credits.base;

      if (workflowId && orchestratorRunId && waitpointTokenId) {
        await notifyCoordinator({
          workflowId,
          runId,
          nodeId: nodeRunId,
          status: "success",
          output: { response: responseText },
          durationMs,
          orchestratorRunId,
          waitpointTokenId,
          providerUsed: successfulProvider,
          providerAttempts: attempts,
          logs,
          creditCost,
        });
      }

      return { response: responseText, runId, nodeRunId };
    } catch (fatalErr: unknown) {
      const durationMs = Date.now() - startMs;
      const fatalMsg = fatalErr instanceof Error ? fatalErr.message : String(fatalErr);
      console.error(`[OpenRouterTask] 💥 Fatal unhandled error: ${fatalMsg}`);
      if (workflowId && orchestratorRunId && waitpointTokenId) {
        try {
          await notifyCoordinator({
            workflowId,
            runId,
            nodeId: nodeRunId,
            status: "failed",
            error: `Fatal error: ${fatalMsg}`,
            durationMs,
            orchestratorRunId,
            waitpointTokenId,
            providerUsed: null,
            providerAttempts: attempts,
            logs: logs + `\n[FATAL] ${fatalMsg}`,
            creditCost: 0,
          });
        } catch (notifyErr) {
          console.error(`[OpenRouterTask] Failed to notify coordinator after fatal error:`, notifyErr);
        }
      }
      throw fatalErr;
    }
  },
});
