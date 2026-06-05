import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { verifyApiRequest } from "@/lib/api-auth";
import {
  applyGraphOps,
  GraphOpError,
  type GraphEdge,
  type GraphNode,
  type GraphOp,
} from "@/lib/mcp/graph-ops";

/**
 * PATCH /api/v1/workflows/:id/graph
 *
 * Atomic, validated graph editing. Accepts an ordered list of operations
 * (addNode / updateNode / connectNodes / disconnectNodes / deleteNode), applies them to the
 * workflow's nodes/edges with full validation (handle existence, type compatibility, cycle
 * prevention, single-input rules, scaffold protection), and persists ONLY if every op
 * succeeds. This is purely a graph (canvas) mutation — it never starts or alters runs.
 */

const opSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("addNode"),
    nodeType: z.string().min(1),
    label: z.string().optional(),
    column: z.number().int().min(0).optional(),
    row: z.number().int().min(0).optional(),
    position: z.object({ x: z.number(), y: z.number() }).optional(),
    inputs: z.record(z.any()).optional(),
  }),
  z.object({
    op: z.literal("updateNode"),
    nodeId: z.string().min(1),
    inputs: z.record(z.any()).optional(),
    label: z.string().optional(),
    position: z.object({ x: z.number(), y: z.number() }).optional(),
  }),
  z.object({
    op: z.literal("connectNodes"),
    source: z.string().min(1),
    sourceHandle: z.string().min(1),
    target: z.string().min(1),
    targetHandle: z.string().min(1),
  }),
  z.object({
    op: z.literal("disconnectNodes"),
    edgeId: z.string().optional(),
    source: z.string().optional(),
    target: z.string().optional(),
    sourceHandle: z.string().optional(),
    targetHandle: z.string().optional(),
  }),
  z.object({ op: z.literal("deleteNode"), nodeId: z.string().min(1) }),
]);

const bodySchema = z.object({ ops: z.array(opSchema).min(1).max(50) });

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await verifyApiRequest(request);
  if ("error" in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }
  const { userId, rateLimitHeaders } = authResult;
  const { id } = await params;

  try {
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", issues: parsed.error.issues },
        { status: 400, headers: rateLimitHeaders }
      );
    }

    const workflow = await prisma.workflow.findUnique({ where: { id, userId } });
    if (!workflow) {
      return NextResponse.json({ error: "Workflow not found" }, { status: 404, headers: rateLimitHeaders });
    }

    const currentNodes = (workflow.nodes as unknown as GraphNode[]) ?? [];
    const currentEdges = (workflow.edges as unknown as GraphEdge[]) ?? [];

    let next: { nodes: GraphNode[]; edges: GraphEdge[]; results: unknown[] };
    try {
      next = applyGraphOps(currentNodes, currentEdges, parsed.data.ops as GraphOp[]);
    } catch (err) {
      if (err instanceof GraphOpError) {
        return NextResponse.json({ error: err.message }, { status: 400, headers: rateLimitHeaders });
      }
      throw err;
    }

    // Guard: never let graph edits drop the scaffold nodes or empty the graph.
    const types = new Set(next.nodes.map((n) => n.type));
    if (next.nodes.length === 0 || !types.has("requestInputs") || !types.has("response")) {
      return NextResponse.json(
        { error: "Resulting graph must keep requestInputs and response nodes." },
        { status: 400, headers: rateLimitHeaders }
      );
    }

    const updated = await prisma.workflow.update({
      where: { id },
      data: { nodes: next.nodes as any, edges: next.edges as any },
    });

    return NextResponse.json(
      { data: { workflow: updated, results: next.results } },
      { headers: rateLimitHeaders }
    );
  } catch (error) {
    console.error(`PATCH /api/v1/workflows/${id}/graph error:`, error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: rateLimitHeaders }
    );
  }
}
