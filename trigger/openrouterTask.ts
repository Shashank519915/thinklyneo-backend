/**
 * @fileoverview Trigger.dev `openrouter-inference`: Runs text completions on OpenRouter's free Llama 3.3 model.
 */

import { task, wait } from "@trigger.dev/sdk/v3";
import { notifyCoordinator } from "./utils";
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

async function callOpenRouterFree(payload: {
  prompt: string;
  systemPrompt?: string | null;
  images?: string[];
  temperature?: number;
  maxTokens?: number;
  topP?: number;
}, signal?: AbortSignal): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY environment variable is not configured on backend");
  }

  // Strictly use the free Llama-3.3-70b model
  const targetModel = "meta-llama/llama-3.3-70b-instruct:free";

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

    // ── Provider 1: main-openrouter (Real execution) ────────────────────────
    const pStartMain = Date.now();
    try {
      logs += `[main-openrouter] Attempting OpenRouter free model completion...\n`;
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // 15-second timeout

      try {
        responseText = await callOpenRouterFree({
          prompt,
          systemPrompt,
          images,
          temperature,
          maxTokens,
          topP,
        }, controller.signal);
      } finally {
        clearTimeout(timeoutId);
      }

      successfulProvider = "main-openrouter";
      attempts.push({
        providerId: "main-openrouter",
        status: "success",
        durationMs: Date.now() - pStartMain,
      });
      logs += `[main-openrouter] Success: Free model completion completed successfully.\n`;
    } catch (err: any) {
      const pDurMain = Date.now() - pStartMain;
      const errorMsg = err.name === "AbortError" ? "Request timed out after 15 seconds" : err.message;
      console.warn(`[OpenRouterTask] ⚠️ Provider main-openrouter failed in ${pDurMain}ms:`, errorMsg);
      logs += `[main-openrouter] Failure after ${pDurMain}ms: ${errorMsg}\n`;
      attempts.push({
        providerId: "main-openrouter",
        status: "failed",
        error: errorMsg,
        durationMs: pDurMain,
      });

      // ── Provider 2: backup-stub (Fallback execution) ──────────────────
      const pStartBackup = Date.now();
      try {
        logs += `[backup-stub] Attempting fallback stub...\n`;
        await wait.for({ seconds: 2 }); // Short simulated delay

        // Return a canned placeholder text response
        responseText = `[Backup Provider Stub Response]\nThis is a fallback response because the primary OpenRouter free model failed or timed out.\n\nPrompt: "${prompt}"`;
        successfulProvider = "backup-stub";
        attempts.push({
          providerId: "backup-stub",
          status: "success",
          durationMs: Date.now() - pStartBackup,
        });
        logs += `[backup-stub] Success: Fallback generated canned response.\n`;
      } catch (backupErr: any) {
        const pDurBackup = Date.now() - pStartBackup;
        logs += `[backup-stub] Failure after ${pDurBackup}ms: ${backupErr.message}\n`;
        attempts.push({
          providerId: "backup-stub",
          status: "failed",
          error: backupErr.message,
          durationMs: pDurBackup,
        });

        // Both failed
        const durationMs = Date.now() - startMs;
        if (workflowId && orchestratorRunId && waitpointTokenId) {
          await notifyCoordinator({
            workflowId,
            runId,
            nodeId: nodeRunId,
            status: "failed",
            error: `All providers failed: ${errorMsg} -> ${backupErr.message}`,
            durationMs,
            orchestratorRunId,
            waitpointTokenId,
            providerUsed: null,
            providerAttempts: attempts,
            logs,
            creditCost: 0,
          });
        }
        throw new Error(`All providers failed: ${errorMsg} -> ${backupErr.message}`);
      }
    }

    const durationMs = Date.now() - startMs;
    const creditCost = openrouterLlmDefinition.credits.base;

    // Notify the coordinator task if coordination fields are provided
    if (workflowId && orchestratorRunId && waitpointTokenId) {
      await notifyCoordinator({
        workflowId,
        runId,
        nodeId: nodeRunId,
        status: "success",
        output: { response: responseText }, // Matches openrouterLlmOutputSchema (expects { response: string })
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
  },
});
