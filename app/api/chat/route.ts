import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guardChatRead } from "@/lib/chat/guard";
import { validateBlueprintForPersist } from "@/lib/chat/blueprint-persist";
import { parseChatJsonBody } from "@/lib/chat/request-body";

/** GET /api/chat — list user's chats grouped by kind */
export async function GET() {
  const guard = await guardChatRead();
  if (guard instanceof NextResponse) return guard;
  const { userId } = guard;

  const chats = await prisma.chat.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      kind: true,
      title: true,
      workflowId: true,
      activatedFromChatId: true,
      createdAt: true,
      updatedAt: true,
      blueprint: true,
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { parts: true, createdAt: true },
      },
    },
  });

  const data = chats.map((c) => ({
    id: c.id,
    kind: c.kind,
    title: c.title,
    workflowId: c.workflowId,
    activatedFromChatId: c.activatedFromChatId,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    hasBlueprint: c.blueprint != null,
    blueprintConfidence:
      c.blueprint && typeof c.blueprint === "object" && "confidence" in (c.blueprint as object)
        ? (c.blueprint as { confidence?: string }).confidence
        : null,
    messages: c.messages,
  }));

  return NextResponse.json({ data });
}

/** POST /api/chat — create thinkly or brain chat */
export async function POST(request: Request) {
  const guard = await guardChatRead();
  if (guard instanceof NextResponse) return guard;
  const { userId } = guard;

  const parsed = await parseChatJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;

  const kind =
    body.kind === "brain"
      ? "brain"
      : body.kind === "helper"
        ? "helper"
        : "thinkly";

  if (kind === "helper") {
    const existing = await prisma.chat.findFirst({
      where: { userId, kind: "helper" },
      orderBy: { createdAt: "asc" },
    });
    if (existing) {
      return NextResponse.json({ data: existing });
    }
    const chat = await prisma.chat.create({
      data: { userId, kind: "helper", title: "Node Helper" },
    });
    return NextResponse.json({ data: chat }, { status: 201 });
  }

  const title =
    typeof body.title === "string" && body.title.trim()
      ? body.title.trim()
      : kind === "brain"
        ? "Brain"
        : "New plan";

  if (kind === "brain" && body.workflowId) {
    const workflowId = String(body.workflowId);
    const workflow = await prisma.workflow.findFirst({
      where: { id: workflowId, userId },
    });
    if (!workflow) {
      return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
    }

    const existing = await prisma.chat.findFirst({
      where: { workflowId, userId, kind: "brain" },
    });
    if (existing) {
      return NextResponse.json({ data: existing });
    }

    let blueprintData: object | undefined;
    if (body.blueprint) {
      const bp = validateBlueprintForPersist(body.blueprint, { allowInvalid: true });
      if (!bp.ok) return bp.response;
      blueprintData = bp.blueprint as object;
    }

    const chat = await prisma.chat.create({
      data: {
        userId,
        kind: "brain",
        title: workflow.name,
        workflowId,
        blueprintSource: body.blueprintSource ? (body.blueprintSource as object) : undefined,
        blueprint: blueprintData,
      },
    });
    return NextResponse.json({ data: chat }, { status: 201 });
  }

  const chat = await prisma.chat.create({
    data: { userId, kind: "thinkly", title },
  });
  return NextResponse.json({ data: chat }, { status: 201 });
}
