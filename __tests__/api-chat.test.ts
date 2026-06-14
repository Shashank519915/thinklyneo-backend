/**
 * @fileoverview Status-code tests for chat API routes (auth, validation, rate guard).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    chat: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    workflow: {
      findFirst: vi.fn(),
    },
    workflowRun: {
      findFirst: vi.fn(),
    },
    message: {
      create: vi.fn(),
      createMany: vi.fn(),
      deleteMany: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    $transaction: vi.fn((fn: (tx: unknown) => unknown) => fn({
      message: {
        create: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
      },
    })),
  },
}));

vi.mock("@/lib/chat/persist", () => ({
  ensureHelperChat: vi.fn().mockResolvedValue("chat_helper"),
  persistUiMessages: vi.fn().mockResolvedValue(undefined),
  verifyChatOwnership: vi.fn(),
  persistRunCompletionMessage: vi.fn().mockResolvedValue(undefined),
  loadChatMessages: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/chat/memory", () => ({
  retrieveChatMemory: vi.fn().mockResolvedValue(""),
  persistChatMemoryTurn: vi.fn(),
}));

vi.mock("@/lib/chat/ratelimit", () => ({
  checkChatRateLimit: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    streamText: vi.fn().mockReturnValue({
      toUIMessageStreamResponse: vi.fn().mockReturnValue(
        new Response("ok", { status: 200 }),
      ),
    }),
    convertToModelMessages: vi.fn().mockResolvedValue([]),
  };
});

vi.mock("@ai-sdk/mcp", () => ({
  createMCPClient: vi.fn().mockResolvedValue({
    tools: vi.fn().mockResolvedValue({}),
    close: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("@/lib/chat/session-key", () => ({
  getOrMintUserApiKey: vi.fn().mockResolvedValue("gx_test"),
  getMcpOrigin: vi.fn().mockReturnValue("http://localhost:3000"),
}));

vi.mock("@/lib/credits", () => ({
  getOrCreateBalance: vi.fn().mockResolvedValue(5_000_000),
}));

vi.mock("@trigger.dev/sdk/v3", () => ({
  auth: {
    createPublicToken: vi.fn().mockResolvedValue("pat_mock"),
  },
}));

import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { checkChatRateLimit } from "@/lib/chat/ratelimit";
import { verifyChatOwnership } from "@/lib/chat/persist";
import { POST as helperChat } from "@/app/api/chat/helper/route";
import { POST as thinklyChat } from "@/app/api/chat/thinkly/route";
import { POST as brainChat } from "@/app/api/chat/brain/route";
import { POST as brainOpen } from "@/app/api/chat/brain/open/route";
import { POST as brainActivate } from "@/app/api/chat/brain/activate/route";
import { POST as runToken } from "@/app/api/chat/run-token/route";
import { GET as listChats, POST as createChat } from "@/app/api/chat/route";

const mockAuth = auth as unknown as ReturnType<typeof vi.fn>;
const mockChatFindFirst = prisma.chat.findFirst as ReturnType<typeof vi.fn>;
const mockChatFindMany = prisma.chat.findMany as ReturnType<typeof vi.fn>;
const mockChatCreate = prisma.chat.create as ReturnType<typeof vi.fn>;
const mockRunFindFirst = prisma.workflowRun.findFirst as ReturnType<typeof vi.fn>;
const mockRateLimit = checkChatRateLimit as ReturnType<typeof vi.fn>;
const mockVerifyChat = verifyChatOwnership as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.OPENROUTER_API_KEY = "sk-test";
  mockAuth.mockResolvedValue({ userId: "user_clerk" });
  mockRateLimit.mockResolvedValue({ ok: true });
  mockVerifyChat.mockResolvedValue({ id: "chat_helper", kind: "helper", workflowId: null });
});

describe("chat API auth", () => {
  it("helper returns 401 without session", async () => {
    mockAuth.mockResolvedValue({ userId: null });
    const res = await helperChat(
      new Request("http://localhost/api/chat/helper", {
        method: "POST",
        body: JSON.stringify({ messages: [{ id: "1", role: "user", parts: [{ type: "text", text: "hi" }] }] }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("helper returns 400 without messages", async () => {
    const res = await helperChat(
      new Request("http://localhost/api/chat/helper", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("helper rejects foreign chatId", async () => {
    mockVerifyChat.mockResolvedValue(null);
    const res = await helperChat(
      new Request("http://localhost/api/chat/helper", {
        method: "POST",
        body: JSON.stringify({
          chatId: "other_user_chat",
          messages: [{ id: "1", role: "user", parts: [{ type: "text", text: "hi" }] }],
        }),
      }),
    );
    expect(res.status).toBe(404);
  });

  it("thinkly returns 404 for unknown chat", async () => {
    mockChatFindFirst.mockResolvedValue(null);
    const res = await thinklyChat(
      new Request("http://localhost/api/chat/thinkly", {
        method: "POST",
        body: JSON.stringify({
          chatId: "missing",
          messages: [{ id: "1", role: "user", parts: [{ type: "text", text: "plan" }] }],
        }),
      }),
    );
    expect(res.status).toBe(404);
  });

  it("brain returns 404 for unknown chat", async () => {
    mockChatFindFirst.mockResolvedValue(null);
    const res = await brainChat(
      new Request("http://localhost/api/chat/brain", {
        method: "POST",
        body: JSON.stringify({
          chatId: "missing",
          messages: [{ id: "1", role: "user", parts: [{ type: "text", text: "build" }] }],
        }),
      }),
    );
    expect(res.status).toBe(404);
  });

  it("run-token returns 404 when run missing", async () => {
    mockRunFindFirst.mockResolvedValue(null);
    const res = await runToken(
      new Request("http://localhost/api/chat/run-token", {
        method: "POST",
        body: JSON.stringify({
          orchestratorRunId: "tr_1",
          workflowId: "wf_1",
        }),
      }),
    );
    expect(res.status).toBe(404);
  });

  it("run-token mints token when run exists", async () => {
    mockRunFindFirst.mockResolvedValue({
      id: "run_db",
      workflowId: "wf_1",
      orchestratorRunId: "tr_1",
    });
    const res = await runToken(
      new Request("http://localhost/api/chat/run-token", {
        method: "POST",
        body: JSON.stringify({
          orchestratorRunId: "tr_1",
          workflowId: "wf_1",
        }),
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.publicAccessToken).toBe("pat_mock");
    expect(json.data.runId).toBe("run_db");
  });

  it("returns 429 when rate limited", async () => {
    mockRateLimit.mockResolvedValue({
      ok: false,
      status: 429,
      error: "Chat rate limit exceeded. Try again shortly.",
      retryAfter: 30,
    });
    const res = await helperChat(
      new Request("http://localhost/api/chat/helper", {
        method: "POST",
        body: JSON.stringify({
          messages: [{ id: "1", role: "user", parts: [{ type: "text", text: "hi" }] }],
        }),
      }),
    );
    expect(res.status).toBe(429);
  });
});

describe("chat streaming setup", () => {
  it("thinkly streams when chat exists", async () => {
    mockChatFindFirst.mockResolvedValue({ id: "chat_thinkly", kind: "thinkly" });
    const res = await thinklyChat(
      new Request("http://localhost/api/chat/thinkly", {
        method: "POST",
        body: JSON.stringify({
          chatId: "chat_thinkly",
          messages: [{ id: "1", role: "user", parts: [{ type: "text", text: "plan" }] }],
        }),
      }),
    );
    expect(res.status).toBe(200);
  });

  it("brain streams when chat exists", async () => {
    mockChatFindFirst.mockResolvedValue({
      id: "chat_brain",
      kind: "brain",
      workflowId: "wf_1",
    });
    const res = await brainChat(
      new Request("http://localhost/api/chat/brain", {
        method: "POST",
        body: JSON.stringify({
          chatId: "chat_brain",
          messages: [{ id: "1", role: "user", parts: [{ type: "text", text: "build" }] }],
        }),
      }),
    );
    expect(res.status).toBe(200);
  });
});

describe("brain activate", () => {
  const mockChatFindFirst = prisma.chat.findFirst as ReturnType<typeof vi.fn>;
  const mockChatCreate = prisma.chat.create as ReturnType<typeof vi.fn>;

  it("returns 422 when blueprint graph invalid", async () => {
    mockChatFindFirst
      .mockResolvedValueOnce({
        id: "thinkly_1",
        kind: "thinkly",
        blueprint: {
          title: "Bad",
          summary: "x",
          requestFields: [],
          nodes: [{ id: "n1", type: "openRouter", label: "LLM", params: {} }],
          edges: [
            {
              source: "ghost_node",
              sourceHandle: "out:response",
              target: "response",
              targetHandle: "result",
            },
          ],
          openQuestions: [],
          confidence: "ready",
        },
      })
      .mockResolvedValueOnce(null);
    const res = await brainActivate(
      new Request("http://localhost/api/chat/brain/activate", {
        method: "POST",
        body: JSON.stringify({ thinklyChatId: "thinkly_1" }),
      }),
    );
    expect(res.status).toBe(422);
  });

  it("reuses existing brain chat for same thinkly id", async () => {
    mockChatFindFirst
      .mockResolvedValueOnce({
        id: "thinkly_1",
        kind: "thinkly",
        blueprint: {
          title: "Plan",
          summary: "s",
          requestFields: [],
          nodes: [],
          edges: [],
          confidence: "ready",
        },
      })
      .mockResolvedValueOnce({ id: "brain_existing", kind: "brain" });
    const res = await brainActivate(
      new Request("http://localhost/api/chat/brain/activate", {
        method: "POST",
        body: JSON.stringify({ thinklyChatId: "thinkly_1" }),
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.id).toBe("brain_existing");
    expect(json.validation.reused).toBe(true);
  });
});

describe("brain open", () => {
  const mockWfFindFirst = prisma.workflow.findFirst as ReturnType<typeof vi.fn>;
  const mockChatFindFirst = prisma.chat.findFirst as ReturnType<typeof vi.fn>;
  const mockChatCreate = prisma.chat.create as ReturnType<typeof vi.fn>;

  it("returns 404 when workflow missing", async () => {
    mockWfFindFirst.mockResolvedValue(null);
    const res = await brainOpen(
      new Request("http://localhost/api/chat/brain/open", {
        method: "POST",
        body: JSON.stringify({ workflowId: "wf_missing" }),
      }),
    );
    expect(res.status).toBe(404);
  });

  it("creates brain chat for workflow", async () => {
    mockWfFindFirst.mockResolvedValue({ id: "wf_1", name: "Demo", userId: "user_clerk" });
    mockChatFindFirst.mockResolvedValue(null);
    mockChatCreate.mockResolvedValue({
      id: "chat_brain_new",
      kind: "brain",
      workflowId: "wf_1",
      title: "Demo",
    });
    const res = await brainOpen(
      new Request("http://localhost/api/chat/brain/open", {
        method: "POST",
        body: JSON.stringify({ workflowId: "wf_1" }),
      }),
    );
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data.id).toBe("chat_brain_new");
  });
});

describe("chat list and create", () => {
  const mockWfFindFirst = prisma.workflow.findFirst as ReturnType<typeof vi.fn>;

  it("GET lists chats for user", async () => {
    mockChatFindMany.mockResolvedValue([
      { id: "c1", kind: "thinkly", title: "Plan", workflowId: null, messages: [] },
    ]);
    const res = await listChats();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data[0].id).toBe("c1");
  });

  it("POST brain returns existing chat for owned workflow only", async () => {
    mockWfFindFirst.mockResolvedValue({ id: "wf_1", name: "W", userId: "user_clerk" });
    mockChatFindFirst.mockResolvedValue({
      id: "existing_brain",
      userId: "user_clerk",
      kind: "brain",
      workflowId: "wf_1",
    });
    const res = await createChat(
      new Request("http://localhost/api/chat", {
        method: "POST",
        body: JSON.stringify({ kind: "brain", workflowId: "wf_1" }),
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.id).toBe("existing_brain");
  });
});
