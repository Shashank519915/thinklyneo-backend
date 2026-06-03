/**
 * @fileoverview Status-code tests for Clerk-authenticated dashboard workflow routes.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { upsert: vi.fn() },
    workflow: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    workflowRun: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    creditBalance: { update: vi.fn() },
    creditLedger: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/credits", () => ({
  estimateWorkflowCost: vi.fn().mockReturnValue(0),
  getOrCreateBalance: vi.fn().mockResolvedValue(1_000_000),
}));

vi.mock("@/lib/validate-input-limits", () => ({
  validateWorkflowInputs: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/webhooks", () => ({
  triggerOutboundWebhook: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@trigger.dev/sdk/v3", () => ({
  tasks: {
    trigger: vi.fn().mockResolvedValue({ id: "tr_orch_1" }),
  },
  auth: {
    createPublicToken: vi.fn().mockResolvedValue("pat_mock"),
  },
}));

import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { POST as createWorkflow } from "@/app/api/workflows/route";
import { POST as importWorkflow } from "@/app/api/workflows/import/route";
import { POST as executeWorkflow } from "@/app/api/workflows/[id]/execute/route";

const mockAuth = auth as ReturnType<typeof vi.fn>;
const mockUserUpsert = prisma.user.upsert as ReturnType<typeof vi.fn>;
const mockWfCreate = prisma.workflow.create as ReturnType<typeof vi.fn>;
const mockWfFindUnique = prisma.workflow.findUnique as ReturnType<typeof vi.fn>;
const mockRunFindFirst = prisma.workflowRun.findFirst as ReturnType<typeof vi.fn>;
const mockTransaction = prisma.$transaction as ReturnType<typeof vi.fn>;
const mockRunUpdate = prisma.workflowRun.update as ReturnType<typeof vi.fn>;

const MIN_IMPORT_JSON = JSON.stringify({
  name: "Imported",
  nodes: [{ id: "n1", type: "requestInputs", position: { x: 0, y: 0 }, data: { label: "In" } }],
  edges: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ userId: "user_clerk" });
  mockUserUpsert.mockResolvedValue({});
  mockTransaction.mockImplementation(async (fn: (tx: typeof prisma) => Promise<unknown>) => {
    const created = {
      id: "run_int",
      workflowId: "wf_int",
      userId: "user_clerk",
      status: "running",
    };
    (prisma.workflowRun.create as ReturnType<typeof vi.fn>).mockResolvedValueOnce(created);
    return fn(prisma);
  });
});

describe("POST /api/workflows (dashboard)", () => {
  it("returns 201 when a workflow is created", async () => {
    mockWfCreate.mockResolvedValueOnce({
      id: "wf_new",
      name: "Untitled Workflow",
      status: "idle",
    });

    const res = await createWorkflow(
      new Request("http://localhost/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Untitled Workflow" }),
      })
    );

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data.id).toBe("wf_new");
  });
});

describe("POST /api/workflows/import", () => {
  it("returns 201 when import creates a workflow", async () => {
    mockWfCreate.mockResolvedValueOnce({
      id: "wf_imp",
      name: "Imported (Copy)",
      status: "idle",
    });

    const res = await importWorkflow(
      new Request("http://localhost/api/workflows/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ json: MIN_IMPORT_JSON }),
      })
    );

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data.id).toBe("wf_imp");
  });
});

describe("POST /api/workflows/[id]/execute", () => {
  it("returns 202 when async run is accepted", async () => {
    mockWfFindUnique.mockResolvedValueOnce({
      id: "wf_int",
      userId: "user_clerk",
      nodes: [
        { id: "ri", type: "requestInputs" },
        { id: "res", type: "response" },
      ],
      edges: [],
    });
    mockRunFindFirst.mockResolvedValueOnce(null);
    mockRunUpdate.mockResolvedValueOnce({});

    const res = await executeWorkflow(
      new Request("http://localhost/api/workflows/wf_int/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "full", inputValues: {} }),
      }),
      { params: Promise.resolve({ id: "wf_int" }) }
    );

    expect(res.status).toBe(202);
    const json = await res.json();
    expect(json.data.runId).toBe("run_int");
    expect(json.data.orchestratorRunId).toBe("tr_orch_1");
    expect(json.data.publicAccessToken).toBe("pat_mock");
  });
});
