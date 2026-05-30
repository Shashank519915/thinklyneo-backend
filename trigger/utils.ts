import { tasks } from "@trigger.dev/sdk/v3";
import { prisma } from "../lib/prisma";
import { Prisma } from "@prisma/client";

interface NotifyCoordinatorParams {
  workflowId: string;
  runId: string;
  nodeId: string;
  status: "success" | "failed";
  output?: any;
  error?: string;
  durationMs: number;
  orchestratorRunId: string;
  waitpointTokenId: string;
}

/**
 * Persists the subtask's terminal state (success or failure) to the NodeRun database record
 * and triggers the workflow-orchestrator in coordination mode via non-blocking trigger.
 */
export async function notifyCoordinator(params: NotifyCoordinatorParams) {
  const {
    workflowId,
    runId,
    nodeId,
    status,
    output,
    error,
    durationMs,
    orchestratorRunId,
    waitpointTokenId,
  } = params;

  const now = new Date();

  try {
    // 1. Update the database NodeRun record
    await prisma.nodeRun.update({
      where: {
        runId_nodeId: {
          runId,
          nodeId,
        },
      },
      data: {
        status,
        finishedAt: now,
        durationMs,
        output: (output ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        error: error ?? null,
      },
    });
  } catch (dbErr) {
    console.error(`[notifyCoordinator] Failed to update NodeRun DB record for node ${nodeId}:`, dbErr);
  }

  // 2. Trigger the workflow-orchestrator in coordinator mode (by string ID to prevent circular imports)
  await tasks.trigger("workflow-orchestrator", {
    workflowId,
    runId,
    nodeCompleted: nodeId,
    orchestratorRunId,
    waitpointTokenId,
  });
}
