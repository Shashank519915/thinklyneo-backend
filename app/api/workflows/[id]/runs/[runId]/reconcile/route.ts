/**
 * @fileoverview Reconciles orphaned or stuck WorkflowRun and NodeRun records by querying the Trigger.dev API.
 */

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runs } from "@trigger.dev/sdk/v3";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; runId: string }> }
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: workflowId, runId } = await params;

  try {
    // 1. Fetch WorkflowRun and verify user owns it
    const workflowRun = await prisma.workflowRun.findFirst({
      where: { id: runId, workflowId, userId },
      include: { nodeRuns: true },
    });

    if (!workflowRun) {
      return NextResponse.json({ error: "Workflow run not found" }, { status: 404 });
    }

    // 2. If already terminal, return immediately
    if (workflowRun.status !== "running") {
      return NextResponse.json({
        data: {
          reconciled: false,
          status: workflowRun.status,
          message: "Run is already in a terminal state",
        },
      });
    }

    const runningNodeRuns = workflowRun.nodeRuns.filter(
      (nr) => nr.status === "running" || nr.finishedAt === null
    );

    let changed = false;

    // 3. Reconcile each running node run
    for (const nr of runningNodeRuns) {
      if (!nr.triggerRunId) {
        // No trigger ID, so it is stuck in scheduling. Mark it failed.
        await prisma.nodeRun.update({
          where: { id: nr.id },
          data: {
            status: "failed",
            finishedAt: new Date(),
            error: "Orphaned execution: no trigger run ID was registered.",
          },
        });
        changed = true;
        continue;
      }

      try {
        const triggerRun = await runs.retrieve(nr.triggerRunId);

        if (triggerRun.status === "COMPLETED") {
          await prisma.nodeRun.update({
            where: { id: nr.id },
            data: {
              status: "success",
              finishedAt: triggerRun.finishedAt ? new Date(triggerRun.finishedAt) : new Date(),
              durationMs: triggerRun.durationMs ?? 0,
              output: triggerRun.output ? JSON.parse(JSON.stringify(triggerRun.output)) : null,
            },
          });
          changed = true;
        } else if (
          triggerRun.status === "FAILED" ||
          triggerRun.status === "CRASHED" ||
          triggerRun.status === "CANCELED"
        ) {
          await prisma.nodeRun.update({
            where: { id: nr.id },
            data: {
              status: "failed",
              finishedAt: triggerRun.finishedAt ? new Date(triggerRun.finishedAt) : new Date(),
              durationMs: triggerRun.durationMs ?? 0,
              error: triggerRun.error?.message ?? `Trigger task run ended with status ${triggerRun.status}`,
            },
          });
          changed = true;
        }
      } catch (err) {
        console.error(`Failed to retrieve Trigger run ${nr.triggerRunId}:`, err);
        // If retrieving failed because run was not found (404), mark as failed
        const errMsg = err instanceof Error ? err.message : String(err);
        if (errMsg.includes("404") || errMsg.toLowerCase().includes("not found")) {
          await prisma.nodeRun.update({
            where: { id: nr.id },
            data: {
              status: "failed",
              finishedAt: new Date(),
              error: `Trigger run not found: ${errMsg}`,
            },
          });
          changed = true;
        }
      }
    }

    // 4. Refetch all node runs to determine final status
    const updatedNodeRuns = await prisma.nodeRun.findMany({
      where: { runId },
    });

    const hasActiveNodeRuns = updatedNodeRuns.some(
      (nr) => nr.status === "running" || nr.finishedAt === null
    );

    // If 10 minutes have passed since startedAt, force terminate the run to prevent hanging runs
    const elapsedMs = Date.now() - workflowRun.startedAt.getTime();
    const isStuck = elapsedMs > 10 * 60 * 1000;

    if (!hasActiveNodeRuns || isStuck) {
      // Calculate final status
      const anyFailed = updatedNodeRuns.some((nr) => nr.status === "failed");
      const allSuccess = updatedNodeRuns.every((nr) => nr.status === "success" || nr.status === "skipped");
      
      const finalStatus = anyFailed ? "failed" : allSuccess ? "success" : "partial";
      const now = new Date();

      await prisma.workflowRun.update({
        where: { id: runId },
        data: {
          status: finalStatus,
          finishedAt: now,
          durationMs: now.getTime() - workflowRun.startedAt.getTime(),
        },
      });

      await prisma.workflow.update({
        where: { id: workflowId },
        data: { status: "idle" },
      });

      return NextResponse.json({
        data: {
          reconciled: true,
          status: finalStatus,
          message: isStuck ? "Workflow run force-reconciled (timeout exceeded)." : "Workflow run fully reconciled.",
        },
      });
    }

    return NextResponse.json({
      data: {
        reconciled: changed,
        status: "running",
        message: "Some node runs are still in progress.",
      },
    });
  } catch (error) {
    console.error(`POST /api/workflows/[id]/runs/[runId]/reconcile error:`, error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
