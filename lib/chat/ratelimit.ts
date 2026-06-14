import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

export type ChatRateLimitResult =
  | { ok: true }
  | { ok: false; status: number; error: string; retryAfter?: number };

let chatLimiter: Ratelimit | null = null;

function getChatLimiter(): Ratelimit | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  if (!chatLimiter) {
    chatLimiter = new Ratelimit({
      redis: new Redis({ url, token }),
      limiter: Ratelimit.slidingWindow(
        Number(process.env.CHAT_RATE_LIMIT_PER_MIN ?? 20),
        "1 m",
      ),
      prefix: "thinkly:chat",
      analytics: true,
    });
  }
  return chatLimiter;
}

function isProductionEnv(): boolean {
  return process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
}

/** Per-userId sliding window on chat routes. Fail closed in production when Upstash is unset. */
export async function checkChatRateLimit(userId: string): Promise<ChatRateLimitResult> {
  const limiter = getChatLimiter();
  if (!limiter) {
    if (isProductionEnv()) {
      return {
        ok: false,
        status: 503,
        error: "Chat rate limiting is not configured (UPSTASH_REDIS_REST_URL/TOKEN).",
      };
    }
    return { ok: true };
  }

  const result = await limiter.limit(userId);
  if (result.success) return { ok: true };

  return {
    ok: false,
    status: 429,
    error: "Chat rate limit exceeded. Try again shortly.",
    retryAfter: Math.max(1, Math.ceil((result.reset - Date.now()) / 1000)),
  };
}
