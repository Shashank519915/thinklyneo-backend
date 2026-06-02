/**
 * @fileoverview Integration-style tests for the /api/v1/runs route handlers.
 * Prisma, verifyApiRequest, Trigger.dev tasks, credits helpers, and webhooks
 * are all mocked — no DB, network, or Trigger.dev project required.
 *
 * Tests cover:
 *  - POST /api/v1/runs  (start a run)
 *  - GET  /api/v1/runs/:id (get run status)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks must be hoisted before any imports that use them ─────────────────

vi.mock("@/lib/prisma", () => ({
  prisma: {
    workflow: { findUnique: vi.fn(), update: vi.fn() },
    workflowRun: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/api-auth", () => ({
  verifyApiRequest: vi.fn(),
}));

vi.mock("@/lib/credits", () => ({
  estimateWorkflowCost: vi.fn().mockReturnValue(0),
  getOrCreateBalance: vi.fn().mockResolvedValue(1_000_000),
}));

vi.mock("@/lib/webhooks", () => ({
  triggerOutboundWebhook: vi.fn().mockResolvedValue(undefined),
}));

// Trigger.dev dynamic import mock
vi.mock("@trigger.dev/sdk/v3", () => ({
  tasks: {
    trigger: vi.fn().mockResolvedValue({ id: "tr_mock_run_id" }),
  },
}));

import { prisma } from "@/lib/prisma";
import { verifyApiRequest } from "@/lib/api-auth";
import { POST as startRun } from "@/app/api/v1/runs/route";
import { GET as getRun } from "@/app/api/v1/runs/[id]/route";

const mockVerify = verifyApiRequest as ReturnType<typeof vi.fn>;
const mockWfFindUnique = prisma.workflow.findUnique as ReturnType<typeof vi.fn>;
const mockRunFindFirst = prisma.workflowRun.findFirst as ReturnType<typeof vi.fn>;
const mockRunCreate = prisma.workflowRun.create as ReturnType<typeof vi.fn>;
const mockRunFindFirstForGet = prisma.workflowRun.findFirst as ReturnType<typeof vi.fn>;
const mockTransaction = prisma.$transaction as ReturnType<typeof vi.fn>;

const AUTH_OK = { userId: "user_test", rateLimitHeaders: { "X-RateLimit-Limit": "60" } };
const AUTH_FAIL = { error: "Invalid API key", status: 401 };

const MOCK_WORKFLOW = {
  id: "wf_123",
  userId: "user_test",
  name: "Test",
  nodes: [
    { id: "ri", type: "requestInputs" },
    { id: "gpt", type: "gptImage2" },
    { id: "res", type: "response" },
  ],
  edges: [],
  webhookUrl: null,
  webhookSecret: null,
};

function makeRunRequest(body?: unknown): Request {
  return new Request("http://localhost/api/v1/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function makeGetRunRequest() {
  return {
    request: new Request("http://localhost/api/v1/runs/run_abc"),
    params: Promise.resolve({ id: "run_abc" }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default $transaction: execute the callback immediately with prisma as the tx
  mockTransaction.mockImplementation(async (fn: (tx: typeof prisma) => Promise<unknown>) => {
    const created = { id: "run_new", status: "running", workflowId: "wf_123", userId: "user_test" };
    mockRunCreate.mockResolvedValueOnce(created);
    return fn(prisma);
  });
});

// ── POST /api/v1/runs ──────────────────────────────────────────────────────

describe("POST /api/v1/runs", () => {
  it("returns 401 when auth fails", async () => {
    mockVerify.mockResolvedValueOnce(AUTH_FAIL);
    const res = await startRun(makeRunRequest({ workflowId: "wf_123", inputValues: {} }));
    expect(res.status).toBe(401);
  });

  it("returns 400 when workflowId is missing", async () => {
    mockVerify.mockResolvedValueOnce(AUTH_OK);
    const res = await startRun(makeRunRequest({ inputValues: {} }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/invalid/i);
  });

  it("returns 400 when scope is invalid", async () => {
    mockVerify.mockResolvedValueOnce(AUTH_OK);
    const res = await startRun(makeRunRequest({ workflowId: "wf_123", scope: "all", inputValues: {} }));
    expect(res.status).toBe(400);
  });

  it("returns 404 when workflow does not exist for this user", async () => {
    mockVerify.mockResolvedValueOnce(AUTH_OK);
    mockWfFindUnique.mockResolvedValueOnce(null);
    const res = await startRun(makeRunRequest({ workflowId: "wf_missing", inputValues: {} }));
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toMatch(/not found/i);
  });

  it("returns 409 when a run is already in progress", async () => {
    mockVerify.mockResolvedValueOnce(AUTH_OK);
    mockWfFindUnique.mockResolvedValueOnce(MOCK_WORKFLOW);
    mockRunFindFirst.mockResolvedValueOnce({ id: "run_existing", status: "running" });
    const res = await startRun(makeRunRequest({ workflowId: "wf_123", inputValues: {} }));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toMatch(/in progress/i);
    expect(json.runId).toBe("run_existing");
  });

  it("starts a run successfully and returns 202", async () => {
    mockVerify.mockResolvedValueOnce(AUTH_OK);
    mockWfFindUnique.mockResolvedValueOnce(MOCK_WORKFLOW);
    mockRunFindFirst.mockResolvedValueOnce(null); // no existing run
    // $transaction runs the callback and returns the created run
    mockTransaction.mockImplementationOnce(async (fn: (tx: typeof prisma) => Promise<unknown>) => {
      const created = { id: "run_new", status: "running", workflowId: "wf_123", userId: "user_test" };
      mockRunCreate.mockResolvedValueOnce(created);
      // Provide enough mocks for the transaction body
      (prisma.workflowRun.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
      (prisma.workflow.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
      return fn(prisma);
    });
    (prisma.workflowRun.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const res = await startRun(makeRunRequest({ workflowId: "wf_123", inputValues: { field_text: "hello" } }));
    expect(res.status).toBe(202);
    const json = await res.json();
    expect(json.data.status).toBe("running");
    expect(json.data.runId).toBeDefined();
  });

  it("accepts partial scope with nodeIds", async () => {
    mockVerify.mockResolvedValueOnce(AUTH_OK);
    mockWfFindUnique.mockResolvedValueOnce(MOCK_WORKFLOW);
    mockRunFindFirst.mockResolvedValueOnce(null);
    mockTransaction.mockImplementationOnce(async (fn: (tx: typeof prisma) => Promise<unknown>) => {
      mockRunCreate.mockResolvedValueOnce({ id: "run_partial", status: "running" });
      (prisma.workflowRun.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
      (prisma.workflow.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
      return fn(prisma);
    });
    (prisma.workflowRun.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const res = await startRun(makeRunRequest({
      workflowId: "wf_123",
      scope: "partial",
      nodeIds: ["gpt"],
      inputValues: {},
    }));
    expect(res.status).toBe(202);
  });
});

// ── GET /api/v1/runs/:id ───────────────────────────────────────────────────

describe("GET /api/v1/runs/:id", () => {
  it("returns 401 when auth fails", async () => {
    mockVerify.mockResolvedValueOnce(AUTH_FAIL);
    const { request, params } = makeGetRunRequest();
    const res = await getRun(request, { params });
    expect(res.status).toBe(401);
  });

  it("returns 404 when run not found", async () => {
    mockVerify.mockResolvedValueOnce(AUTH_OK);
    mockRunFindFirstForGet.mockResolvedValueOnce(null);
    const { request, params } = makeGetRunRequest();
    const res = await getRun(request, { params });
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toMatch(/not found/i);
  });

  it("returns run data with nodeRuns when found", async () => {
    mockVerify.mockResolvedValueOnce(AUTH_OK);
    mockRunFindFirstForGet.mockResolvedValueOnce({
      id: "run_abc",
      status: "done",
      workflowId: "wf_123",
      nodeRuns: [
        { id: "nr_1", nodeId: "gpt", nodeName: "GPT Image 2", status: "done", durationMs: 3200 },
      ],
    });
    const { request, params } = makeGetRunRequest();
    const res = await getRun(request, { params });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.id).toBe("run_abc");
    expect(json.data.nodeRuns).toHaveLength(1);
    expect(json.data.nodeRuns[0].nodeName).toBe("GPT Image 2");
  });

  it("includes rate-limit headers on success", async () => {
    mockVerify.mockResolvedValueOnce(AUTH_OK);
    mockRunFindFirstForGet.mockResolvedValueOnce({ id: "run_abc", status: "done", nodeRuns: [] });
    const { request, params } = makeGetRunRequest();
    const res = await getRun(request, { params });
    expect(res.headers.get("X-RateLimit-Limit")).toBe("60");
  });
});
