import type { UIMessage } from "ai";
import { prisma } from "@/lib/prisma";
import { logChat } from "./chat-log";

export async function loadChatMessages(chatId: string, userId: string): Promise<UIMessage[]> {
  const chat = await prisma.chat.findFirst({
    where: { id: chatId, userId },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!chat) return [];

  return chat.messages.map((m) => ({
    id: m.id,
    role: m.role as UIMessage["role"],
    parts: m.parts as UIMessage["parts"],
  }));
}

export async function verifyChatOwnership(
  chatId: string,
  userId: string,
  kind?: "helper" | "thinkly" | "brain",
): Promise<{ id: string; kind: string; workflowId: string | null } | null> {
  const chat = await prisma.chat.findFirst({
    where: {
      id: chatId,
      userId,
      ...(kind ? { kind } : {}),
    },
    select: { id: true, kind: true, workflowId: true },
  });
  return chat;
}

export async function persistUiMessages(
  chatId: string,
  userId: string,
  messages: UIMessage[],
  opts?: {
    orchestratorRunId?: string;
    workflowRunId?: string;
    orchestratorMessageId?: string;
  },
): Promise<void> {
  const chat = await prisma.chat.findFirst({
    where: { id: chatId, userId },
    select: { id: true },
  });
  if (!chat) {
    logChat("warn", "persist_skipped_no_chat", { chatId, userId });
    return;
  }

  const existingIds = new Set(
    (
      await prisma.message.findMany({
        where: { chatId },
        select: { id: true },
      })
    ).map((m) => m.id),
  );

  const toInsert = messages.filter((m) => m.id && !existingIds.has(m.id));

  try {
    await prisma.$transaction(async (tx) => {
      for (const msg of toInsert) {
        const tagRun =
          opts?.orchestratorRunId &&
          msg.role === "assistant" &&
          (opts.orchestratorMessageId
            ? msg.id === opts.orchestratorMessageId
            : msg.id === toInsert.filter((m) => m.role === "assistant").at(-1)?.id);

        await tx.message.create({
          data: {
            id: msg.id,
            chatId,
            role: msg.role,
            parts: msg.parts as object,
            orchestratorRunId: tagRun ? opts.orchestratorRunId : undefined,
            workflowRunId: tagRun && opts?.workflowRunId ? opts.workflowRunId : undefined,
          },
        });
      }

      if (opts?.orchestratorRunId && opts.orchestratorMessageId) {
        const target = await tx.message.findFirst({
          where: { id: opts.orchestratorMessageId, chatId },
        });
        if (target && !target.orchestratorRunId) {
          await tx.message.update({
            where: { id: target.id },
            data: {
              orchestratorRunId: opts.orchestratorRunId,
              ...(opts.workflowRunId ? { workflowRunId: opts.workflowRunId } : {}),
            },
          });
        }
      }
    });
  } catch (err) {
    logChat("error", "persist_failed", {
      chatId,
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

export async function persistRunCompletionMessage(
  chatId: string,
  userId: string,
  payload: {
    orchestratorRunId: string;
    workflowRunId?: string;
    summary: string;
    sectionCount: number;
    status: "success" | "failed" | "partial";
  },
): Promise<void> {
  const chat = await prisma.chat.findFirst({
    where: { id: chatId, userId, kind: "brain" },
    select: { id: true },
  });
  if (!chat) return;

  const messageId = `run-complete-${payload.orchestratorRunId}`;
  const exists = await prisma.message.findUnique({ where: { id: messageId } });
  if (exists) return;

  await prisma.message.create({
    data: {
      id: messageId,
      chatId,
      role: "assistant",
      parts: [
        {
          type: "text",
          text: payload.summary,
        },
      ],
      orchestratorRunId: payload.orchestratorRunId,
      workflowRunId: payload.workflowRunId ?? undefined,
    },
  });

  await prisma.chat.update({
    where: { id: chatId },
    data: { updatedAt: new Date() },
  });
}

export async function ensureHelperChat(userId: string): Promise<string> {
  const existing = await prisma.chat.findFirst({
    where: { userId, kind: "helper" },
    orderBy: { createdAt: "asc" },
  });
  if (existing) return existing.id;

  const chat = await prisma.chat.create({
    data: {
      userId,
      kind: "helper",
      title: "Node Helper",
    },
  });
  return chat.id;
}
