import { prisma } from "./prisma";
import crypto from "crypto";

export interface VerifiedRequest {
  userId: string;
  rateLimitHeaders: Record<string, string>;
}

/**
 * Computes a SHA-256 hash of a key to use as the database lookup key in mock mode.
 */
function hashKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

/**
 * Middleware helper to verify versioned public API requests.
 * Supports Unkey (if credentials are set) and falls back to local SHA-256 hashed mock keys.
 */
export async function verifyApiRequest(req: Request): Promise<VerifiedRequest | { error: string; status: number }> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return { error: "Missing or invalid Authorization header. Expected 'Bearer <key>'", status: 401 };
  }

  const token = authHeader.substring(7).trim();
  if (!token) {
    return { error: "Authorization token cannot be empty", status: 401 };
  }

  const rootKey = process.env.UNKEY_ROOT_KEY;
  const apiId = process.env.UNKEY_API_ID || process.env.UNKEY_API_KEY;
  const isUnkeyConfigured = !!(rootKey && apiId);

  if (isUnkeyConfigured) {
    try {
      const verifyResp = await fetch("https://api.unkey.com/v2/keys.verifyKey", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${rootKey}`,
        },
        body: JSON.stringify({
          key: token,
        }),
      });

      if (!verifyResp.ok) {
        const errText = await verifyResp.text();
        console.error("[verifyApiRequest] Unkey verify error response:", errText);
        return { error: "Failed to verify API key in Unkey", status: 500 };
      }

      const result = await verifyResp.json();
      const data = result.data || {};

      if (!data.valid) {
        if (data.code === "RATE_LIMITED") {
          return { error: "Rate limit exceeded", status: 429 };
        }
        return { error: "Invalid API key", status: 401 };
      }

      const userId = data.identity?.externalId || data.ownerId;
      if (!userId) {
        return { error: "API key is valid but has no identity/owner configured", status: 401 };
      }

      // Add rate limit headers if present
      const rateLimitHeaders: Record<string, string> = {};
      if (data.ratelimits && data.ratelimits.length > 0) {
        const rl = data.ratelimits[0];
        rateLimitHeaders["X-RateLimit-Limit"] = rl.limit.toString();
        rateLimitHeaders["X-RateLimit-Remaining"] = rl.remaining.toString();
        rateLimitHeaders["X-RateLimit-Reset"] = Math.floor(rl.reset / 1000).toString();
      } else if (data.ratelimit) {
        rateLimitHeaders["X-RateLimit-Limit"] = data.ratelimit.limit.toString();
        rateLimitHeaders["X-RateLimit-Remaining"] = data.ratelimit.remaining.toString();
        rateLimitHeaders["X-RateLimit-Reset"] = data.ratelimit.reset.toString();
      }

      return { userId, rateLimitHeaders };
    } catch (unkeyErr) {
      console.error("[verifyApiRequest] Unkey verification crash, falling back to local database check:", unkeyErr);
      // Fallback to local DB check in case Unkey API is unreachable but key was cached/recorded locally
    }
  }

  // Fallback / Mock Mode: Check local database for hashed api key match
  const hashed = hashKey(token);

  try {
    const keyRecord = await prisma.apiKey.findUnique({
      where: { keyId: hashed },
      select: { userId: true },
    });

    if (!keyRecord) {
      return { error: "Invalid or unauthorized API key", status: 401 };
    }

    // Mock Rate Limiting: 60 requests/min default (returns stable headers)
    const limit = 60;
    const remaining = 59;
    const reset = Math.floor((Date.now() + 60000) / 1000);

    const rateLimitHeaders = {
      "X-RateLimit-Limit": limit.toString(),
      "X-RateLimit-Remaining": remaining.toString(),
      "X-RateLimit-Reset": reset.toString(),
    };

    return { userId: keyRecord.userId, rateLimitHeaders };
  } catch (dbErr) {
    console.error("[verifyApiRequest] Local DB verification error:", dbErr);
    return { error: "Internal server error", status: 500 };
  }
}
