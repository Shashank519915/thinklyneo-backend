import { prisma } from "./prisma";
import { tasks } from "@trigger.dev/sdk/v3";

/**
 * Checks if the workflow run has a registered webhook endpoint and enqueues a signed SVIX payload.
 */
export async function triggerOutboundWebhook(
  runId: string,
  type: "run.started" | "run.completed" | "run.failed" | "node.completed",
  success: boolean,
  data: any,
  error: string | null = null
) {
  try {
    const run = await prisma.workflowRun.findUnique({
      where: { id: runId },
      select: {
        workflowId: true,
        workflow: {
          select: {
            webhookUrl: true,
            webhookSecret: true,
          },
        },
      },
    });

    if (!run || !run.workflow || !run.workflow.webhookUrl || !run.workflow.webhookSecret) {
      return;
    }

    await tasks.trigger("emit-webhook", {
      webhookUrl: run.workflow.webhookUrl,
      webhookSecret: run.workflow.webhookSecret,
      payload: {
        success,
        type,
        runId,
        workflowId: run.workflowId,
        data,
        error,
      },
    });
  } catch (err) {
    console.error(`[triggerOutboundWebhook] Failed to trigger emit-webhook task:`, err);
  }
}
