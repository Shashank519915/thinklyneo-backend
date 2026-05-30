/**
 * @fileoverview Imports a workflow definition from exported JSON (`importWorkflowSchema` + `workflowFilePayloadSchema`).
 */

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { importWorkflowSchema, workflowFilePayloadSchema } from "@/lib/validation";

/** Parses pasted JSON text, validates graph shape, stores as `"<name> (Copy)"`. */
export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const parsed = importWorkflowSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", issues: parsed.error.issues },
        { status: 400 }
      );
    }

    let raw: unknown;
    try {
      raw = JSON.parse(parsed.data.json);
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON format" },
        { status: 400 }
      );
    }

    const fileParsed = workflowFilePayloadSchema.safeParse(raw);
    if (!fileParsed.success) {
      return NextResponse.json(
        { error: "Invalid workflow file", issues: fileParsed.error.issues },
        { status: 400 }
      );
    }

    const { nodes, edges, name: importName } = fileParsed.data;

    // Ensure user exists
    await prisma.user.upsert({
      where: { id: userId },
      update: {},
      create: { id: userId },
    });

    const workflow = await prisma.workflow.create({
      data: {
        userId,
        name: `${importName ?? "Imported Workflow"} (Copy)`,
        nodes: nodes as Parameters<typeof prisma.workflow.create>[0]["data"]["nodes"],
        edges: edges as Parameters<typeof prisma.workflow.create>[0]["data"]["edges"],
        status: "idle",
      },
    });

    return NextResponse.json({ data: workflow });
  } catch (error) {
    console.error("POST /api/workflows/import error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
