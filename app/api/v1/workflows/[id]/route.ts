import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyApiRequest } from "@/lib/api-auth";
import { updateWorkflowSchema } from "@/lib/validation";
import { normalizeEdge, type GraphEdge, type GraphNode } from "@/lib/mcp/graph-ops";

/**
 * GET /api/v1/workflows/:id
 * Fetches nodes/edges details of a single workflow.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await verifyApiRequest(request);
  if ("error" in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  const { userId, rateLimitHeaders } = authResult;
  const { id } = await params;

  try {
    const workflow = await prisma.workflow.findUnique({
      where: { id, userId },
    });

    if (!workflow) {
      return NextResponse.json(
        { error: "Workflow not found" },
        { status: 404, headers: rateLimitHeaders }
      );
    }

    return NextResponse.json({ data: workflow }, { headers: rateLimitHeaders });
  } catch (error) {
    console.error(`GET /api/v1/workflows/${id} error:`, error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: rateLimitHeaders }
    );
  }
}

/**
 * PUT /api/v1/workflows/:id
 * Updates workflow graph configurations (name, description, nodes, edges).
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await verifyApiRequest(request);
  if ("error" in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  const { userId, rateLimitHeaders } = authResult;
  const { id } = await params;

  try {
    const body = await request.json();
    const parsed = updateWorkflowSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", issues: parsed.error.issues },
        { status: 400, headers: rateLimitHeaders }
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
        { status: 404, headers: rateLimitHeaders }
      );
    }

    const updated = await prisma.workflow.update({
      where: { id },
      data: {
        ...(parsed.data.name !== undefined && { name: parsed.data.name }),
        ...(parsed.data.description !== undefined && { description: parsed.data.description }),
        ...(parsed.data.nodes !== undefined && { nodes: parsed.data.nodes }),
        ...(parsed.data.edges !== undefined && {
          // Normalize raw edges so they always carry type/markerEnd/data.color
          // regardless of whether the agent used connect_nodes or update_workflow.
          edges: (parsed.data.edges as GraphEdge[]).map((e) =>
            normalizeEdge(e, (parsed.data.nodes ?? []) as GraphNode[])
          ) as any,
        }),
        ...(parsed.data.status !== undefined && { status: parsed.data.status }),
      },
    });

    return NextResponse.json({ data: updated }, { headers: rateLimitHeaders });
  } catch (error) {
    console.error(`PUT /api/v1/workflows/${id} error:`, error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: rateLimitHeaders }
    );
  }
}

/**
 * DELETE /api/v1/workflows/:id
 * Deletes a workflow.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await verifyApiRequest(request);
  if ("error" in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  const { userId, rateLimitHeaders } = authResult;
  const { id } = await params;

  try {
    const existing = await prisma.workflow.findUnique({
      where: { id, userId },
      select: { id: true },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Workflow not found" },
        { status: 404, headers: rateLimitHeaders }
      );
    }

    await prisma.workflow.delete({ where: { id } });
    return NextResponse.json({ data: { id } }, { headers: rateLimitHeaders });
  } catch (error) {
    console.error(`DELETE /api/v1/workflows/${id} error:`, error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: rateLimitHeaders }
    );
  }
}
