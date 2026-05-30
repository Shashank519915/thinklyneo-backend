/**
 * @fileoverview Single-workflow endpoints: fetch, partially update (`updateWorkflowSchema`), or delete owned workflow.
 */

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { updateWorkflowSchema } from "@/lib/validation";

/** Returns full Prisma workflow row for `:id` when owned by caller. */
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

    return NextResponse.json({ data: workflow });
  } catch (error) {
    console.error("GET /api/workflows/[id] error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/** Partial update of name, description, nodes, edges, and/or workflow status after ownership check. */
export async function PATCH(
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
    const parsed = updateWorkflowSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", issues: parsed.error.issues },
        { status: 400 }
      );
    }

    // Verify ownership
    const existing = await prisma.workflow.findUnique({
      where: { id, userId },
      select: { id: true },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Workflow not found" },
        { status: 404 }
      );
    }

    const updated = await prisma.workflow.update({
      where: { id },
      data: {
        ...(parsed.data.name !== undefined && { name: parsed.data.name }),
        ...(parsed.data.description !== undefined && {
          description: parsed.data.description,
        }),
        ...(parsed.data.nodes !== undefined && { nodes: parsed.data.nodes }),
        ...(parsed.data.edges !== undefined && { edges: parsed.data.edges }),
        ...(parsed.data.status !== undefined && { status: parsed.data.status }),
      },
    });

    return NextResponse.json({ data: updated });
  } catch (error) {
    console.error("PATCH /api/workflows/[id] error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/** Deletes workflow by id for the authenticated owner. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const existing = await prisma.workflow.findUnique({
      where: { id, userId },
      select: { id: true },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Workflow not found" },
        { status: 404 }
      );
    }

    await prisma.workflow.delete({ where: { id } });
    return NextResponse.json({ data: { id } });
  } catch (error) {
    console.error("DELETE /api/workflows/[id] error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
