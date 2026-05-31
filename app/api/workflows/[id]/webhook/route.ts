import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import crypto from "crypto";

/**
 * POST /api/workflows/:id/webhook
 * Sets or updates the outbound webhook URL and auto-generates/reveals the signing secret.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const body = await request.json().catch(() => ({}));
    const { webhookUrl } = body;

    // Verify ownership
    const workflow = await prisma.workflow.findUnique({
      where: { id, userId },
      select: { webhookSecret: true },
    });

    if (!workflow) {
      return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
    }

    let nextUrl: string | null = null;
    let nextSecret: string | null = null;

    if (webhookUrl && webhookUrl.trim() !== "") {
      const trimmedUrl = webhookUrl.trim();
      // Simple url check
      if (!trimmedUrl.startsWith("http://") && !trimmedUrl.startsWith("https://")) {
        return NextResponse.json({ error: "Invalid webhook URL. Must start with http:// or https://" }, { status: 400 });
      }
      nextUrl = trimmedUrl;
      // Keep existing secret, or generate a new whsec_ secret if empty
      nextSecret = workflow.webhookSecret || `whsec_${crypto.randomBytes(16).toString("hex")}`;
    }

    const updated = await prisma.workflow.update({
      where: { id },
      data: {
        webhookUrl: nextUrl,
        webhookSecret: nextSecret,
      },
      select: {
        id: true,
        webhookUrl: true,
        webhookSecret: true,
      },
    });

    return NextResponse.json({ data: updated });
  } catch (error) {
    console.error("POST /api/workflows/[id]/webhook error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
