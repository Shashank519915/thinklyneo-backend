import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyApiRequest } from "@/lib/api-auth";
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

/**
 * GET /api/v1/workflows
 * Lists user workflows (metadata only).
 */
export async function GET(request: Request) {
  const authResult = await verifyApiRequest(request);
  if ("error" in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  const { userId, rateLimitHeaders } = authResult;

  try {
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
        _count: { select: { runs: true } },
      },
    });

    return NextResponse.json({ data: workflows }, { headers: rateLimitHeaders });
  } catch (error) {
    console.error("GET /api/v1/workflows error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: rateLimitHeaders }
    );
  }
}

/**
 * POST /api/v1/workflows
 * Creates a new workflow canvas.
 */
export async function POST(request: Request) {
  const authResult = await verifyApiRequest(request);
  if ("error" in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  const { userId, rateLimitHeaders } = authResult;

  try {
    const body = await request.json();
    const parsed = createWorkflowSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", issues: parsed.error.issues },
        { status: 400, headers: rateLimitHeaders }
      );
    }

    const workflow = await prisma.workflow.create({
      data: {
        userId,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        nodes: DEFAULT_NODES as any,
        edges: DEFAULT_EDGES as any,
        status: "idle",
      },
    });

    return NextResponse.json({ data: workflow }, { status: 201, headers: rateLimitHeaders });
  } catch (error) {
    console.error("POST /api/v1/workflows error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: rateLimitHeaders }
    );
  }
}
