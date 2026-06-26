/**
 * @fileoverview Workflow CRUD collection: lists and creates workflows for the signed-in user with default starter graph.
 */

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createWorkflowSchema } from "@/lib/validation";
import { resolveWorkflowGraph } from "@/lib/workflow-templates";

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
        webhookUrl: true,
        webhookSecret: true,
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

/** Creates workflow with template seeded nodes/edges. */
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

    const { nodes, edges } = resolveWorkflowGraph({
      template: parsed.data.template,
      productBrief: parsed.data.productBrief,
    });

    // Optionally seed Request-Inputs fields (e.g. agent-defined inputs for an empty canvas).
    if (parsed.data.requestFields?.length) {
      const ri = (nodes as Array<{ type: string; data?: Record<string, unknown> }>).find(
        (n) => n.type === "requestInputs"
      );
      if (ri) {
        ri.data = ri.data ?? {};
        ri.data.fields = parsed.data.requestFields.map((f, i) => {
          const type = f.type ?? "text_field";
          return {
            id: f.id ?? `field_${type.replace("_field", "")}_${i + 1}`,
            type,
            label: f.label ?? type,
            value: f.value ?? (type === "text_field" || type === "select_field" ? "" : null),
            ...(f.selectOptions?.length ? { selectOptions: f.selectOptions } : {}),
            ...(f.numberMin !== undefined ? { numberMin: f.numberMin } : {}),
            ...(f.numberMax !== undefined ? { numberMax: f.numberMax } : {}),
            ...(f.numberStep !== undefined ? { numberStep: f.numberStep } : {}),
            ...(f.mediaMaxCount !== undefined ? { mediaMaxCount: f.mediaMaxCount } : {}),
          };
        });
      }
    }

    const workflow = await prisma.workflow.create({
      data: {
        userId,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        nodes: nodes as any,
        edges: edges as any,
        status: "idle",
      },
    });

    return NextResponse.json({ data: workflow }, { status: 201 });
  } catch (error) {
    console.error("POST /api/workflows error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
