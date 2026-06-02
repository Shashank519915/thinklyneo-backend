/**
 * @fileoverview Unit tests for verifyApiRequest — tests the auth logic without
 * touching Unkey (env vars unset) and without a real DB (Prisma mocked).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock Prisma before importing api-auth ──────────────────────────────────
vi.mock("@/lib/prisma", () => ({
  prisma: {
    apiKey: {
      findUnique: vi.fn(),
    },
  },
}));

// ── Mock crypto (Node built-in) to make hash deterministic ─────────────────
// We don't mock crypto — it is a real Node built-in and works fine in tests.

import { verifyApiRequest } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";

// Cast to have access to vi mock methods
const mockFindUnique = prisma.apiKey.findUnique as ReturnType<typeof vi.fn>;

function makeRequest(authHeader?: string): Request {
  const headers: Record<string, string> = {};
  if (authHeader !== undefined) headers["Authorization"] = authHeader;
  return new Request("http://localhost/api/v1/workflows", { headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Ensure Unkey env vars are absent so we always exercise the local-DB path
  delete process.env.UNKEY_ROOT_KEY;
  delete process.env.UNKEY_API_ID;
  delete process.env.UNKEY_API_KEY;
});

describe("verifyApiRequest — missing / malformed authorization", () => {
  it("returns 401 when Authorization header is absent", async () => {
    const result = await verifyApiRequest(makeRequest());
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.status).toBe(401);
      expect(result.error).toMatch(/Authorization/i);
    }
  });

  it("returns 401 when Authorization header does not start with Bearer", async () => {
    const result = await verifyApiRequest(makeRequest("Basic abc123"));
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.status).toBe(401);
  });

  it("returns 401 when Bearer token is empty string after prefix", async () => {
    const result = await verifyApiRequest(makeRequest("Bearer "));
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.status).toBe(401);
  });
});

describe("verifyApiRequest — local DB mock-key path (Unkey not configured)", () => {
  it("returns 401 when key is not found in DB", async () => {
    mockFindUnique.mockResolvedValueOnce(null);
    const result = await verifyApiRequest(makeRequest("Bearer gx_test_invalid"));
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.status).toBe(401);
      expect(result.error).toMatch(/invalid/i);
    }
  });

  it("returns userId and rate-limit headers for a valid DB key", async () => {
    mockFindUnique.mockResolvedValueOnce({ userId: "user_abc123" });
    const result = await verifyApiRequest(makeRequest("Bearer gx_valid_key"));
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.userId).toBe("user_abc123");
      expect(result.rateLimitHeaders["X-RateLimit-Limit"]).toBe("60");
      expect(result.rateLimitHeaders["X-RateLimit-Remaining"]).toBe("59");
      expect(result.rateLimitHeaders["X-RateLimit-Reset"]).toBeDefined();
    }
  });

  it("returns 500 when DB throws an unexpected error", async () => {
    mockFindUnique.mockRejectedValueOnce(new Error("DB connection lost"));
    const result = await verifyApiRequest(makeRequest("Bearer gx_key"));
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.status).toBe(500);
  });

  it("hashes different keys to different DB lookups (called once per request)", async () => {
    mockFindUnique.mockResolvedValue(null);
    await verifyApiRequest(makeRequest("Bearer gx_key_one"));
    await verifyApiRequest(makeRequest("Bearer gx_key_two"));
    expect(mockFindUnique).toHaveBeenCalledTimes(2);
    // The two calls must have different keyId arguments
    const calls = mockFindUnique.mock.calls;
    const keyId1 = calls[0][0].where.keyId;
    const keyId2 = calls[1][0].where.keyId;
    expect(keyId1).not.toBe(keyId2);
  });
});
