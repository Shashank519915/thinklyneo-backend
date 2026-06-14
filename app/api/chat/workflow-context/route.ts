import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guardChatRequest } from "@/lib/chat/guard";
import { parseChatJsonBody } from "@/lib/chat/request-body";
import { formatWorkflowSummaryForBrain } from "@/lib/chat/enrich";

/** POST /api/chat/workflow-context — inject workflow summary after canvas edit */
export async function POST(request: Request) {
  const guard = await guardChatRequest({ requireLlm: false });
  if (guard instanceof NextResponse) return guard;
  const { userId } = guard;

  const parsed = await parseChatJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;

  const chatId = typeof body.chatId === "string" ? body.chatId : "";
  const workflowId = typeof body.workflowId === "string" ? body.workflowId : "";
  if (!chatId || !workflowId) {
    return NextResponse.json({ error: "chatId and workflowId required" }, { status: 400 });
  }

  const chat = await prisma.chat.findFirst({
    where: { id: chatId, userId, kind: "brain" },
  });
  if (!chat) {
    return NextResponse.json({ error: "Brain chat not found" }, { status: 404 });
  }

  const wf = await prisma.workflow.findFirst({
    where: { id: workflowId, userId },
  });
  if (!wf) {
    return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
  }

  const nodes = (wf.nodes as Array<{ id: string; type: string; data?: { label?: string } }>) ?? [];
  const edges = (wf.edges as unknown[]) ?? [];
  const summary = formatWorkflowSummaryForBrain(wf.name, nodes, edges);

  const messageId = `wf-context-${workflowId}-${Date.now()}`;
  await prisma.message.create({
    data: {
      id: messageId,
      chatId,
      role: "assistant",
      parts: [{ type: "text", text: summary }],
    },
  });

  await prisma.chat.update({
    where: { id: chatId },
    data: { updatedAt: new Date(), workflowId },
  });

  return NextResponse.json({ data: { summary } });
}
