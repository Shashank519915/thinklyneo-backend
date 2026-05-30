/**
 * @fileoverview Exports validated workflow snapshot JSON (`workflowFilePayloadSchema`) for downloads.
 */

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { workflowFilePayloadSchema } from "@/lib/validation";

/** Builds `{ version, name, exportedAt, nodes, edges }` and rejects impossible shapes with 500. */
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
    });

    if (!workflow) {
      return NextResponse.json(
        { error: "Workflow not found" },
        { status: 404 }
      );
    }

    const exportData = {
      version: "1.0",
      name: workflow.name,
      exportedAt: new Date().toISOString(),
      nodes: workflow.nodes,
      edges: workflow.edges,
    };

    const validated = workflowFilePayloadSchema.safeParse(exportData);
    if (!validated.success) {
      console.error("Export payload validation failed:", validated.error.flatten());
      return NextResponse.json(
        { error: "Could not build a valid export payload" },
        { status: 500 }
      );
    }

    return NextResponse.json(validated.data);
  } catch (error) {
    console.error("GET /api/workflows/[id]/export error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
