/**
 * @fileoverview API route to cancel an ongoing Trigger.dev orchestrator run.
 *
 * Order matters for Trigger.dev safety:
 *  1. Flip run status → "canceled" + mark in-flight node runs "skipped" (atomic).
 *     The orchestrator coordinator checks run.status !== "running" and short-circuits,
 *     so it will not finalize or reconcile again after we cancel the Trigger run.
 *  2. Cancel the Trigger.dev orchestrator run (best-effort).
 *  3. Reconcile credits: release hold, charge only completed node costs, refund rest.
 */

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { reconcileWorkflowCredits } from "@/lib/credits";

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
    const runningRun = await prisma.workflowRun.findFirst({
      where: { workflowId: id, userId, status: "running" },
    });

    if (!runningRun) {
      return NextResponse.json(
        { error: "No active run found to cancel." },
        { status: 404 }
      );
    }

    // 1. Atomically flip status away from "running" so the orchestrator
    //    coordinator short-circuits, and mark in-flight node runs as skipped.
    await prisma.$transaction([
      prisma.workflowRun.update({
        where: { id: runningRun.id },
        data: { status: "canceled", finishedAt: new Date() },
      }),
      prisma.workflow.update({
        where: { id },
        data: { status: "idle" },
      }),
      prisma.nodeRun.updateMany({
        where: { runId: runningRun.id, status: { in: ["pending", "running"] } },
        data: { status: "skipped" },
      }),
    ]);

    // 2. Cancel the Trigger.dev orchestrator run (best-effort — DB is already clean).
    if (runningRun.orchestratorRunId) {
      const { runs } = await import("@trigger.dev/sdk/v3");
      try {
        await runs.cancel(runningRun.orchestratorRunId);
        console.log(`[Cancel] Cancelled orchestrator run ${runningRun.orchestratorRunId}`);
      } catch (triggerError) {
        console.error("[Cancel] Trigger.dev cancellation failed (DB already clean):", triggerError);
      }
    }

    // 3. Reconcile credits: release hold, charge only successful node costs.
    const holdLedger = await prisma.creditLedger.findFirst({
      where: { runId: runningRun.id, type: "hold" },
      orderBy: { createdAt: "desc" },
    });
    const holdAmount = holdLedger ? Math.abs(holdLedger.amount) : 0;

    const successfulNodes = await prisma.nodeRun.findMany({
      where: { runId: runningRun.id, status: "success" },
      select: { creditCost: true },
    });
    const actualCost = successfulNodes.reduce((sum, n) => sum + (n.creditCost ?? 0), 0);

    if (holdAmount > 0 || actualCost > 0) {
      await reconcileWorkflowCredits(userId, runningRun.id, actualCost, holdAmount);
    }

    return NextResponse.json({ success: true, runId: runningRun.id });
  } catch (error) {
    console.error("POST /api/workflows/[id]/cancel error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
