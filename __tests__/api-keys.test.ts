/**
 * Route tests for /api/keys — Clerk auth + Prisma mocked; Unkey not called.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    apiKey: {
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

vi.mock("@/lib/unkey-api-keys", () => ({
  buildUnkeyRatelimits: vi.fn(() => []),
  toUnkeyExpires: vi.fn(),
  syncUnkeyKeyUpdate: vi.fn().mockResolvedValue(undefined),
  deleteUnkeyKey: vi.fn().mockResolvedValue(undefined),
  isUnkeyManagedKey: vi.fn(() => false),
}));

import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { syncUnkeyKeyUpdate, deleteUnkeyKey } from "@/lib/unkey-api-keys";
import { GET, POST } from "@/app/api/keys/route";
import { PATCH, DELETE } from "@/app/api/keys/[id]/route";

const mockAuth = auth as unknown as ReturnType<typeof vi.fn>;
const mockFindMany = prisma.apiKey.findMany as ReturnType<typeof vi.fn>;
const mockCount = prisma.apiKey.count as ReturnType<typeof vi.fn>;
const mockCreate = prisma.apiKey.create as ReturnType<typeof vi.fn>;
const mockFindUnique = prisma.apiKey.findUnique as ReturnType<typeof vi.fn>;
const mockUpdate = prisma.apiKey.update as ReturnType<typeof vi.fn>;
const mockDelete = prisma.apiKey.delete as ReturnType<typeof vi.fn>;
const mockSyncUnkey = syncUnkeyKeyUpdate as ReturnType<typeof vi.fn>;
const mockDeleteUnkey = deleteUnkeyKey as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.UNKEY_ROOT_KEY;
  delete process.env.UNKEY_API_ID;
});

describe("GET /api/keys", () => {
  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue({ userId: null });
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("lists keys for authenticated user", async () => {
    mockAuth.mockResolvedValue({ userId: "user_1" });
    mockFindMany.mockResolvedValue([{ id: "k1", name: "Default" }]);
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toHaveLength(1);
  });
});

describe("POST /api/keys", () => {
  it("returns 400 when max keys reached", async () => {
    mockAuth.mockResolvedValue({ userId: "user_1" });
    mockCount.mockResolvedValue(10);
    const res = await POST(
      new Request("http://localhost/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "x" }),
      })
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/10/i);
  });

  it("creates mock key when Unkey is not configured", async () => {
    mockAuth.mockResolvedValue({ userId: "user_1" });
    mockCount.mockResolvedValue(0);
    mockCreate.mockResolvedValue({
      id: "db_1",
      name: "test1",
      maskedKey: "gx_mock_...abcd",
      rateLimitPerMin: 60,
      rateLimitPerDay: 1000,
      expiresAt: null,
      createdAt: new Date(),
    });
    const res = await POST(
      new Request("http://localhost/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "test1",
          rateLimitPerMin: 60,
          rateLimitPerDay: 1000,
        }),
      })
    );
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data.key).toMatch(/^gx_mock_/);
    expect(json.data.name).toBe("test1");
  });
});

describe("PATCH /api/keys/:id", () => {
  it("updates name and syncs Unkey helper", async () => {
    mockAuth.mockResolvedValue({ userId: "user_1" });
    const existing = {
      id: "k1",
      userId: "user_1",
      keyId: "unkey_id",
      maskedKey: "gx_...abcd",
      name: "Old",
      rateLimitPerMin: 60,
      rateLimitPerDay: 1000,
    };
    mockFindUnique.mockResolvedValue(existing);
    mockUpdate.mockResolvedValue({ ...existing, name: "New" });

    const res = await PATCH(
      new Request("http://localhost/api/keys/k1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "New" }),
      }),
      { params: Promise.resolve({ id: "k1" }) }
    );

    expect(res.status).toBe(200);
    expect(mockSyncUnkey).toHaveBeenCalledWith(
      existing,
      expect.objectContaining({ name: "New" })
    );
  });

  it("returns 404 for unknown key", async () => {
    mockAuth.mockResolvedValue({ userId: "user_1" });
    mockFindUnique.mockResolvedValue(null);
    const res = await PATCH(
      new Request("http://localhost/api/keys/missing", {
        method: "PATCH",
        body: JSON.stringify({ name: "x" }),
      }),
      { params: Promise.resolve({ id: "missing" }) }
    );
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/keys/:id", () => {
  it("deletes local row without Unkey for mock keys", async () => {
    mockAuth.mockResolvedValue({ userId: "user_1" });
    mockFindUnique.mockResolvedValue({
      id: "k1",
      userId: "user_1",
      keyId: "hash",
      maskedKey: "gx_mock_...abcd",
    });
    const res = await DELETE(
      new Request("http://localhost/api/keys/k1", { method: "DELETE" }),
      { params: Promise.resolve({ id: "k1" }) }
    );
    expect(res.status).toBe(200);
    expect(mockDeleteUnkey).not.toHaveBeenCalled();
    expect(mockDelete).toHaveBeenCalledWith({ where: { id: "k1" } });
  });
});
