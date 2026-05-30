/**
 * @fileoverview Ordered run history (`WorkflowRun` + nested `nodeRuns`) for a workflow dashboard panel.
 */

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/** Lists runs newest-first with node runs chronological within each run. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
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

    const runs = await prisma.workflowRun.findMany({
      where: { workflowId: id, userId },
      orderBy: { startedAt: "desc" },
      include: {
        nodeRuns: {
          orderBy: { startedAt: "asc" },
        },
      },
    });

    return NextResponse.json({ data: runs });
  } catch (error) {
    console.error("GET /api/workflows/[id]/history error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
