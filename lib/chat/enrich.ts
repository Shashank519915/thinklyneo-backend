import { prisma } from "@/lib/prisma";
import { getOrCreateBalance } from "@/lib/credits";
import type { Chat } from "@prisma/client";

export type ChatEnrichment = {
  workflowSummary: {
    id: string;
    name: string;
    nodeCount: number;
    executableTypes: string[];
    edgeCount: number;
    updatedAt: Date;
  } | null;
  activeRun: {
    orchestratorRunId: string;
    workflowRunId: string;
    workflowId: string;
    status: string;
  } | null;
  creditBalanceMicro: number;
};

export async function enrichChatDetail(chat: Chat, userId: string): Promise<ChatEnrichment> {
  let workflowSummary: ChatEnrichment["workflowSummary"] = null;

  if (chat.workflowId) {
    const wf = await prisma.workflow.findFirst({
      where: { id: chat.workflowId, userId },
    });
    if (wf) {
      const nodes = (wf.nodes as Array<{ type?: string }>) ?? [];
      const edges = (wf.edges as unknown[]) ?? [];
      const executableTypes = [
        ...new Set(
          nodes
            .map((n) => n.type)
            .filter((t): t is string => Boolean(t) && t !== "requestInputs" && t !== "response"),
        ),
      ];
      workflowSummary = {
        id: wf.id,
        name: wf.name,
        nodeCount: nodes.length,
        executableTypes,
        edgeCount: edges.length,
        updatedAt: wf.updatedAt,
      };
    }
  }

  let activeRun: ChatEnrichment["activeRun"] = null;
  const lastRunMsg = await prisma.message.findFirst({
    where: { chatId: chat.id, orchestratorRunId: { not: null } },
    orderBy: { createdAt: "desc" },
  });

  if (lastRunMsg?.orchestratorRunId) {
    const run = await prisma.workflowRun.findFirst({
      where: {
        orchestratorRunId: lastRunMsg.orchestratorRunId,
        userId,
      },
    });
    if (run && run.status === "running") {
      activeRun = {
        orchestratorRunId: run.orchestratorRunId!,
        workflowRunId: run.id,
        workflowId: run.workflowId,
        status: run.status,
      };
    }
  }

  const creditBalanceMicro = await getOrCreateBalance(userId);

  return { workflowSummary, activeRun, creditBalanceMicro };
}

/** Compact workflow graph summary for Brain context after canvas edits. */
export function formatWorkflowSummaryForBrain(
  name: string,
  nodes: Array<{ id: string; type: string; data?: { label?: string } }>,
  edges: unknown[],
): string {
  const exec = nodes.filter((n) => n.type !== "requestInputs" && n.type !== "response");
  const lines = exec.map((n) => `- ${n.id} (${n.type}) ${(n.data?.label ?? "").trim()}`.trim());
  return [
    `Workflow "${name}" synced from canvas.`,
    `${nodes.length} nodes, ${(edges as unknown[]).length} edges.`,
    "Executable nodes:",
    lines.length ? lines.join("\n") : "(none)",
    "Re-read with get_workflow before the next build or run step.",
  ].join("\n");
}
