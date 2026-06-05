import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  buildUnkeyRatelimits,
  toUnkeyExpires,
} from "@/lib/unkey-api-keys";
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
    const existingCount = await prisma.apiKey.count({ where: { userId } });
    if (existingCount >= 10) {
      return NextResponse.json(
        { error: "Maximum of 10 API keys allowed" },
        { status: 400 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const name = (typeof body.name === "string" && body.name.trim()) || "Default";
    const rateLimitPerMin = Number(body.rateLimitPerMin ?? body.rateLimit ?? 60);
    const rateLimitPerDay = Number(body.rateLimitPerDay ?? 1000);
    const expiresAt =
      body.expiresAt && typeof body.expiresAt === "string"
        ? new Date(body.expiresAt)
        : null;

    if (!Number.isFinite(rateLimitPerMin) || rateLimitPerMin < 1 || rateLimitPerMin > 60) {
      return NextResponse.json({ error: "Per-minute limit must be 1–60" }, { status: 400 });
    }
    if (!Number.isFinite(rateLimitPerDay) || rateLimitPerDay < 1) {
      return NextResponse.json({ error: "Per-day limit must be at least 1" }, { status: 400 });
    }
    if (expiresAt && Number.isNaN(expiresAt.getTime())) {
      return NextResponse.json({ error: "Invalid expiration date" }, { status: 400 });
    }

    const rateLimit = Math.floor(rateLimitPerMin);

    const rootKey = process.env.UNKEY_ROOT_KEY;
    const apiId = process.env.UNKEY_API_ID || process.env.UNKEY_API_KEY;
    const isUnkeyConfigured = !!(rootKey && apiId);

    let keyString = "";
    let keyId = "";
    let maskedKey = "";

    if (isUnkeyConfigured) {
      try {
        const { Unkey } = await import("@unkey/api");
        const unkey = new Unkey({ rootKey });
        const createResp = await unkey.keys.createKey({
          apiId,
          name,
          prefix: "gx",
          externalId: userId,
          ...(expiresAt && !Number.isNaN(expiresAt.getTime())
            ? { expires: toUnkeyExpires(expiresAt) }
            : {}),
          ratelimits: buildUnkeyRatelimits(
            rateLimit,
            Math.floor(rateLimitPerDay)
          ),
        });

        if (createResp.data) {
          keyString = createResp.data.key;
          keyId = createResp.data.keyId;
          maskedKey = `gx_...${keyString.slice(-4)}`;
        }
      } catch (unkeyErr: any) {
        console.warn("[POST /api/keys] Unkey API crashed/failed, falling back to local mock key generation:", unkeyErr);
      }
    }

    // Fallback: If Unkey was unconfigured OR if the Unkey call failed/timed out
    if (!keyString) {
      const randToken = crypto.randomBytes(16).toString("hex");
      keyString = `gx_mock_${randToken}`;
      keyId = crypto.createHash("sha256").update(keyString).digest("hex");
      maskedKey = `gx_mock_...${keyString.slice(-4)}`;
    }

    const keyRecord = await prisma.apiKey.create({
      data: {
        userId,
        name,
        keyId,
        maskedKey,
        rateLimitPerMin: rateLimit,
        rateLimitPerDay: Math.floor(rateLimitPerDay),
        expiresAt: expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt : null,
      },
    });

    return NextResponse.json({
      data: {
        id: keyRecord.id,
        name: keyRecord.name,
        maskedKey: keyRecord.maskedKey,
        rateLimitPerMin: keyRecord.rateLimitPerMin,
        rateLimitPerDay: keyRecord.rateLimitPerDay,
        expiresAt: keyRecord.expiresAt,
        createdAt: keyRecord.createdAt,
        key: keyString,
      },
    }, { status: 201 });
  } catch (error) {
    console.error("POST /api/keys error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
