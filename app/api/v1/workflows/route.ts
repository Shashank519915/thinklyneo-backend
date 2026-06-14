import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyApiRequest } from "@/lib/api-auth";
import { createWorkflowSchema } from "@/lib/validation";
import { resolveWorkflowGraph } from "@/lib/workflow-templates";

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
    const search = new URL(request.url).searchParams.get("search")?.trim() || undefined;
    const workflows = await prisma.workflow.findMany({
      where: {
        userId,
        ...(search ? { name: { contains: search, mode: "insensitive" as const } } : {}),
      },
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

    return NextResponse.json({ data: workflow }, { status: 201, headers: rateLimitHeaders });
  } catch (error) {
    console.error("POST /api/v1/workflows error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: rateLimitHeaders }
    );
  }
}
