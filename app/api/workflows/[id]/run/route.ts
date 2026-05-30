/**
 * @fileoverview Starts an execution recording: inserts `WorkflowRun` (status `running`) and marks workflow busy.
 */

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runWorkflowSchema } from "@/lib/validation";

/** Creates run row from `runWorkflowSchema` (scope/full|partial|single); client executes graph then POSTs `/node-runs`. */
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
    const parsed = runWorkflowSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", issues: parsed.error.issues },
        { status: 400 }
      );
    }

    const workflow = await prisma.workflow.findUnique({
      where: { id, userId },
      select: { id: true },
    });

    if (!workflow) {
      return NextResponse.json(
        { error: "Workflow not found" },
        { status: 404 }
      );
    }

    // Create a WorkflowRun record
    const run = await prisma.workflowRun.create({
      data: {
        workflowId: id,
        userId,
        scope: parsed.data.scope,
        status: "running",
        startedAt: new Date(),
      },
    });

    // Update workflow status
    await prisma.workflow.update({
      where: { id },
      data: { status: "running" },
    });

    return NextResponse.json({ data: { runId: run.id } });
  } catch (error) {
    console.error("POST /api/workflows/[id]/run error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
