/**
 * @fileoverview Single endpoint to start a workflow execution. Creates a WorkflowRun,
 * triggers the server-side orchestrator task, and returns credentials for SSE subscription.
 *
 * Replaces the old pattern where the client called /run, then /execute/crop-image and
 * /execute/gemini individually. Now a single POST kicks off everything server-side.
 */

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { estimateWorkflowCost, getOrCreateBalance } from "@/lib/credits";

const executeSchema = z.object({
  scope: z.enum(["full", "partial", "single"]).default("full"),
  inputValues: z.record(z.any()).optional(),
  nodeIds: z.array(z.string()).optional(),
  existingOutputs: z.record(z.any()).optional(),
});

export const maxDuration = 60;

/**
 * POST /api/workflows/[id]/execute
 *
 * 1. Validates auth + workflow ownership
 * 2. Prevents concurrent runs (409 if a running WorkflowRun exists)
 * 3. Creates WorkflowRun { status: "running" }
 * 4. Serializes the workflow graph (nodes + edges) from the DB
 * 5. Triggers workflow-orchestrator task
 * 6. Mints a publicAccessToken scoped to the orchestrator's run
 * 7. Returns { runId, orchestratorRunId, publicAccessToken }
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const body = await request.json();
    const parsed = executeSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", issues: parsed.error.issues },
        { status: 400 }
      );
    }

    // Verify workflow exists and belongs to user
    const workflow = await prisma.workflow.findUnique({
      where: { id, userId },
    });

    if (!workflow) {
      return NextResponse.json(
        { error: "Workflow not found" },
        { status: 404 }
      );
    }

    // Prevent concurrent runs
    const existingRun = await prisma.workflowRun.findFirst({
      where: { workflowId: id, status: "running" },
    });

    if (existingRun) {
      return NextResponse.json(
        {
          error: "A run is already in progress for this workflow",
          runId: existingRun.id,
        },
        { status: 409 }
      );
    }

    const { scope, inputValues = {}, nodeIds, existingOutputs = {} } = parsed.data;

    const allNodes = (workflow.nodes as any[]) ?? [];
    const targetNodes = scope === "full"
      ? allNodes
      : allNodes.filter((n) => nodeIds?.includes(n.id));

    const estimatedCost = estimateWorkflowCost(targetNodes);

    // Create run and place hold transactionally
    const run = await prisma.$transaction(async (tx) => {
      // Get or initialize user balance inside tx to secure grant
      const balance = await getOrCreateBalance(userId, tx);
      if (balance < estimatedCost) {
        throw new Error(
          `Insufficient credits. Estimated cost: ${(estimatedCost / 1000000).toFixed(2)}M, but your balance is ${(balance / 1000000).toFixed(2)}M.`
        );
      }

      // Create WorkflowRun
      const newRun = await tx.workflowRun.create({
        data: {
          workflowId: id,
          userId,
          scope,
          status: "running",
          startedAt: new Date(),
          inputValues: (inputValues ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        },
      });

      // Place hold if estimatedCost > 0
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
            description: `Hold for workflow execution run ${newRun.id}`,
            runId: newRun.id,
            balanceAfter: nextBalance,
          },
        });
      }

      // Mark workflow as running
      await tx.workflow.update({
        where: { id },
        data: { status: "running" },
      });

      return newRun;
    });

    // Serialize the graph for the orchestrator
    // nodes and edges are stored as JSON in the workflow record
    const nodes = (workflow.nodes as unknown[]) ?? [];
    const edges = (workflow.edges as unknown[]) ?? [];

    // Trigger the orchestrator task
    const { tasks, auth: triggerAuth } = await import("@trigger.dev/sdk/v3");
    const orchestratorRun = await tasks.trigger("workflow-orchestrator", {
      workflowId: id,
      runId: run.id,
      nodes,
      edges,
      inputValues,
      scope,
      targetNodeIds: nodeIds,
      existingOutputs,
    });

    // Store orchestrator run ID in the WorkflowRun record
    await prisma.workflowRun.update({
      where: { id: run.id },
      data: { orchestratorRunId: orchestratorRun.id },
    });

    // Mint a public access token scoped to the orchestrator run
    const publicAccessToken = await triggerAuth.createPublicToken({
      scopes: {
        read: {
          runs: [orchestratorRun.id],
        },
      },
      expirationTime: "2hr",
    });

    console.log(
      `[Execute] Workflow ${id} run ${run.id} started. Orchestrator: ${orchestratorRun.id}`
    );

    return NextResponse.json({
      data: {
        runId: run.id,
        orchestratorRunId: orchestratorRun.id,
        publicAccessToken,
      },
    });
  } catch (error) {
    console.error("POST /api/workflows/[id]/execute error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}
