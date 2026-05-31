import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import crypto from "crypto";

/**
 * GET /api/keys
 * Lists user's registered API keys (masked).
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const keys = await prisma.apiKey.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ data: keys });
  } catch (error) {
    console.error("GET /api/keys error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/keys
 * Generates a new API key via Unkey (or mock local fallback) and records it in DB.
 */
export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const name = body.name || "Default Key";
    const rateLimit = body.rateLimit || 60; // Requests per minute

    const rootKey = process.env.UNKEY_ROOT_KEY;
    const apiId = process.env.UNKEY_API_ID;
    const isUnkeyConfigured = !!(rootKey && apiId);

    let keyString = "";
    let keyId = "";
    let maskedKey = "";

    if (isUnkeyConfigured) {
      try {
        const createResp = await fetch("https://api.unkey.dev/v1/keys.createKey", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${rootKey}`,
          },
          body: JSON.stringify({
            apiId,
            ownerId: userId,
            prefix: "gx",
            name,
            ratelimit: {
              type: "fast",
              limit: rateLimit,
              refillRate: rateLimit,
              refillInterval: 60000,
            },
          }),
        });

        if (!createResp.ok) {
          const errText = await createResp.text();
          console.error("[POST /api/keys] Unkey create error response:", errText);
          return NextResponse.json({ error: "Failed to create API key in Unkey" }, { status: 400 });
        }

        const resultJson = await createResp.json();
        keyString = resultJson.key;
        keyId = resultJson.keyId;
        maskedKey = `gx_...${keyString.slice(-4)}`;
      } catch (unkeyErr: any) {
        console.error("[POST /api/keys] Unkey API crash:", unkeyErr);
        return NextResponse.json({ error: unkeyErr.message || "Failed to create API key in Unkey" }, { status: 500 });
      }
    } else {
      // Mock local mode: generate a secure random key
      const randToken = crypto.randomBytes(16).toString("hex");
      keyString = `gx_mock_${randToken}`;
      // SHA-256 hash the token to serve as the DB unique keyId lookup index
      keyId = crypto.createHash("sha256").update(keyString).digest("hex");
      maskedKey = `gx_mock_...${keyString.slice(-4)}`;
    }

    const keyRecord = await prisma.apiKey.create({
      data: {
        userId,
        name,
        keyId,
        maskedKey,
      },
    });

    return NextResponse.json({
      data: {
        id: keyRecord.id,
        name: keyRecord.name,
        maskedKey: keyRecord.maskedKey,
        createdAt: keyRecord.createdAt,
        key: keyString, // Only return keyString ONCE on creation!
      },
    }, { status: 201 });
  } catch (error) {
    console.error("POST /api/keys error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
