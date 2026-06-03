/**
 * Unit tests for orchestrator coordination: notifyCoordinator, initial mode,
 * coordinator dispatch/skip, and DAG completion + reconcile.
 * Heavy mocks on Prisma and Trigger SDK.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const {
  mockTasksTrigger,
  mockTriggerWebhook,
  mockNodeRunUpdate,
  mockNodeRunUpdateMany,
  mockNodeRunFindMany,
  mockNodeRunFindUnique,
  mockNodeRunUpsert,
  mockWorkflowRunFindUnique,
  mockWorkflowRunUpdate,
  mockWorkflowUpdate,
  mockCreditLedgerFindFirst,
  mockReconcileWorkflowCredits,
  mockCreateToken,
  mockForToken,
  mockCompleteToken,
  mockMetadataSet,
  mockMetadataGet,
} = vi.hoisted(() => ({
  mockTasksTrigger: vi.fn(),
  mockTriggerWebhook: vi.fn(),
  mockNodeRunUpdate: vi.fn(),
  mockNodeRunUpdateMany: vi.fn(),
  mockNodeRunFindMany: vi.fn(),
  mockNodeRunFindUnique: vi.fn(),
  mockNodeRunUpsert: vi.fn(),
  mockWorkflowRunFindUnique: vi.fn(),
  mockWorkflowRunUpdate: vi.fn(),
  mockWorkflowUpdate: vi.fn(),
  mockCreditLedgerFindFirst: vi.fn(),
  mockReconcileWorkflowCredits: vi.fn(),
  mockCreateToken: vi.fn(),
  mockForToken: vi.fn(),
  mockCompleteToken: vi.fn(),
  mockMetadataSet: vi.fn(),
  mockMetadataGet: vi.fn(),
}));

vi.mock("@trigger.dev/sdk/v3", () => ({
  task: <T extends { run: unknown }>(def: T) => def,
  metadata: {
    set: (...args: unknown[]) => mockMetadataSet(...args),
    get: (...args: unknown[]) => mockMetadataGet(...args),
  },
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
  wait: {
    createToken: (...args: unknown[]) => mockCreateToken(...args),
    forToken: (...args: unknown[]) => mockForToken(...args),
    completeToken: (...args: unknown[]) => mockCompleteToken(...args),
  },
  tasks: {
    trigger: (...args: unknown[]) => mockTasksTrigger(...args),
  },
}));

vi.mock("../lib/prisma", () => ({
  prisma: {
    nodeRun: {
      update: (...args: unknown[]) => mockNodeRunUpdate(...args),
      updateMany: (...args: unknown[]) => mockNodeRunUpdateMany(...args),
      findMany: (...args: unknown[]) => mockNodeRunFindMany(...args),
      findUnique: (...args: unknown[]) => mockNodeRunFindUnique(...args),
      upsert: (...args: unknown[]) => mockNodeRunUpsert(...args),
    },
    workflowRun: {
      findUnique: (...args: unknown[]) => mockWorkflowRunFindUnique(...args),
      update: (...args: unknown[]) => mockWorkflowRunUpdate(...args),
    },
    workflow: {
      update: (...args: unknown[]) => mockWorkflowUpdate(...args),
    },
    creditLedger: {
      findFirst: (...args: unknown[]) => mockCreditLedgerFindFirst(...args),
    },
  },
}));

vi.mock("../lib/webhooks", () => ({
  triggerOutboundWebhook: (...args: unknown[]) => mockTriggerWebhook(...args),
}));

vi.mock("../lib/credits", () => ({
  reconcileWorkflowCredits: (...args: unknown[]) => mockReconcileWorkflowCredits(...args),
}));

import { notifyCoordinator } from "../trigger/utils";
import { workflowOrchestratorTask } from "../trigger/workflowOrchestrator";

const WORKFLOW_ID = "wf_test";
const RUN_ID = "run_test";
const ORCH_RUN_ID = "orch_run_test";
const WAITPOINT_ID = "wp_test";

const linearWorkflowNodes = [
  { id: "node-a", type: "requestInputs", data: { label: "Inputs", fields: [] } },
  { id: "node-b", type: "openRouter", data: { label: "LLM", inputs: {} } },
  { id: "node-c", type: "response", data: { label: "Response" } },
];

const twoNodeWorkflowNodes = [
  {
    id: "node-a",
    type: "requestInputs",
    data: {
      label: "Inputs",
      fields: [{ id: "field_text", value: "seed" }],
    },
  },
  { id: "node-b", type: "openRouter", data: { label: "LLM", inputs: {} } },
];

const linearWorkflowEdges = [
  { source: "node-a", target: "node-b", sourceHandle: "out:prompt", targetHandle: "in:prompt" },
  { source: "node-b", target: "node-c", sourceHandle: "out:response", targetHandle: "in:result" },
];

const twoNodeWorkflowEdges = [
  { source: "node-a", target: "node-b", sourceHandle: "field_text", targetHandle: "in:prompt" },
];

function makeNodeRun(
  nodeId: string,
  status: string,
  extra: Record<string, unknown> = {}
) {
  return {
    nodeId,
    runId: RUN_ID,
    status,
    output: status === "success" ? { response: "ok" } : null,
    error: status === "failed" ? "upstream error" : null,
    durationMs: 100,
    creditCost: 0,
    ...extra,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockTasksTrigger.mockResolvedValue(undefined);
  mockNodeRunUpdate.mockResolvedValue({});
  mockNodeRunUpdateMany.mockResolvedValue({ count: 1 });
  mockNodeRunFindUnique.mockResolvedValue(null);
  mockNodeRunUpsert.mockResolvedValue({});
  mockTriggerWebhook.mockResolvedValue(undefined);
  mockReconcileWorkflowCredits.mockResolvedValue(undefined);
  mockCreateToken.mockResolvedValue({ id: WAITPOINT_ID });
  mockForToken.mockResolvedValue({ ok: true, output: { finalStatus: "success" } });
  mockCompleteToken.mockResolvedValue(undefined);
  mockMetadataSet.mockResolvedValue(undefined);
  mockMetadataGet.mockResolvedValue("success");
  process.env.TRIGGER_SECRET_KEY = "test_secret";
  global.fetch = vi.fn().mockResolvedValue({ ok: true, text: async () => "" });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("notifyCoordinator", () => {
  it("updates NodeRun, fires webhook, and re-triggers orchestrator in coordinator mode", async () => {
    await notifyCoordinator({
      workflowId: WORKFLOW_ID,
      runId: RUN_ID,
      nodeId: "node-b",
      status: "success",
      output: { response: "hello" },
      durationMs: 1200,
      orchestratorRunId: ORCH_RUN_ID,
      waitpointTokenId: WAITPOINT_ID,
      providerUsed: "main-openrouter",
      providerAttempts: [{ providerId: "main-openrouter", status: "success", durationMs: 1000 }],
      logs: "[main-openrouter] Success\n",
      creditCost: 450000,
    });

    expect(mockNodeRunUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { runId_nodeId: { runId: RUN_ID, nodeId: "node-b" } },
        data: expect.objectContaining({
          status: "success",
          providerUsed: "main-openrouter",
          creditCost: 450000,
        }),
      })
    );

    expect(mockTriggerWebhook).toHaveBeenCalledWith(
      RUN_ID,
      "node.completed",
      true,
      expect.objectContaining({ nodeId: "node-b", providerUsed: "main-openrouter" }),
      null
    );

    expect(mockTasksTrigger).toHaveBeenCalledWith("workflow-orchestrator", {
      workflowId: WORKFLOW_ID,
      runId: RUN_ID,
      nodeCompleted: "node-b",
      orchestratorRunId: ORCH_RUN_ID,
      waitpointTokenId: WAITPOINT_ID,
    });
  });

  it("still re-triggers orchestrator on failure with provider audit fields", async () => {
    await notifyCoordinator({
      workflowId: WORKFLOW_ID,
      runId: RUN_ID,
      nodeId: "node-b",
      status: "failed",
      error: "All providers failed",
      durationMs: 500,
      orchestratorRunId: ORCH_RUN_ID,
      waitpointTokenId: WAITPOINT_ID,
      providerUsed: null,
      providerAttempts: [{ providerId: "main-openrouter", status: "failed", durationMs: 200 }],
      logs: "[main-openrouter] Failure\n",
      creditCost: 0,
    });

    expect(mockNodeRunUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "failed", error: "All providers failed" }),
      })
    );

    expect(mockTasksTrigger).toHaveBeenCalledWith(
      "workflow-orchestrator",
      expect.objectContaining({ nodeCompleted: "node-b" })
    );
  });
});

describe("workflowOrchestratorTask — initial mode", () => {
  it("creates waitpoint, runs ready nodes, dispatches LLM, then parks on forToken", async () => {
    const result = await workflowOrchestratorTask.run(
      {
        workflowId: WORKFLOW_ID,
        runId: RUN_ID,
        nodes: twoNodeWorkflowNodes,
        edges: twoNodeWorkflowEdges,
        inputValues: { field_text: "hello from run" },
      },
      { ctx: { run: { id: ORCH_RUN_ID } } } as never
    );

    expect(mockCreateToken).toHaveBeenCalledWith({ timeout: "1h" });
    expect(mockMetadataSet).toHaveBeenCalledWith(
      "nodeStates",
      expect.objectContaining({
        "node-a": expect.objectContaining({ status: "completed" }),
      })
    );

    expect(mockNodeRunUpsert).toHaveBeenCalled();
    expect(mockTasksTrigger).toHaveBeenCalledWith(
      "openrouter-inference",
      expect.objectContaining({
        runId: RUN_ID,
        nodeRunId: "node-b",
        orchestratorRunId: ORCH_RUN_ID,
        waitpointTokenId: WAITPOINT_ID,
      })
    );

    expect(mockForToken).toHaveBeenCalledWith(WAITPOINT_ID);
    expect(result).toEqual({ finalStatus: "success" });
  });
});

describe("workflowOrchestratorTask — coordinator mode", () => {
  function setupWorkflowRunMock() {
    mockWorkflowRunFindUnique.mockResolvedValue({
      id: RUN_ID,
      status: "running",
      workflowId: WORKFLOW_ID,
      userId: "user_1",
      inputValues: { prompt: "hi" },
      workflow: {
        nodes: linearWorkflowNodes,
        edges: linearWorkflowEdges,
      },
    });
  }

  it("skips downstream node when upstream failed (skip cascade)", async () => {
    setupWorkflowRunMock();
    mockNodeRunFindMany.mockResolvedValue([
      makeNodeRun("node-a", "success"),
      makeNodeRun("node-b", "failed"),
      makeNodeRun("node-c", "pending"),
    ]);

    await workflowOrchestratorTask.run(
      {
        workflowId: WORKFLOW_ID,
        runId: RUN_ID,
        nodes: linearWorkflowNodes,
        edges: linearWorkflowEdges,
        inputValues: {},
        nodeCompleted: "node-b",
        orchestratorRunId: ORCH_RUN_ID,
        waitpointTokenId: WAITPOINT_ID,
      },
      { ctx: { run: { id: "coord_run_1" } } } as never
    );

    expect(mockNodeRunUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { runId_nodeId: { runId: RUN_ID, nodeId: "node-c" } },
        data: expect.objectContaining({
          status: "skipped",
          error: "Skipped due to upstream failure",
        }),
      })
    );

    expect(mockTasksTrigger).toHaveBeenCalledWith(
      "workflow-orchestrator",
      expect.objectContaining({ nodeCompleted: "node-c" })
    );
  });

  it("dispatches openrouter-inference when upstream succeeded and node is pending", async () => {
    setupWorkflowRunMock();
    mockNodeRunFindMany.mockResolvedValue([
      makeNodeRun("node-a", "success", { output: { prompt: "hello" } }),
      makeNodeRun("node-b", "pending"),
      makeNodeRun("node-c", "pending"),
    ]);

    await workflowOrchestratorTask.run(
      {
        workflowId: WORKFLOW_ID,
        runId: RUN_ID,
        nodes: linearWorkflowNodes,
        edges: linearWorkflowEdges,
        inputValues: { prompt: "hello" },
        nodeCompleted: "node-a",
        orchestratorRunId: ORCH_RUN_ID,
        waitpointTokenId: WAITPOINT_ID,
      },
      { ctx: { run: { id: "coord_run_2" } } } as never
    );

    expect(mockNodeRunUpdateMany).toHaveBeenCalled();
    const lockCall = mockNodeRunUpdateMany.mock.calls.find(
      (call) => (call[0] as { where?: { nodeId?: string } }).where?.nodeId === "node-b"
    );
    expect(lockCall?.[0]).toMatchObject({
      where: { runId: RUN_ID, nodeId: "node-b", status: "pending" },
      data: expect.objectContaining({ status: "running" }),
    });

    expect(mockTasksTrigger).toHaveBeenCalledWith(
      "openrouter-inference",
      expect.objectContaining({
        runId: RUN_ID,
        nodeRunId: "node-b",
        orchestratorRunId: ORCH_RUN_ID,
        waitpointTokenId: WAITPOINT_ID,
        workflowId: WORKFLOW_ID,
      })
    );
  });

  it("does not re-trigger node that failed to acquire pending lock (already running)", async () => {
    setupWorkflowRunMock();
    mockNodeRunFindMany.mockResolvedValue([
      makeNodeRun("node-a", "success"),
      makeNodeRun("node-b", "running"),
      makeNodeRun("node-c", "pending"),
    ]);
    mockNodeRunUpdateMany.mockResolvedValue({ count: 0 });

    await workflowOrchestratorTask.run(
      {
        workflowId: WORKFLOW_ID,
        runId: RUN_ID,
        nodes: linearWorkflowNodes,
        edges: linearWorkflowEdges,
        inputValues: {},
        nodeCompleted: "node-a",
        orchestratorRunId: ORCH_RUN_ID,
        waitpointTokenId: WAITPOINT_ID,
      },
      { ctx: { run: { id: "coord_run_3" } } } as never
    );

    const openRouterCalls = mockTasksTrigger.mock.calls.filter(
      (call) => call[0] === "openrouter-inference"
    );
    expect(openRouterCalls).toHaveLength(0);
  });

  it("completes DAG: reconciles credits, completes waitpoint, fires run.completed webhook", async () => {
    setupWorkflowRunMock();
    const terminalRuns = [
      makeNodeRun("node-a", "success", { output: { prompt: "hi" }, creditCost: 0 }),
      makeNodeRun("node-b", "success", { output: { response: "ok" }, creditCost: 450_000 }),
      makeNodeRun("node-c", "success", { output: { result: "ok" }, creditCost: 0 }),
    ];
    mockNodeRunFindMany.mockResolvedValue(terminalRuns);
    mockCreditLedgerFindFirst.mockResolvedValue({ amount: -10_000_000, type: "hold" });

    await workflowOrchestratorTask.run(
      {
        workflowId: WORKFLOW_ID,
        runId: RUN_ID,
        nodes: linearWorkflowNodes,
        edges: linearWorkflowEdges,
        inputValues: {},
        nodeCompleted: "node-c",
        orchestratorRunId: ORCH_RUN_ID,
        waitpointTokenId: WAITPOINT_ID,
      },
      { ctx: { run: { id: "coord_run_complete" } } } as never
    );

    expect(mockReconcileWorkflowCredits).toHaveBeenCalledWith(
      "user_1",
      RUN_ID,
      450_000,
      10_000_000
    );

    expect(mockWorkflowRunUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: RUN_ID },
        data: expect.objectContaining({ status: "success" }),
      })
    );

    expect(mockWorkflowUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: WORKFLOW_ID },
        data: { status: "idle" },
      })
    );

    expect(mockTriggerWebhook).toHaveBeenCalledWith(
      RUN_ID,
      "run.completed",
      true,
      expect.objectContaining({ status: "success" }),
      null
    );

    expect(mockCompleteToken).toHaveBeenCalledWith(WAITPOINT_ID, { finalStatus: "success" });
  });
});
