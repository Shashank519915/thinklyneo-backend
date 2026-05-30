/**
 * @fileoverview Trigger.dev `kling-v3` task simulating async video generation webhook callbacks.
 */

import { task, wait, tasks } from "@trigger.dev/sdk/v3";
import { notifyCoordinator } from "./utils";
import { klingV3Definition } from "@galaxy/shared";

interface KlingV3Payload {
  prompt: string;
  inputImage?: string;
  aspectRatio?: "16:9" | "9:16" | "1:1";
  duration?: "5s" | "10s";
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

export const klingV3Task = task({
  id: "kling-v3",
  run: async (payload: KlingV3Payload) => {
    const {
      prompt,
      inputImage,
      aspectRatio = "16:9",
      duration = "5s",
      runId,
      nodeRunId,
      orchestratorRunId,
      waitpointTokenId,
      workflowId,
    } = payload;
    const startMs = Date.now();

    console.log(`[KlingV3Task] 🚀 Starting kling-v3 task (nodeRunId: ${nodeRunId})`);
    console.log(`[KlingV3Task] Prompt: "${prompt}", inputImage: "${inputImage ?? ""}", aspectRatio: ${aspectRatio}, duration: ${duration}`);

    const attempts: ProviderAttempt[] = [];
    let successfulProvider: string | null = null;
    let outputUrl: string | null = null;
    let logs = "";

    // ── Provider 1: kling-webhook (Simulated webhook wait) ───────────────────
    const pStartMain = Date.now();
    try {
      logs += `[kling-webhook] Creating waitpoint token for callback...\n`;
      
      // 1. Create a waitpoint token with a 5-minute timeout
      const token = await wait.createToken({ timeout: "5m" });
      logs += `[kling-webhook] Token created: ${token.id}. Triggering callback simulation...\n`;

      // 2. Trigger the simulate-callback task asynchronously (non-blocking)
      await tasks.trigger("simulate-callback", {
        tokenId: token.id,
        nodeType: "klingV3",
        prompt,
        delaySeconds: 12, // Wait 12 seconds to simulate remote video generation latency
      });

      // 3. Suspend current task run until the token is completed
      logs += `[kling-webhook] Task suspended. Waiting for webhook callback simulation...\n`;
      const result = await wait.forToken<{ output: string }>(token.id);

      if (!result.ok) {
        throw result.error instanceof Error ? result.error : new Error(String(result.error ?? "Waitpoint token timed out or failed"));
      }

      outputUrl = result.output.output;
      if (!outputUrl) {
        throw new Error("Callback simulation did not return an output URL");
      }

      successfulProvider = "kling-webhook";
      attempts.push({
        providerId: "kling-webhook",
        status: "success",
        durationMs: Date.now() - pStartMain,
      });
      logs += `[kling-webhook] Success: Callback resumed task. Output URL: ${outputUrl}\n`;
    } catch (err: any) {
      const pDurMain = Date.now() - pStartMain;
      console.warn(`[KlingV3Task] ⚠️ Provider kling-webhook failed in ${pDurMain}ms:`, err.message);
      logs += `[kling-webhook] Failure after ${pDurMain}ms: ${err.message}\n`;
      attempts.push({
        providerId: "kling-webhook",
        status: "failed",
        error: err.message,
        durationMs: pDurMain,
      });

      // ── Provider 2: backup-stub (Simulated backup stub) ──────────────────
      const pStartBackup = Date.now();
      try {
        logs += `[backup-stub] Attempting fallback stub...\n`;
        await wait.for({ seconds: 2 }); // Short simulated delay
        
        outputUrl = "https://images.transloadit.com/examples/vertical.mp4";
        successfulProvider = "backup-stub";
        attempts.push({
          providerId: "backup-stub",
          status: "success",
          durationMs: Date.now() - pStartBackup,
        });
        logs += `[backup-stub] Success: Fallback generated canned video URL: ${outputUrl}\n`;
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
    const creditCost = klingV3Definition.credits.base;

    // Notify the coordinator task if coordination fields are provided
    if (workflowId && orchestratorRunId && waitpointTokenId) {
      await notifyCoordinator({
        workflowId,
        runId,
        nodeId: nodeRunId,
        status: "success",
        output: { outputVideo: outputUrl }, // Matches klingV3OutputSchema (expects { outputVideo: string })
        durationMs,
        orchestratorRunId,
        waitpointTokenId,
        providerUsed: successfulProvider,
        providerAttempts: attempts,
        logs,
        creditCost,
      });
    }

    return { outputVideo: outputUrl, runId, nodeRunId };
  },
});
