import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guardChatRequest } from "@/lib/chat/guard";

const bodySchema = z.object({
  orchestratorRunId: z.string().min(1),
  workflowId: z.string().min(1),
});

/** POST /api/chat/run-token — mint Trigger publicAccessToken for chat live runs */
export async function POST(request: Request) {
  const guard = await guardChatRequest({ requireLlm: false });
  if (guard instanceof NextResponse) return guard;
  const { userId } = guard;

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 });
  }

  const { orchestratorRunId, workflowId } = parsed.data;

  const run = await prisma.workflowRun.findFirst({
    where: { workflowId, userId, orchestratorRunId },
  });
  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  const { auth: triggerAuth } = await import("@trigger.dev/sdk/v3");
  const publicAccessToken = await triggerAuth.createPublicToken({
    scopes: { read: { runs: [orchestratorRunId] } },
    expirationTime: "2hr",
  });

  return NextResponse.json({
    data: {
      orchestratorRunId,
      runId: run.id,
      publicAccessToken,
    },
  });
}
