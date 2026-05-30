/**
 * @fileoverview Workflow CRUD collection: lists and creates workflows for the signed-in user with default starter graph.
 */

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createWorkflowSchema } from "@/lib/validation";

const DEFAULT_NODES = [
  {
    id: "request-inputs",
    type: "requestInputs",
    position: { x: 100, y: 250 },
    data: {
      label: "Request-Inputs",
      fields: [
        {
          id: "field_text_default",
          type: "text_field",
          label: "text_field",
          value: "",
        },
      ],
    },
  },
  {
    id: "response",
    type: "response",
    position: { x: 700, y: 250 },
    data: {
      label: "Output",
      results: []
    },
  },
];

const DEFAULT_EDGES: unknown[] = [];

/** Ensures Clerk user exists, then returns workflows with run counts (newest first). */
export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Ensure user exists
    await prisma.user.upsert({
      where: { id: userId },
      update: {},
      create: { id: userId },
    });

    const workflows = await prisma.workflow.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        name: true,
        description: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        nodes: true,
        _count: { select: { runs: true } },
      },
    });

    return NextResponse.json({ data: workflows });
  } catch (error) {
    console.error("GET /api/workflows error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/** Creates workflow with seeded Request-Inputs + Response nodes and empty edges. */
export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const parsed = createWorkflowSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", issues: parsed.error.issues },
        { status: 400 }
      );
    }

    // Ensure user exists
    await prisma.user.upsert({
      where: { id: userId },
      update: {},
      create: { id: userId },
    });

    const workflow = await prisma.workflow.create({
      data: {
        userId,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        nodes: DEFAULT_NODES as unknown as Parameters<typeof prisma.workflow.create>[0]["data"]["nodes"],
        edges: DEFAULT_EDGES as unknown as Parameters<typeof prisma.workflow.create>[0]["data"]["edges"],
        status: "idle",
      },
    });

    return NextResponse.json({ data: workflow });
  } catch (error) {
    console.error("POST /api/workflows error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
