import { NextResponse } from "next/server";
import {
  convertToModelMessages,
  streamText,
  tool,
  stepCountIs,
  type UIMessage,
  generateId, 
} from "ai";
import { prisma } from "@/lib/prisma";
import { thinklySystemPrompt } from "@/lib/chat/prompts";
import {
  getOpenRouterProvider,
  resolveMaxOutputTokens,
  resolveModelForMode,
} from "@/lib/chat/models";
import { blueprintSchema } from "@/lib/chat/blueprint";
import { persistUiMessages } from "@/lib/chat/persist";
import { guardChatRequest } from "@/lib/chat/guard";
import { retrieveChatMemory, persistChatMemoryTurn } from "@/lib/chat/memory";
import { validateBlueprintForPersist } from "@/lib/chat/blueprint-persist";
import { parseChatJsonBody, validateMessagesArray } from "@/lib/chat/request-body";
import {
  getInboundUserMessages,
  sanitizeUiMessagesForConversion,
  truncateMessageHistory,
} from "@/lib/chat/sanitize-messages";
import { chatStreamConsumeSseStream } from "@/lib/chat/stream-response";
import { logChat } from "@/lib/chat/chat-log";

export const runtime = "nodejs";
export const maxDuration = 90;

function extractBlueprintFromMessages(messages: UIMessage[]): object | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "assistant") continue;
    for (const part of msg.parts ?? []) {
      const toolName =
        part.type === "dynamic-tool"
          ? (part as { toolName?: string }).toolName
          : part.type.replace(/^tool-/, "");
      if (toolName === "propose_blueprint" && "output" in part && part.output) {
        return part.output as object;
      }
    }
  }
  return undefined;
}

/** POST /api/chat/thinkly — Socratic planner with Blueprint tool */
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

  const chatId = typeof body.chatId === "string" ? body.chatId : "";
  if (!chatId) {
    return NextResponse.json({ error: "chatId required" }, { status: 400 });
  }

  const chat = await prisma.chat.findFirst({
    where: { id: chatId, userId, kind: "thinkly" },
  });
  if (!chat) {
    return NextResponse.json({ error: "Thinkly chat not found" }, { status: 404 });
  }

  const memorySnippet = await retrieveChatMemory(userId, "thinkly", messages);
  const openrouter = getOpenRouterProvider();
  const modelMessages = sanitizeUiMessagesForConversion(messages);
  const truncatedMessages = truncateMessageHistory(modelMessages, 10);

  await persistUiMessages(chatId, userId, getInboundUserMessages(messages));

  const result = streamText({
    model: openrouter(resolveModelForMode("thinkly")),
    system: thinklySystemPrompt() + memorySnippet,
    messages: await convertToModelMessages(truncatedMessages),
    maxOutputTokens: resolveMaxOutputTokens(),
    temperature: 0.3,
    abortSignal: request.signal,
    tools: {
      propose_blueprint: tool({
        description:
          "Emit a structured workflow Blueprint when the plan is ready or needs user review.",
        inputSchema: blueprintSchema,
        execute: async (blueprint) => blueprint,
      }),
    },
    stopWhen: stepCountIs(2),
  });

  return result.toUIMessageStreamResponse({
    originalMessages: messages,
    generateMessageId: generateId,
    consumeSseStream: chatStreamConsumeSseStream,
    onFinish: async ({ messages: finalMessages, responseMessage }) => {
      try {
        const toPersist =
          responseMessage?.id &&
          !finalMessages.some((m) => m.id === responseMessage.id)
            ? [...finalMessages, responseMessage]
            : finalMessages;

        await persistUiMessages(chatId, userId, toPersist);
        persistChatMemoryTurn(userId, "thinkly", chatId, toPersist);

        const rawBlueprint = extractBlueprintFromMessages(toPersist);
        let blueprintUpdate: object | undefined;
        if (rawBlueprint) {
          const bp = validateBlueprintForPersist(rawBlueprint, { allowInvalid: true });
          if (bp.ok) blueprintUpdate = bp.blueprint as object;
        }

        await prisma.chat.update({
          where: { id: chatId },
          data: {
            updatedAt: new Date(),
            ...(blueprintUpdate ? { blueprint: blueprintUpdate } : {}),
          },
        });
      } catch (err) {
        logChat("error", "thinkly_persist_failed", {
          chatId,
          userId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  });
}
