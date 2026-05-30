/**
 * @fileoverview Incrementally updates or creates a NodeRun row during live workflow execution waves.
 */

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { z } from "zod";

const incrementalNodeRunSchema = z.object({
  runId: z.string(),
  nodeId: z.string(),
  nodeName: z.string(),
  status: z.enum(["running", "success", "failed", "skipped"]),
  startedAt: z.string(),
  finishedAt: z.string().optional(),
  durationMs: z.number().optional(),
  inputs: z.record(z.any()).optional(),
  output: z.any().optional(),
  error: z.string().optional(),
  triggerRunId: z.string().optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: workflowId } = await params;

  try {
    const body = await request.json();
    const parsed = incrementalNodeRunSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", issues: parsed.error.issues },
        { status: 400 }
      );
    }

    const {
      runId,
      nodeId,
      nodeName,
      status,
      startedAt,
      finishedAt,
      durationMs,
      inputs,
      output,
      error,
      triggerRunId,
    } = parsed.data;

    // Verify run belongs to this workflow and user
    const run = await prisma.workflowRun.findFirst({
      where: { id: runId, workflowId, userId },
    });

    if (!run) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    const upsertedNodeRun = await prisma.nodeRun.upsert({
      where: {
        runId_nodeId: {
          runId,
          nodeId,
        },
      },
      create: {
        runId,
        nodeId,
        nodeName,
        status,
        startedAt: new Date(startedAt),
        finishedAt: finishedAt ? new Date(finishedAt) : null,
        durationMs: durationMs ?? null,
        inputs: (inputs ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        output: (output ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        error: error ?? null,
        triggerRunId: triggerRunId ?? null,
      },
      update: {
        status,
        ...(finishedAt !== undefined && { finishedAt: new Date(finishedAt) }),
        ...(durationMs !== undefined && { durationMs }),
        ...(inputs !== undefined && { inputs: inputs as Prisma.InputJsonValue }),
        ...(output !== undefined && { output: output as Prisma.InputJsonValue }),
        ...(error !== undefined && { error }),
        ...(triggerRunId !== undefined && { triggerRunId }),
      },
    });

    return NextResponse.json({ data: { success: true, nodeRun: upsertedNodeRun } });
  } catch (error) {
    console.error("POST /api/workflows/[id]/node-runs/incremental error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
