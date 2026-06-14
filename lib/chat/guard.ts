import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { checkChatRateLimit } from "./ratelimit";

export async function guardChatRequest(opts?: { requireLlm?: boolean }): Promise<
  { userId: string } | NextResponse
> {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rate = await checkChatRateLimit(userId);
  if (!rate.ok) {
    return NextResponse.json(
      { error: rate.error },
      {
        status: rate.status,
        headers: rate.retryAfter ? { "Retry-After": String(rate.retryAfter) } : undefined,
      },
    );
  }

  if ((opts?.requireLlm ?? true) && !process.env.OPENROUTER_API_KEY) {
    return NextResponse.json({ error: "OPENROUTER_API_KEY not configured" }, { status: 503 });
  }

  return { userId };
}

/** Auth + rate limit for read routes (no LLM requirement). */
export async function guardChatRead(): Promise<{ userId: string } | NextResponse> {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rate = await checkChatRateLimit(userId);
  if (!rate.ok) {
    return NextResponse.json(
      { error: rate.error },
      {
        status: rate.status,
        headers: rate.retryAfter ? { "Retry-After": String(rate.retryAfter) } : undefined,
      },
    );
  }

  return { userId };
}
