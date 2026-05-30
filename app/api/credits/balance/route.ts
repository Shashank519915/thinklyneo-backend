/**
 * @fileoverview API route to fetch the authenticated user's current microcredit balance.
 */

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getOrCreateBalance } from "@/lib/credits";

export const maxDuration = 60; // Mitigate Vercel 10s timeout on cold starts

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const balance = await getOrCreateBalance(userId);
    return NextResponse.json({ balance });
  } catch (error: any) {
    console.error("GET /api/credits/balance error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
