import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  deleteUnkeyKey,
  isUnkeyManagedKey,
  syncUnkeyKeyUpdate,
} from "@/lib/unkey-api-keys";

const MAX_KEYS_PER_USER = 10;

async function getOwnedKey(id: string, userId: string) {
  const keyRecord = await prisma.apiKey.findUnique({ where: { id } });
  if (!keyRecord || keyRecord.userId !== userId) return null;
  return keyRecord;
}

/**
 * PATCH /api/keys/:id
 * Update label, rate limits, or expiration.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const keyRecord = await getOwnedKey(id, userId);
    if (!keyRecord) {
      return NextResponse.json({ error: "API key not found" }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const data: {
      name?: string;
      rateLimitPerMin?: number;
      rateLimitPerDay?: number;
      expiresAt?: Date | null;
    } = {};

    if (typeof body.name === "string") {
      const trimmed = body.name.trim();
      if (!trimmed || trimmed.length > 64) {
        return NextResponse.json({ error: "Invalid key name" }, { status: 400 });
      }
      data.name = trimmed;
    }

    if (body.rateLimitPerMin != null) {
      const perMin = Number(body.rateLimitPerMin);
      if (!Number.isFinite(perMin) || perMin < 1 || perMin > 60) {
        return NextResponse.json({ error: "Per-minute limit must be 1–60" }, { status: 400 });
      }
      data.rateLimitPerMin = Math.floor(perMin);
    }

    if (body.rateLimitPerDay != null) {
      const perDay = Number(body.rateLimitPerDay);
      if (!Number.isFinite(perDay) || perDay < 1) {
        return NextResponse.json({ error: "Per-day limit must be at least 1" }, { status: 400 });
      }
      data.rateLimitPerDay = Math.floor(perDay);
    }

    if (body.expiresAt !== undefined) {
      if (body.expiresAt === null || body.expiresAt === "") {
        data.expiresAt = null;
      } else {
        const parsed = new Date(body.expiresAt);
        if (Number.isNaN(parsed.getTime())) {
          return NextResponse.json({ error: "Invalid expiration date" }, { status: 400 });
        }
        data.expiresAt = parsed;
      }
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const updated = await prisma.apiKey.update({
      where: { id },
      data,
    });

    await syncUnkeyKeyUpdate(keyRecord, data);

    return NextResponse.json({ data: updated });
  } catch (error) {
    console.error("PATCH /api/keys/:id error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * DELETE /api/keys/:id
 * Revokes/deletes an API key (Unkey soft-delete + local DB row).
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const keyRecord = await getOwnedKey(id, userId);
    if (!keyRecord) {
      return NextResponse.json({ error: "API key not found" }, { status: 404 });
    }

    if (isUnkeyManagedKey(keyRecord) && process.env.UNKEY_ROOT_KEY) {
      try {
        await deleteUnkeyKey(keyRecord.keyId);
      } catch (unkeyErr) {
        console.error("[DELETE /api/keys/:id] Unkey deleteKey failed:", unkeyErr);
      }
    }

    await prisma.apiKey.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/keys/:id error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export { MAX_KEYS_PER_USER };
