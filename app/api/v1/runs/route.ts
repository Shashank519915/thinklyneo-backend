import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { verifyApiRequest } from "@/lib/api-auth";
import { z } from "zod";
import {
  estimateWorkflowCost,
  formatCreditsMicro,
  getOrCreateBalance,
  logCredits,
} from "@/lib/credits";
import { validateWorkflowInputs } from "@/lib/validate-input-limits";
import { triggerOutboundWebhook } from "@/lib/webhooks";

const runSchema = z.object({
  workflowId: z.string().min(1),
  scope: z.enum(["full", "partial", "single"]).default("full"),
  inputValues: z.record(z.any()).optional(),
  nodeIds: z.array(z.string()).optional(),
  existingOutputs: z.record(z.any()).optional(),
});

export const maxDuration = 60;

/**
 * POST /api/v1/runs
 * Executes a workflow canvas.
 */
export async function POST(request: Request) {
  const authResult = await verifyApiRequest(request);
  if ("error" in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  const { userId, rateLimitHeaders } = authResult;

  try {
    const body = await request.json();
    const parsed = runSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", issues: parsed.error.issues },
        { status: 400, headers: rateLimitHeaders }
      );
    }

    const { workflowId, scope, inputValues = {}, nodeIds, existingOutputs = {} } = parsed.data;

    // Verify workflow exists and belongs to user
    const workflow = await prisma.workflow.findUnique({
      where: { id: workflowId, userId },
    });

    if (!workflow) {
      return NextResponse.json(
        { error: "Workflow not found" },
        { status: 404, headers: rateLimitHeaders }
      );
    }

    // Prevent concurrent runs
    const existingRun = await prisma.workflowRun.findFirst({
      where: { workflowId, status: "running" },
    });

    if (existingRun) {
      return NextResponse.json(
        {
          error: "A run is already in progress for this workflow",
          runId: existingRun.id,
        },
        { status: 409, headers: rateLimitHeaders }
      );
    }

    const allNodes = (workflow.nodes as any[]) ?? [];
    const targetNodes = scope === "full"
      ? allNodes
      : allNodes.filter((n) => nodeIds?.includes(n.id));

    const limitError = await validateWorkflowInputs({
      nodes: allNodes,
      inputValues,
      scope,
      targetNodeIds: nodeIds,
    });

    if (limitError) {
      return NextResponse.json(
        { error: limitError.message },
        { status: 400, headers: rateLimitHeaders }
      );
    }

    const estimatedCost = estimateWorkflowCost(targetNodes);

    // Create run and place credit hold transactionally
    const run = await prisma.$transaction(async (tx) => {
      const balance = await getOrCreateBalance(userId, tx);
      if (balance < estimatedCost) {
        throw new Error(
          `Insufficient credits. Estimated cost: ${(estimatedCost / 1000000).toFixed(2)}M, but your balance is ${(balance / 1000000).toFixed(2)}M.`
        );
      }

      // Create WorkflowRun record
      const newRun = await tx.workflowRun.create({
        data: {
          workflowId,
          userId,
          scope,
          status: "running",
          startedAt: new Date(),
          inputValues: (inputValues ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        },
      });

      // Place hold transactionally
      if (estimatedCost > 0) {
        const nextBalance = balance - estimatedCost;
        await tx.creditBalance.update({
          where: { userId },
          data: { balance: nextBalance },
        });

        await tx.creditLedger.create({
          data: {
            userId,
            amount: -estimatedCost,
            type: "hold",
            description: `Hold for API workflow execution run ${newRun.id}`,
            runId: newRun.id,
            balanceAfter: nextBalance,
          },
        });
        logCredits("hold_placed", {
          runId: newRun.id,
          userId,
          source: "api_v1_runs",
          hold: formatCreditsMicro(estimatedCost),
          balanceAfter: formatCreditsMicro(nextBalance),
        });
      }

      // Set workflow status as running
      await tx.workflow.update({
        where: { id: workflowId },
        data: { status: "running" },
      });

      return newRun;
    });

    // Serialize node graphs
    const nodes = (workflow.nodes as unknown[]) ?? [];
    const edges = (workflow.edges as unknown[]) ?? [];

    // Trigger orchestrator task on Trigger.dev
    const { tasks } = await import("@trigger.dev/sdk/v3");
    const orchestratorRun = await tasks.trigger("workflow-orchestrator", {
      workflowId,
      runId: run.id,
      nodes,
      edges,
      inputValues,
      scope,
      targetNodeIds: nodeIds,
      existingOutputs,
    });

    // Store orchestrator run ID in DB record
    await prisma.workflowRun.update({
      where: { id: run.id },
      data: { orchestratorRunId: orchestratorRun.id },
    });

    // Fire webhook notification for run start
    await triggerOutboundWebhook(run.id, "run.started", true, {
      scope,
      inputValues,
    });

    return NextResponse.json({
      data: {
        runId: run.id,
        status: "running",
        orchestratorRunId: orchestratorRun.id,
      },
    }, { status: 202, headers: rateLimitHeaders });
  } catch (error: any) {
    console.error("POST /api/v1/runs error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500, headers: rateLimitHeaders }
    );
  }
}
