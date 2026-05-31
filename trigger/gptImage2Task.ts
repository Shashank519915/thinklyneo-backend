/**
 * @fileoverview Trigger.dev `gpt-image-2` task simulating async image generation webhook callbacks.
 */

import { task, wait, tasks } from "@trigger.dev/sdk/v3";
import { notifyCoordinator } from "./utils";
import { gptImage2Definition } from "@galaxy/shared";

interface GptImage2Payload {
  prompt: string;
  negativePrompt?: string;
  aspectRatio?: "1:1" | "16:9" | "9:16";
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

export const gptImage2Task = task({
  id: "gpt-image-2",
  run: async (payload: GptImage2Payload) => {
    const {
      prompt,
      negativePrompt,
      aspectRatio = "1:1",
      runId,
      nodeRunId,
      orchestratorRunId,
      waitpointTokenId,
      workflowId,
    } = payload;
    const startMs = Date.now();

    console.log(`[GptImage2Task] 🚀 Starting gpt-image-2 task (nodeRunId: ${nodeRunId})`);
    console.log(`[GptImage2Task] Prompt: "${prompt}", negativePrompt: "${negativePrompt ?? ""}", aspectRatio: ${aspectRatio}`);

    const attempts: ProviderAttempt[] = [];
    let successfulProvider: string | null = null;
    let outputUrl: string | null = null;
    let logs = "";

    // ── Provider 1: gpt-image-webhook (Simulated webhook wait) ───────────────
    const pStartMain = Date.now();
    try {
      logs += `[gpt-image-webhook] Creating waitpoint token for callback...\n`;
      
      // 1. Create a waitpoint token with a 5-minute timeout
      const token = await wait.createToken({ timeout: "5m" });
      logs += `[gpt-image-webhook] Token created: ${token.id}. Triggering callback simulation...\n`;

      // 2. Trigger the simulate-callback task asynchronously (non-blocking)
      await tasks.trigger("simulate-callback", {
        tokenId: token.id,
        nodeType: "gptImage2",
        prompt,
        delaySeconds: 10, // Wait 10 seconds to simulate remote API latency
      });

      // 3. Suspend current task run until the token is completed
      logs += `[gpt-image-webhook] Task suspended. Waiting for webhook callback simulation...\n`;
      const result = await wait.forToken<{ output: string }>(token.id);

      if (!result.ok) {
        throw result.error instanceof Error ? result.error : new Error(String(result.error ?? "Waitpoint token timed out or failed"));
      }

      outputUrl = result.output.output;
      if (!outputUrl) {
        throw new Error("Callback simulation did not return an output URL");
      }

      successfulProvider = "gpt-image-webhook";
      attempts.push({
        providerId: "gpt-image-webhook",
        status: "success",
        durationMs: Date.now() - pStartMain,
      });
      logs += `[gpt-image-webhook] Success: Callback resumed task. Output URL: ${outputUrl}\n`;
    } catch (err: any) {
      const pDurMain = Date.now() - pStartMain;
      console.warn(`[GptImage2Task] ⚠️ Provider gpt-image-webhook failed in ${pDurMain}ms:`, err.message);
      logs += `[gpt-image-webhook] Failure after ${pDurMain}ms: ${err.message}\n`;
      attempts.push({
        providerId: "gpt-image-webhook",
        status: "failed",
        error: err.message,
        durationMs: pDurMain,
      });

      // ── Provider 2: backup-stub (Simulated backup stub) ──────────────────
      const pStartBackup = Date.now();
      try {
        logs += `[backup-stub] Attempting fallback stub...\n`;
        await wait.for({ seconds: 2 }); // Short simulated delay
        
        outputUrl = "https://images.transloadit.com/examples/landscape.jpg";
        successfulProvider = "backup-stub";
        attempts.push({
          providerId: "backup-stub",
          status: "success",
          durationMs: Date.now() - pStartBackup,
        });
        logs += `[backup-stub] Success: Fallback generated canned image URL: ${outputUrl}\n`;
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
            error: `All providers failed: ${err.message} -> ${backupErr.message}`,
            durationMs,
            orchestratorRunId,
            waitpointTokenId,
            providerUsed: null,
            providerAttempts: attempts,
            logs,
            creditCost: 0,
          });
        }
        throw new Error(`All providers failed: ${err.message} -> ${backupErr.message}`);
      }
    }

    const durationMs = Date.now() - startMs;
    const creditCost = gptImage2Definition.credits.base;

    // Notify the coordinator task if coordination fields are provided
    if (workflowId && orchestratorRunId && waitpointTokenId) {
      await notifyCoordinator({
        workflowId,
        runId,
        nodeId: nodeRunId,
        status: "success",
        output: { result: outputUrl }, // Matches gptImage2OutputSchema (expects { result: string })
        durationMs,
        orchestratorRunId,
        waitpointTokenId,
        providerUsed: successfulProvider,
        providerAttempts: attempts,
        logs,
        creditCost,
      });
    }

    return { result: outputUrl, runId, nodeRunId };
  },
});
