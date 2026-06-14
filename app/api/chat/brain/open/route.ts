import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guardChatRequest } from "@/lib/chat/guard";
import { parseChatJsonBody } from "@/lib/chat/request-body";

const openSchema = z.object({
  workflowId: z.string().min(1),
});

/** POST /api/chat/brain/open — bind or create Brain chat for an existing workflow */
export async function POST(request: Request) {
  const guard = await guardChatRequest({ requireLlm: false });
  if (guard instanceof NextResponse) return guard;
  const { userId } = guard;

  const parsedBody = await parseChatJsonBody(request);
  if (!parsedBody.ok) return parsedBody.response;

  const parsed = openSchema.safeParse(parsedBody.body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 });
  }

  const workflow = await prisma.workflow.findFirst({
    where: { id: parsed.data.workflowId, userId },
  });
  if (!workflow) {
    return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
  }

  const existing = await prisma.chat.findFirst({
    where: { workflowId: parsed.data.workflowId, userId, kind: "brain" },
  });
  if (existing) {
    return NextResponse.json({ data: existing });
  }

  const brainChat = await prisma.chat.create({
    data: {
      userId,
      kind: "brain",
      title: workflow.name,
      workflowId: workflow.id,
    },
  });

  return NextResponse.json({ data: brainChat }, { status: 201 });
}
