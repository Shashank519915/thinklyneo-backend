import { task, logger } from "@trigger.dev/sdk/v3";
import crypto from "crypto";

interface EmitWebhookPayload {
  webhookUrl: string;
  webhookSecret: string;
  payload: {
    success: boolean;
    type: "run.started" | "run.completed" | "run.failed" | "node.completed";
    runId: string;
    workflowId: string;
    data: any;
    error: string | null;
  };
}

/**
 * Trigger.dev task to emit signed outbound webhooks.
 * Implements Svix signature calculations and automatic exponential backoff retries.
 */
export const emitWebhookTask = task({
  id: "emit-webhook",
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 5000,
    maxTimeoutInMs: 60000,
    factor: 2,
  },
  run: async (payload: EmitWebhookPayload) => {
    const { webhookUrl, webhookSecret, payload: webhookBody } = payload;

    logger.info(`[emitWebhookTask] Dispatching event '${webhookBody.type}' for run '${webhookBody.runId}' to URL: ${webhookUrl}`);

    const msgId = `msg_${crypto.randomBytes(8).toString("hex")}`;
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const serializedBody = JSON.stringify(webhookBody);

    // Compute SVIX HMAC-SHA256 signature
    const signatureContent = `${msgId}.${timestamp}.${serializedBody}`;
    const signature = crypto
      .createHmac("sha256", webhookSecret)
      .update(signatureContent)
      .digest("base64");

    try {
      const resp = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "svix-id": msgId,
          "svix-timestamp": timestamp,
          "svix-signature": `v1,${signature}`,
        },
        body: serializedBody,
      });

      if (!resp.ok) {
        throw new Error(`Endpoint returned status ${resp.status}`);
      }

      logger.info(`[emitWebhookTask] Webhook delivered successfully. Status: ${resp.status}`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error(`[emitWebhookTask] Webhook delivery failed: ${errorMsg}`);
      // Re-throw to trigger task retry
      throw err;
    }
  },
});
