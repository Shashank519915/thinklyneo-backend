/**
 * @fileoverview Integration-style tests for the /api/v1/workflows route handlers.
 * Prisma and verifyApiRequest are mocked — no DB or network required.
 *
 * Tests cover:
 *  - GET /api/v1/workflows  (list)
 *  - POST /api/v1/workflows (create)
 *  - GET /api/v1/workflows/:id (single)
 *  - PUT /api/v1/workflows/:id (update)
 *  - DELETE /api/v1/workflows/:id (delete)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock Prisma ─────────────────────────────────────────────────────────────
vi.mock("@/lib/prisma", () => ({
  prisma: {
    workflow: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

// ── Mock verifyApiRequest so we can control auth results ───────────────────
vi.mock("@/lib/api-auth", () => ({
  verifyApiRequest: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { verifyApiRequest } from "@/lib/api-auth";
import { GET as listWorkflows, POST as createWorkflow } from "@/app/api/v1/workflows/route";
import { GET as getWorkflow, PUT as updateWorkflow, DELETE as deleteWorkflow } from "@/app/api/v1/workflows/[id]/route";

const mockVerify = verifyApiRequest as ReturnType<typeof vi.fn>;
const mockFindMany = prisma.workflow.findMany as ReturnType<typeof vi.fn>;
const mockFindUnique = prisma.workflow.findUnique as ReturnType<typeof vi.fn>;
const mockCreate = prisma.workflow.create as ReturnType<typeof vi.fn>;
const mockUpdate = prisma.workflow.update as ReturnType<typeof vi.fn>;
const mockDelete = prisma.workflow.delete as ReturnType<typeof vi.fn>;

const AUTH_OK = { userId: "user_test", rateLimitHeaders: { "X-RateLimit-Limit": "60" } };
const AUTH_FAIL = { error: "Invalid API key", status: 401 };

function makeRequest(method = "GET", body?: unknown): Request {
  return new Request("http://localhost/api/v1/workflows", {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function makeParamRequest(method = "GET", body?: unknown) {
  return {
    request: new Request("http://localhost/api/v1/workflows/wf_123", {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    }),
    params: Promise.resolve({ id: "wf_123" }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── GET /api/v1/workflows ──────────────────────────────────────────────────

describe("GET /api/v1/workflows", () => {
  it("returns 401 when auth fails", async () => {
    mockVerify.mockResolvedValueOnce(AUTH_FAIL);
    const res = await listWorkflows(makeRequest());
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toMatch(/invalid/i);
  });

  it("returns empty array when user has no workflows", async () => {
    mockVerify.mockResolvedValueOnce(AUTH_OK);
    mockFindMany.mockResolvedValueOnce([]);
    const res = await listWorkflows(makeRequest());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toEqual([]);
  });

  it("returns list of workflows with correct shape", async () => {
    mockVerify.mockResolvedValueOnce(AUTH_OK);
    mockFindMany.mockResolvedValueOnce([
      { id: "wf_1", name: "Pipeline A", status: "idle", createdAt: new Date(), updatedAt: new Date(), _count: { runs: 3 } },
      { id: "wf_2", name: "Pipeline B", status: "done", createdAt: new Date(), updatedAt: new Date(), _count: { runs: 0 } },
    ]);
    const res = await listWorkflows(makeRequest());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toHaveLength(2);
    expect(json.data[0].id).toBe("wf_1");
  });

  it("includes rate-limit headers on success", async () => {
    mockVerify.mockResolvedValueOnce(AUTH_OK);
    mockFindMany.mockResolvedValueOnce([]);
    const res = await listWorkflows(makeRequest());
    expect(res.headers.get("X-RateLimit-Limit")).toBe("60");
  });

  it("returns 500 when DB throws", async () => {
    mockVerify.mockResolvedValueOnce(AUTH_OK);
    mockFindMany.mockRejectedValueOnce(new Error("DB error"));
    const res = await listWorkflows(makeRequest());
    expect(res.status).toBe(500);
  });
});

// ── POST /api/v1/workflows ─────────────────────────────────────────────────

describe("POST /api/v1/workflows", () => {
  it("returns 401 when auth fails", async () => {
    mockVerify.mockResolvedValueOnce(AUTH_FAIL);
    const res = await createWorkflow(makeRequest("POST", { name: "Test" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 when name is missing", async () => {
    mockVerify.mockResolvedValueOnce(AUTH_OK);
    const res = await createWorkflow(makeRequest("POST", {}));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/invalid/i);
  });

  it("returns 400 when name is empty string", async () => {
    mockVerify.mockResolvedValueOnce(AUTH_OK);
    const res = await createWorkflow(makeRequest("POST", { name: "" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when name exceeds 120 characters", async () => {
    mockVerify.mockResolvedValueOnce(AUTH_OK);
    const res = await createWorkflow(makeRequest("POST", { name: "x".repeat(121) }));
    expect(res.status).toBe(400);
  });

  it("creates workflow and returns 201 with data", async () => {
    mockVerify.mockResolvedValueOnce(AUTH_OK);
    const created = { id: "wf_new", name: "My Pipeline", status: "idle", nodes: [], edges: [] };
    mockCreate.mockResolvedValueOnce(created);
    const res = await createWorkflow(makeRequest("POST", { name: "My Pipeline" }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data.id).toBe("wf_new");
    expect(json.data.name).toBe("My Pipeline");
  });

  it("creates workflow with optional description", async () => {
    mockVerify.mockResolvedValueOnce(AUTH_OK);
    mockCreate.mockResolvedValueOnce({ id: "wf_2", name: "Pipe", description: "desc", status: "idle" });
    const res = await createWorkflow(makeRequest("POST", { name: "Pipe", description: "desc" }));
    expect(res.status).toBe(201);
    const createArg = mockCreate.mock.calls[0][0].data;
    expect(createArg.description).toBe("desc");
  });

  it("creates advertisement template workflow with productBrief in nodes", async () => {
    mockVerify.mockResolvedValueOnce(AUTH_OK);
    mockCreate.mockResolvedValueOnce({ id: "wf_adv", name: "T-Shirt Promo", status: "idle" });
    const brief = "T-shirt company summer sale: 20% off graphic tees";
    const res = await createWorkflow(
      makeRequest("POST", {
        name: "T-Shirt Promo",
        template: "advertisement",
        productBrief: brief,
      })
    );
    expect(res.status).toBe(201);
    const createArg = mockCreate.mock.calls[0][0].data;
    const nodes = createArg.nodes as { id: string; type: string; data: { fields?: { id: string; value: string }[] } }[];
    expect(nodes.some((n) => n.type === "openRouter")).toBe(true);
    const requestInputs = nodes.find((n) => n.id === "request-inputs");
    const textField = requestInputs?.data.fields?.find((f) => f.id === "field_text_1");
    expect(textField?.value).toBe(brief);
  });
});

// ── GET /api/v1/workflows/:id ──────────────────────────────────────────────

describe("GET /api/v1/workflows/:id", () => {
  it("returns 401 when auth fails", async () => {
    mockVerify.mockResolvedValueOnce(AUTH_FAIL);
    const { request, params } = makeParamRequest();
    const res = await getWorkflow(request, { params });
    expect(res.status).toBe(401);
  });

  it("returns 404 when workflow not found", async () => {
    mockVerify.mockResolvedValueOnce(AUTH_OK);
    mockFindUnique.mockResolvedValueOnce(null);
    const { request, params } = makeParamRequest();
    const res = await getWorkflow(request, { params });
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toMatch(/not found/i);
  });

  it("returns workflow data when found", async () => {
    mockVerify.mockResolvedValueOnce(AUTH_OK);
    mockFindUnique.mockResolvedValueOnce({ id: "wf_123", name: "Test", nodes: [], edges: [] });
    const { request, params } = makeParamRequest();
    const res = await getWorkflow(request, { params });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.id).toBe("wf_123");
  });
});

// ── PUT /api/v1/workflows/:id ──────────────────────────────────────────────

describe("PUT /api/v1/workflows/:id", () => {
  it("returns 401 when auth fails", async () => {
    mockVerify.mockResolvedValueOnce(AUTH_FAIL);
    const { request, params } = makeParamRequest("PUT", { name: "New" });
    const res = await updateWorkflow(request, { params });
    expect(res.status).toBe(401);
  });

  it("returns 404 when workflow not found for this user", async () => {
    mockVerify.mockResolvedValueOnce(AUTH_OK);
    // safeParse succeeds (valid patch), but ownership check returns null
    mockFindUnique.mockResolvedValueOnce(null);
    const { request, params } = makeParamRequest("PUT", { name: "New name" });
    const res = await updateWorkflow(request, { params });
    expect(res.status).toBe(404);
  });

  it("returns 400 when nodes array is empty", async () => {
    mockVerify.mockResolvedValueOnce(AUTH_OK);
    const { request, params } = makeParamRequest("PUT", { nodes: [] });
    const res = await updateWorkflow(request, { params });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/invalid/i);
  });

  it("updates workflow and returns 200 with updated data", async () => {
    mockVerify.mockResolvedValueOnce(AUTH_OK);
    mockFindUnique.mockResolvedValueOnce({ id: "wf_123" }); // ownership check
    mockUpdate.mockResolvedValueOnce({ id: "wf_123", name: "Updated" });
    const { request, params } = makeParamRequest("PUT", { name: "Updated" });
    const res = await updateWorkflow(request, { params });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.name).toBe("Updated");
  });
});

// ── DELETE /api/v1/workflows/:id ───────────────────────────────────────────

describe("DELETE /api/v1/workflows/:id", () => {
  it("returns 401 when auth fails", async () => {
    mockVerify.mockResolvedValueOnce(AUTH_FAIL);
    const { request, params } = makeParamRequest("DELETE");
    const res = await deleteWorkflow(request, { params });
    expect(res.status).toBe(401);
  });

  it("returns 404 when workflow not found", async () => {
    mockVerify.mockResolvedValueOnce(AUTH_OK);
    mockFindUnique.mockResolvedValueOnce(null);
    const { request, params } = makeParamRequest("DELETE");
    const res = await deleteWorkflow(request, { params });
    expect(res.status).toBe(404);
  });

  it("deletes workflow and returns 200 with id", async () => {
    mockVerify.mockResolvedValueOnce(AUTH_OK);
    mockFindUnique.mockResolvedValueOnce({ id: "wf_123" });
    mockDelete.mockResolvedValueOnce({});
    const { request, params } = makeParamRequest("DELETE");
    const res = await deleteWorkflow(request, { params });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.id).toBe("wf_123");
  });
});
