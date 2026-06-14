import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { loadChatMessages } from "@/lib/chat/persist";
import { enrichChatDetail } from "@/lib/chat/enrich";
import { guardChatRead, guardChatRequest } from "@/lib/chat/guard";
import { validateBlueprintForPersist } from "@/lib/chat/blueprint-persist";
import { parseChatJsonBody } from "@/lib/chat/request-body";

/** GET /api/chat/[id] — hydrate chat + messages */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await guardChatRead();
  if (guard instanceof NextResponse) return guard;
  const { userId } = guard;

  const { id } = await params;
  const chat = await prisma.chat.findFirst({
    where: { id, userId },
  });
  if (!chat) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const messages = await loadChatMessages(id, userId);
  const enrichment = await enrichChatDetail(chat, userId);
  return NextResponse.json({ data: { ...chat, messages, ...enrichment } });
}

/** PATCH /api/chat/[id] — update title or blueprint */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await guardChatRequest({ requireLlm: false });
  if (guard instanceof NextResponse) return guard;
  const { userId } = guard;

  const { id } = await params;
  const chat = await prisma.chat.findFirst({ where: { id, userId } });
  if (!chat) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (chat.kind === "helper") {
    return NextResponse.json({ error: "Helper chat cannot be modified" }, { status: 403 });
  }

  const parsed = await parseChatJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;

  const data: { title?: string; blueprint?: object } = {};
  if (typeof body.title === "string") data.title = body.title.trim();

  if (body.blueprint) {
    const bp = validateBlueprintForPersist(body.blueprint);
    if (!bp.ok) return bp.response;
    data.blueprint = bp.blueprint as object;
  }

  const updated = await prisma.chat.update({ where: { id }, data });
  return NextResponse.json({ data: updated });
}

/** DELETE /api/chat/[id] */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await guardChatRequest({ requireLlm: false });
  if (guard instanceof NextResponse) return guard;
  const { userId } = guard;

  const { id } = await params;
  const chat = await prisma.chat.findFirst({ where: { id, userId, kind: { not: "helper" } } });
  if (!chat) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.chat.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
