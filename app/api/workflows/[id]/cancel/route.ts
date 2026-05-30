/**
 * @fileoverview API route to cancel an ongoing Trigger.dev orchestrator run.
 */

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

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
    // Find the currently running workflow run
    const runningRun = await prisma.workflowRun.findFirst({
      where: { workflowId: id, userId, status: "running" },
    });

    if (!runningRun) {
      return NextResponse.json(
        { error: "No active run found to cancel." },
        { status: 404 }
      );
    }

    if (runningRun.orchestratorRunId) {
      // Import Trigger.dev SDK to cancel the task
      const { runs } = await import("@trigger.dev/sdk/v3");
      
      try {
        await runs.cancel(runningRun.orchestratorRunId);
        console.log(`[Cancel] Cancelled orchestrator run ${runningRun.orchestratorRunId}`);
      } catch (triggerError) {
        console.error("[Cancel] Trigger.dev cancellation failed:", triggerError);
        // We continue anyway to clean up our local database state.
      }
    }

    // Mark the run as failed in the database
    await prisma.workflowRun.update({
      where: { id: runningRun.id },
      data: {
        status: "failed",
        finishedAt: new Date(),
      },
    });

    // Mark the workflow as idle
    await prisma.workflow.update({
      where: { id },
      data: { status: "idle" },
    });

    return NextResponse.json({ success: true, runId: runningRun.id });
  } catch (error) {
    console.error("POST /api/workflows/[id]/cancel error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
