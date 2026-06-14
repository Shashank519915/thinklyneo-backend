import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { persistRunCompletionMessage } from "@/lib/chat/persist";
import { guardChatRequest } from "@/lib/chat/guard";
import { parseChatJsonBody } from "@/lib/chat/request-body";

/** POST /api/chat/[id]/run-complete — persist run completion as assistant message */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await guardChatRequest({ requireLlm: false });
  if (guard instanceof NextResponse) return guard;
  const { userId } = guard;

  const { id: chatId } = await params;
  const chat = await prisma.chat.findFirst({
    where: { id: chatId, userId, kind: "brain" },
  });
  if (!chat) {
    return NextResponse.json({ error: "Brain chat not found" }, { status: 404 });
  }

  const parsed = await parseChatJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;

  const orchestratorRunId =
    typeof body.orchestratorRunId === "string" ? body.orchestratorRunId : "";
  if (!orchestratorRunId) {
    return NextResponse.json({ error: "orchestratorRunId required" }, { status: 400 });
  }

  const status =
    body.status === "failed" || body.status === "partial" || body.status === "success"
      ? body.status
      : "success";
  const sectionCount = typeof body.sectionCount === "number" ? body.sectionCount : 0;
  const summary =
    typeof body.summary === "string" && body.summary.trim()
      ? body.summary.trim()
      : `Run ${orchestratorRunId.slice(0, 8)} completed (${status}). ${sectionCount} output section(s).`;

  await persistRunCompletionMessage(chatId, userId, {
    orchestratorRunId,
    workflowRunId: typeof body.workflowRunId === "string" ? body.workflowRunId : undefined,
    summary,
    sectionCount,
    status,
  });

  return NextResponse.json({ ok: true });
}
