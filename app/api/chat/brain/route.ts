import { NextResponse } from "next/server";
import { createMCPClient } from "@ai-sdk/mcp";
import {
  convertToModelMessages,
  streamText,
  stepCountIs,
  generateId,
  type UIMessage,
} from "ai";
import { prisma } from "@/lib/prisma";
import { brainSystemPrompt } from "@/lib/chat/prompts";
import {
  getOpenRouterProvider,
  resolveMaxOutputTokens,
  resolveModelForMode,
} from "@/lib/chat/models";
import { getMcpOrigin, getOrMintUserApiKey } from "@/lib/chat/session-key";
import { persistUiMessages } from "@/lib/chat/persist";
import { guardChatRequest } from "@/lib/chat/guard";
import { retrieveChatMemory, persistChatMemoryTurn } from "@/lib/chat/memory";
import { brainUiTools } from "@/lib/chat/brain-ui-tools";
import { parseChatJsonBody, validateMessagesArray } from "@/lib/chat/request-body";
import { logChat } from "@/lib/chat/chat-log";
import {
  getInboundUserMessages,
  sanitizeUiMessagesForConversion,
  truncateMessageHistory,
} from "@/lib/chat/sanitize-messages";
import { chatStreamConsumeSseStream } from "@/lib/chat/stream-response";

export const runtime = "nodejs";
export const maxDuration = 120;

function extractRunMetadata(finalMessages: UIMessage[]): {
  orchestratorRunId?: string;
  workflowRunId?: string;
  workflowIdUpdate?: string;
  orchestratorMessageId?: string;
} {
  let orchestratorRunId: string | undefined;
  let workflowRunId: string | undefined;
  let workflowIdUpdate: string | undefined;
  let orchestratorMessageId: string | undefined;

  for (const msg of finalMessages) {
    if (msg.role !== "assistant") continue;
    for (const part of msg.parts ?? []) {
      if (!part.type.startsWith("tool-") && part.type !== "dynamic-tool") continue;
      const toolName =
        part.type === "dynamic-tool"
          ? ((part as { toolName?: string }).toolName ?? "")
          : part.type.replace(/^tool-/, "");
      const out = "output" in part ? part.output : null;
      const parsed =
        typeof out === "string"
          ? (() => {
              try {
                return JSON.parse(out) as Record<string, unknown>;
              } catch {
                return null;
              }
            })()
          : out && typeof out === "object"
            ? (out as Record<string, unknown>)
            : null;
      if (!parsed) continue;

      if (typeof parsed.orchestratorRunId === "string") {
        orchestratorRunId = parsed.orchestratorRunId;
        orchestratorMessageId = msg.id;
      }
      if (typeof parsed.runId === "string" && toolName.includes("start_run")) {
        workflowRunId = parsed.runId;
        orchestratorMessageId = msg.id;
      }
      if (typeof parsed.id === "string" && toolName.includes("create_workflow")) {
        workflowIdUpdate = parsed.id;
      }
      if (typeof parsed.workflowId === "string") {
        workflowIdUpdate = parsed.workflowId;
      }
    }
  }

  return { orchestratorRunId, workflowRunId, workflowIdUpdate, orchestratorMessageId };
}

/** POST /api/chat/brain — MCP agent loop (server-side bearer, true /api/mcp) */
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
    where: { id: chatId, userId, kind: "brain" },
  });
  if (!chat) {
    return NextResponse.json({ error: "Brain chat not found" }, { status: 404 });
  }

  let mcpClient: Awaited<ReturnType<typeof createMCPClient>> | null = null;

  try {
    const bearer = await getOrMintUserApiKey(userId);
    const mcpOrigin = getMcpOrigin();

    mcpClient = await createMCPClient({
      transport: {
        type: "http",
        url: `${mcpOrigin}/api/mcp`,
        headers: { Authorization: `Bearer ${bearer}` },
      },
    });

    const mcpTools = await mcpClient.tools();
    const memorySnippet = await retrieveChatMemory(userId, "brain", messages);
    const openrouter = getOpenRouterProvider();
    const modelMessages = sanitizeUiMessagesForConversion(messages);
    const truncatedMessages = truncateMessageHistory(modelMessages, 10);

    await persistUiMessages(chatId, userId, getInboundUserMessages(messages));

    const result = streamText({
      model: openrouter(resolveModelForMode("brain")),
      system: brainSystemPrompt(chat.workflowId ?? undefined) + memorySnippet,
      messages: await convertToModelMessages(truncatedMessages),
      maxOutputTokens: resolveMaxOutputTokens(),
      tools: { ...mcpTools, ...brainUiTools },
      stopWhen: stepCountIs(12),
      temperature: 0.4,
      abortSignal: request.signal,
    });

    return result.toUIMessageStreamResponse({
      originalMessages: messages,
      generateMessageId: generateId,
      consumeSseStream: chatStreamConsumeSseStream,
      onFinish: async ({ messages: finalMessages, responseMessage }) => {
        const toPersist =
          responseMessage?.id &&
          !finalMessages.some((m) => m.id === responseMessage.id)
            ? [...finalMessages, responseMessage]
            : finalMessages;

        const meta = extractRunMetadata(toPersist);

        if (meta.workflowIdUpdate) {
          const owned = await prisma.workflow.findFirst({
            where: { id: meta.workflowIdUpdate, userId },
          });
          if (!owned) {
            logChat("warn", "brain_workflow_bind_rejected", {
              chatId,
              userId,
              workflowId: meta.workflowIdUpdate,
            });
            meta.workflowIdUpdate = undefined;
          }
        }

        try {
          await persistUiMessages(chatId, userId, toPersist, {
            orchestratorRunId: meta.orchestratorRunId,
            workflowRunId: meta.workflowRunId,
            orchestratorMessageId: meta.orchestratorMessageId,
          });
          persistChatMemoryTurn(userId, "brain", chatId, toPersist);

          await prisma.chat.update({
            where: { id: chatId },
            data: {
              updatedAt: new Date(),
              ...(meta.workflowIdUpdate ? { workflowId: meta.workflowIdUpdate } : {}),
            },
          });
        } catch (err) {
          logChat("error", "brain_persist_failed", {
            chatId,
            userId,
            error: err instanceof Error ? err.message : String(err),
          });
        }

        await mcpClient?.close().catch(() => undefined);
      },
    });
  } catch (err) {
    if (mcpClient) {
      await mcpClient.close().catch(() => undefined);
    }
    logChat("error", "brain_stream_failed", {
      chatId,
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Brain agent failed to start" }, { status: 500 });
  }
}
