/**
 * @fileoverview Mocked integration chain: list → thinkly → activate → brain open → run-complete.
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
      create: vi.fn(),
      update: vi.fn(),
    },
    workflow: { findFirst: vi.fn() },
    workflowRun: { findFirst: vi.fn() },
    message: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    $transaction: vi.fn((fn: (tx: unknown) => unknown) =>
      fn({
        message: {
          create: vi.fn(),
          findFirst: vi.fn(),
          update: vi.fn(),
        },
      }),
    ),
  },
}));

vi.mock("@/lib/chat/persist", () => ({
  ensureHelperChat: vi.fn(),
  persistUiMessages: vi.fn(),
  verifyChatOwnership: vi.fn(),
  persistRunCompletionMessage: vi.fn(),
  loadChatMessages: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/chat/memory", () => ({
  retrieveChatMemory: vi.fn().mockResolvedValue(""),
  persistChatMemoryTurn: vi.fn(),
}));

vi.mock("@/lib/chat/ratelimit", () => ({
  checkChatRateLimit: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock("@/lib/credits", () => ({
  getOrCreateBalance: vi.fn().mockResolvedValue(1_000_000),
}));

import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { persistRunCompletionMessage } from "@/lib/chat/persist";
import { GET as listChats, POST as createChat } from "@/app/api/chat/route";
import { POST as brainActivate } from "@/app/api/chat/brain/activate/route";
import { POST as brainOpen } from "@/app/api/chat/brain/open/route";
import { POST as runComplete } from "@/app/api/chat/[id]/run-complete/route";
import { POST as workflowContext } from "@/app/api/chat/workflow-context/route";

const mockAuth = auth as unknown as ReturnType<typeof vi.fn>;
const mockChatFindFirst = prisma.chat.findFirst as ReturnType<typeof vi.fn>;
const mockChatFindMany = prisma.chat.findMany as ReturnType<typeof vi.fn>;
const mockChatCreate = prisma.chat.create as ReturnType<typeof vi.fn>;
const mockWfFindFirst = prisma.workflow.findFirst as ReturnType<typeof vi.fn>;
const mockMessageCreate = prisma.message.create as ReturnType<typeof vi.fn>;
const mockPersistRunComplete = persistRunCompletionMessage as ReturnType<typeof vi.fn>;

const VALID_BLUEPRINT = {
  title: "Demo flow",
  summary: "Test",
  requestFields: [{ id: "field_text_1", type: "text", label: "Prompt", required: true }],
  nodes: [{ id: "n1", type: "openRouter", label: "LLM", params: { prompt: "hi" } }],
  edges: [
    {
      source: "request-inputs",
      sourceHandle: "field_text_1",
      target: "n1",
      targetHandle: "in:prompt",
    },
    {
      source: "n1",
      sourceHandle: "out:response",
      target: "response",
      targetHandle: "result",
    },
  ],
  openQuestions: [],
  confidence: "ready" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.OPENROUTER_API_KEY = "sk-test";
  mockAuth.mockResolvedValue({ userId: "user_integration" });
});

describe("chat integration chain (mocked)", () => {
  it("creates thinkly chat then activates brain", async () => {
    mockChatCreate.mockResolvedValue({
      id: "thinkly_new",
      kind: "thinkly",
      title: "New plan",
    });

    const createRes = await createChat(
      new Request("http://localhost/api/chat", {
        method: "POST",
        body: JSON.stringify({ kind: "thinkly", title: "New plan" }),
      }),
    );
    expect(createRes.status).toBe(201);
    const created = await createRes.json();
    expect(created.data.id).toBe("thinkly_new");

    mockChatFindFirst
      .mockResolvedValueOnce({
        id: "thinkly_new",
        kind: "thinkly",
        blueprint: VALID_BLUEPRINT,
      })
      .mockResolvedValueOnce(null);

    mockChatCreate.mockResolvedValueOnce({
      id: "brain_new",
      kind: "brain",
      title: "Demo flow",
      activatedFromChatId: "thinkly_new",
    });

    const activateRes = await brainActivate(
      new Request("http://localhost/api/chat/brain/activate", {
        method: "POST",
        body: JSON.stringify({ thinklyChatId: "thinkly_new" }),
      }),
    );
    expect(activateRes.status).toBe(201);
    const activated = await activateRes.json();
    expect(activated.data.id).toBe("brain_new");
    expect(activated.validation.valid).toBe(true);
  });

  it("opens brain for workflow then records run completion", async () => {
    mockWfFindFirst.mockResolvedValue({
      id: "wf_1",
      name: "Prod",
      userId: "user_integration",
      nodes: [{ id: "n1", type: "openRouter", data: { label: "LLM" } }],
      edges: [],
    });
    mockChatFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "brain_wf", kind: "brain", workflowId: "wf_1" });

    mockChatCreate.mockResolvedValue({
      id: "brain_wf",
      kind: "brain",
      workflowId: "wf_1",
      title: "Prod",
    });

    const openRes = await brainOpen(
      new Request("http://localhost/api/chat/brain/open", {
        method: "POST",
        body: JSON.stringify({ workflowId: "wf_1" }),
      }),
    );
    expect(openRes.status).toBe(201);

    mockChatFindFirst.mockResolvedValue({ id: "brain_wf", kind: "brain" });
    mockPersistRunComplete.mockResolvedValue(undefined);

    const completeRes = await runComplete(
      new Request("http://localhost/api/chat/brain_wf/run-complete", {
        method: "POST",
        body: JSON.stringify({
          orchestratorRunId: "tr_integration",
          status: "success",
          sectionCount: 1,
        }),
      }),
      { params: Promise.resolve({ id: "brain_wf" }) },
    );
    expect(completeRes.status).toBe(200);
    expect(mockPersistRunComplete).toHaveBeenCalled();
  });

  it("injects workflow context after canvas edit", async () => {
    mockChatFindFirst.mockResolvedValue({ id: "brain_wf", kind: "brain" });
    mockWfFindFirst.mockResolvedValue({
      id: "wf_1",
      name: "Prod",
      userId: "user_integration",
      nodes: [{ id: "n1", type: "openRouter", data: { label: "LLM" } }],
      edges: [],
    });
    mockMessageCreate.mockResolvedValue({ id: "msg_ctx" });
    (prisma.chat.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const ctxRes = await workflowContext(
      new Request("http://localhost/api/chat/workflow-context", {
        method: "POST",
        body: JSON.stringify({ chatId: "brain_wf", workflowId: "wf_1" }),
      }),
    );
    expect(ctxRes.status).toBe(200);
    const json = await ctxRes.json();
    expect(json.data.summary).toContain("Prod");
    expect(mockMessageCreate).toHaveBeenCalled();
  });

  it("lists chats without full blueprint payload", async () => {
    mockChatFindMany.mockResolvedValue([
      {
        id: "c1",
        kind: "thinkly",
        title: "Plan",
        workflowId: null,
        activatedFromChatId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        blueprint: { confidence: "ready", title: "Plan" },
        messages: [],
      },
    ]);

    const listRes = await listChats();
    expect(listRes.status).toBe(200);
    const json = await listRes.json();
    expect(json.data[0].hasBlueprint).toBe(true);
    expect(json.data[0].blueprintConfidence).toBe("ready");
    expect(json.data[0].blueprint).toBeUndefined();
  });
});
