import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * DELETE /api/keys/:id
 * Revokes/deletes an API key.
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
    const keyRecord = await prisma.apiKey.findUnique({
      where: { id },
    });

    if (!keyRecord || keyRecord.userId !== userId) {
      return NextResponse.json({ error: "API key not found" }, { status: 404 });
    }

    const rootKey = process.env.UNKEY_ROOT_KEY;
    const apiId = process.env.UNKEY_API_ID;
    const isUnkeyConfigured = !!(rootKey && apiId);

    // If Unkey is configured and this is NOT a mock key, delete it in Unkey
    if (isUnkeyConfigured && !keyRecord.keyId.startsWith("gx_mock_") && !keyRecord.maskedKey.startsWith("gx_mock_")) {
      try {
        const { Unkey } = await import("@unkey/api");
        const unkey = new Unkey({ rootKey });
        await unkey.keys.deleteKey({ keyId: keyRecord.keyId });
      } catch (unkeyErr) {
        console.error("[DELETE /api/keys/:id] Failed to contact Unkey:", unkeyErr);
      }
    }

    // Always delete the local DB record
    await prisma.apiKey.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/keys/:id error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
