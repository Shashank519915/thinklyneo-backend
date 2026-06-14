import { NextResponse } from "next/server";
import {
  convertToModelMessages,
  streamText,
  type UIMessage,
} from "ai";
import { prisma } from "@/lib/prisma";
import { helperSystemPrompt } from "@/lib/chat/prompts";
import {
  getOpenRouterProvider,
  resolveMaxOutputTokens,
  resolveModelForMode,
} from "@/lib/chat/models";
import { ensureHelperChat, persistUiMessages, verifyChatOwnership } from "@/lib/chat/persist";
import { guardChatRequest } from "@/lib/chat/guard";
import { retrieveChatMemory, persistChatMemoryTurn } from "@/lib/chat/memory";
import { parseChatJsonBody, validateMessagesArray } from "@/lib/chat/request-body";
import {
  getInboundUserMessages,
  sanitizeUiMessagesForConversion,
} from "@/lib/chat/sanitize-messages";
import { chatStreamConsumeSseStream } from "@/lib/chat/stream-response";
import { logChat } from "@/lib/chat/chat-log";

export const runtime = "nodejs";
export const maxDuration = 60;

/** POST /api/chat/helper — streaming Node Helper (read-only) */
export async function POST(request: Request) {
  const guard = await guardChatRequest();
  if (guard instanceof NextResponse) return guard;
  const { userId } = guard;

  const parsed = await parseChatJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;

  const messagesCheck = validateMessagesArray(body.messages);
  if (!messagesCheck.ok) return messagesCheck.response;
  const messages = body.messages as UIMessage[];

  let chatId: string;
  if (typeof body.chatId === "string" && body.chatId) {
    const owned = await verifyChatOwnership(body.chatId, userId, "helper");
    if (!owned) {
      return NextResponse.json({ error: "Helper chat not found" }, { status: 404 });
    }
    chatId = body.chatId;
  } else {
    chatId = await ensureHelperChat(userId);
  }

  const memorySnippet = await retrieveChatMemory(userId, "helper", messages);
  const openrouter = getOpenRouterProvider();
  const modelMessages = sanitizeUiMessagesForConversion(messages);

  await persistUiMessages(chatId, userId, getInboundUserMessages(messages));

  const result = streamText({
    model: openrouter(resolveModelForMode("helper")),
    system: helperSystemPrompt() + memorySnippet,
    messages: await convertToModelMessages(modelMessages),
    maxOutputTokens: resolveMaxOutputTokens(),
    temperature: 0.2,
    abortSignal: request.signal,
  });

  return result.toUIMessageStreamResponse({
    originalMessages: messages,
    consumeSseStream: chatStreamConsumeSseStream,
    onFinish: async ({ messages: finalMessages }) => {
      try {
        await persistUiMessages(chatId, userId, finalMessages);
        persistChatMemoryTurn(userId, "helper", chatId, finalMessages);
        await prisma.chat.update({
          where: { id: chatId },
          data: { updatedAt: new Date() },
        });
      } catch (err) {
        logChat("error", "helper_persist_failed", {
          chatId,
          userId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  });
}
