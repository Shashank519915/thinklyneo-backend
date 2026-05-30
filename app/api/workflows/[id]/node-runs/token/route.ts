/**
 * @fileoverview Token minting endpoint: supports both per-node token refresh (legacy)
 * and orchestrator-level token minting (new architecture).
 *
 * Mode 1 (node-level): { runId, nodeId } → mints token scoped to that node's triggerRunId
 * Mode 2 (orchestrator): { orchestratorRunId } → mints token scoped to the orchestrator run
 */

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const nodeTokenSchema = z.object({
  runId: z.string().min(1),
  nodeId: z.string().min(1),
  orchestratorRunId: z.undefined().optional(),
});

const orchestratorTokenSchema = z.object({
  orchestratorRunId: z.string().min(1),
  runId: z.undefined().optional(),
  nodeId: z.undefined().optional(),
});

const tokenSchema = z.union([orchestratorTokenSchema, nodeTokenSchema]);

/**
 * POST /api/workflows/[id]/node-runs/token
 * Body: { runId, nodeId } OR { orchestratorRunId }
 * Returns: { triggerRunId, publicAccessToken } or { orchestratorRunId, publicAccessToken }
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: workflowId } = await params;

  try {
    const body = await request.json();
    const parsed = tokenSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", issues: parsed.error.issues },
        { status: 400 }
      );
    }

    const { auth: triggerAuth } = await import("@trigger.dev/sdk/v3");

    // Mode 2: Orchestrator token minting
    if ("orchestratorRunId" in parsed.data && parsed.data.orchestratorRunId) {
      const { orchestratorRunId } = parsed.data;

      // Verify a run with this orchestrator exists for this workflow
      const run = await prisma.workflowRun.findFirst({
        where: { workflowId, userId, orchestratorRunId },
      });

      if (!run) {
        return NextResponse.json(
          { error: "No run found with this orchestrator ID" },
          { status: 404 }
        );
      }

      const publicAccessToken = await triggerAuth.createPublicToken({
        scopes: {
          read: {
            runs: [orchestratorRunId],
          },
        },
        expirationTime: "2hr",
      });

      return NextResponse.json({
        data: {
          orchestratorRunId,
          publicAccessToken,
        },
      });
    }

    // Mode 1: Node-level token minting (legacy)
    const { runId, nodeId } = parsed.data as { runId: string; nodeId: string };

    const run = await prisma.workflowRun.findFirst({
      where: { id: runId, workflowId, userId },
    });

    if (!run) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    const nodeRun = await prisma.nodeRun.findUnique({
      where: { runId_nodeId: { runId, nodeId } },
    });

    if (!nodeRun || !nodeRun.triggerRunId) {
      return NextResponse.json(
        { error: "No active Trigger.dev run found for this node" },
        { status: 404 }
      );
    }

    const publicAccessToken = await triggerAuth.createPublicToken({
      scopes: {
        read: {
          runs: [nodeRun.triggerRunId],
        },
      },
      expirationTime: "2hr",
    });

    return NextResponse.json({
      data: {
        triggerRunId: nodeRun.triggerRunId,
        publicAccessToken,
      },
    });
  } catch (error) {
    console.error("POST /api/workflows/[id]/node-runs/token error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
