/**
 * @fileoverview Persists finalized node-run rows and resolves parent `WorkflowRun` + workflow idle state after client execution.
 */

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { z } from "zod";

const nodeRunsSchema = z.object({
  runId: z.string(),
  nodeRuns: z.array(
    z.object({
      nodeId: z.string(),
      nodeName: z.string(),
      status: z.enum(["success", "failed", "skipped", "running"]),
      startedAt: z.string(),
      finishedAt: z.string().optional(),
      durationMs: z.number().optional(),
      inputs: z.record(z.any()).optional(),
      output: z.any().optional(),
      error: z.string().optional(),
      triggerRunId: z.string().optional(),
    })
  ),
  finalStatus: z.enum(["success", "failed", "partial"]),
});

/** Bulk-inserts validated `nodeRun` records, updates aggregate run status/duration, sets workflow status `idle`. */
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
    const parsed = nodeRunsSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", issues: parsed.error.issues },
        { status: 400 }
      );
    }

    // Verify run belongs to this workflow and user
    const run = await prisma.workflowRun.findFirst({
      where: { id: parsed.data.runId, workflowId: id, userId },
    });

    if (!run) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    const now = new Date();
    const startedAt = run.startedAt;
    const durationMs = now.getTime() - startedAt.getTime();

    const nodeRunData = parsed.data.nodeRuns.map((nr) => ({
      runId: parsed.data.runId,
      nodeId: nr.nodeId,
      nodeName: nr.nodeName,
      status: nr.status,
      startedAt: new Date(nr.startedAt),
      finishedAt: nr.finishedAt ? new Date(nr.finishedAt) : now,
      durationMs: nr.durationMs ?? 0,
      inputs: (nr.inputs ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      output: (nr.output ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      error: nr.error ?? null,
      triggerRunId: nr.triggerRunId ?? null,
    }));

    // Upsert each node run individually to avoid duplicate key issues with incremental updates
    for (const nr of nodeRunData) {
      await prisma.nodeRun.upsert({
        where: {
          runId_nodeId: {
            runId: nr.runId,
            nodeId: nr.nodeId,
          },
        },
        create: nr,
        update: {
          status: nr.status,
          finishedAt: nr.finishedAt,
          durationMs: nr.durationMs,
          inputs: nr.inputs,
          output: nr.output,
          error: nr.error,
          triggerRunId: nr.triggerRunId,
        },
      });
    }

    // Update run status
    await prisma.workflowRun.update({
      where: { id: parsed.data.runId },
      data: {
        status: parsed.data.finalStatus,
        finishedAt: now,
        durationMs,
      },
    });

    // Update workflow status
    await prisma.workflow.update({
      where: { id },
      data: { status: "idle" },
    });

    return NextResponse.json({ data: { success: true } });
  } catch (error) {
    console.error("POST /api/workflows/[id]/node-runs error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
