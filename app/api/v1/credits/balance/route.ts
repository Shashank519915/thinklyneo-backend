import { NextResponse } from "next/server";
import { getOrCreateBalance } from "@/lib/credits";
import { verifyApiRequest } from "@/lib/api-auth";

/**
 * GET /api/v1/credits/balance
 * Returns the authenticated user's current microcredit balance.
 */
export async function GET(request: Request) {
  const authResult = await verifyApiRequest(request);
  if ("error" in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  const { userId, rateLimitHeaders } = authResult;

  try {
    const balance = await getOrCreateBalance(userId);
    return NextResponse.json({ balance }, { headers: rateLimitHeaders });
  } catch (error) {
    console.error("GET /api/v1/credits/balance error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: rateLimitHeaders }
    );
  }
}
