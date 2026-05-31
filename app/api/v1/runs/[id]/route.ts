import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyApiRequest } from "@/lib/api-auth";

/**
 * GET /api/v1/runs/:id
 * Fetches the status, durations, and outputs of a workflow execution run.
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
    const run = await prisma.workflowRun.findFirst({
      where: { id, userId },
      include: {
        nodeRuns: {
          select: {
            id: true,
            nodeId: true,
            nodeName: true,
            status: true,
            startedAt: true,
            finishedAt: true,
            durationMs: true,
            inputs: true,
            output: true,
            error: true,
            providerUsed: true,
            creditCost: true,
          },
        },
      },
    });

    if (!run) {
      return NextResponse.json(
        { error: "Run not found" },
        { status: 404, headers: rateLimitHeaders }
      );
    }

    return NextResponse.json({ data: run }, { headers: rateLimitHeaders });
  } catch (error) {
    console.error(`GET /api/v1/runs/${id} error:`, error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: rateLimitHeaders }
    );
  }
}
