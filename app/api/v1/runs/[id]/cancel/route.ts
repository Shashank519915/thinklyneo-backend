import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyApiRequest } from "@/lib/api-auth";
import { reconcileWorkflowCredits } from "@/lib/credits";

/**
 * POST /api/v1/runs/:id/cancel
 *
 * Cancels a RUNNING workflow run and settles credits. This is additive and only ever runs
 * on an explicit cancel — it does not change how normal runs execute or complete.
 *
 * Flow (ordered to avoid double-reconcile with the orchestrator):
 *  1. Set run status → "canceled" first. The Trigger.dev orchestrator's coordinator mode
 *     short-circuits when run.status !== "running", so it will not finalize/reconcile again.
 *  2. Mark any in-flight (pending/running) node runs as "skipped".
 *  3. Cancel the Trigger.dev orchestrator run (aborts its waitpoint).
 *  4. Reconcile credits: release the hold and charge only successful node costs (refund rest).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await verifyApiRequest(request);
  if ("error" in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }
  const { userId, rateLimitHeaders } = authResult;
  const { id } = await params;

  try {
    const run = await prisma.workflowRun.findFirst({ where: { id, userId } });
    if (!run) {
      return NextResponse.json({ error: "Run not found" }, { status: 404, headers: rateLimitHeaders });
    }
    if (run.status !== "running") {
      return NextResponse.json(
        { error: `Run is not running (status: ${run.status}); nothing to cancel.` },
        { status: 409, headers: rateLimitHeaders }
      );
    }

    // 1 + 2: flip status away from "running" (stops coordinator) and stop in-flight nodes.
    await prisma.$transaction([
      prisma.workflowRun.update({
        where: { id: run.id },
        data: { status: "canceled", finishedAt: new Date() },
      }),
      prisma.workflow.update({ where: { id: run.workflowId }, data: { status: "idle" } }),
      prisma.nodeRun.updateMany({
        where: { runId: run.id, status: { in: ["pending", "running"] } },
        data: { status: "skipped" },
      }),
    ]);

    // 3: cancel the orchestrator run (best-effort).
    if (run.orchestratorRunId) {
      try {
        const { runs } = await import("@trigger.dev/sdk/v3");
        await runs.cancel(run.orchestratorRunId);
      } catch (triggerError) {
        console.error("[v1 cancel] Trigger.dev cancellation failed (continuing):", triggerError);
      }
    }

    // 4: settle credits — release hold, charge successful node costs, refund the remainder.
    const holdLedger = await prisma.creditLedger.findFirst({
      where: { runId: run.id, type: "hold" },
      orderBy: { createdAt: "desc" },
    });
    const holdAmount = holdLedger ? Math.abs(holdLedger.amount) : 0;

    const successfulNodes = await prisma.nodeRun.findMany({
      where: { runId: run.id, status: "success" },
      select: { creditCost: true },
    });
    const actualCost = successfulNodes.reduce((sum, n) => sum + (n.creditCost ?? 0), 0);

    if (holdAmount > 0 || actualCost > 0) {
      await reconcileWorkflowCredits(userId, run.id, actualCost, holdAmount);
    }

    return NextResponse.json(
      {
        data: {
          runId: run.id,
          status: "canceled",
          chargedMicrocredits: actualCost,
          heldMicrocredits: holdAmount,
          refundedMicrocredits: Math.max(0, holdAmount - actualCost),
        },
      },
      { headers: rateLimitHeaders }
    );
  } catch (error) {
    console.error(`POST /api/v1/runs/${id}/cancel error:`, error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: rateLimitHeaders }
    );
  }
}
