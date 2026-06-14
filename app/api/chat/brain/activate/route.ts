import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { blueprintSchema } from "@/lib/chat/blueprint";
import { validateBlueprintGraph } from "@/lib/chat/blueprint-validate";
import { guardChatRequest } from "@/lib/chat/guard";
import { parseChatJsonBody } from "@/lib/chat/request-body";

const activateSchema = z.object({
  thinklyChatId: z.string().min(1),
  title: z.string().optional(),
  force: z.boolean().optional(),
});

/** POST /api/chat/brain/activate — Thinkly Blueprint → Brain chat (validated) */
export async function POST(request: Request) {
  const guard = await guardChatRequest({ requireLlm: false });
  if (guard instanceof NextResponse) return guard;
  const { userId } = guard;

  const parsedBody = await parseChatJsonBody(request);
  if (!parsedBody.ok) return parsedBody.response;

  const parsed = activateSchema.safeParse(parsedBody.body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 });
  }

  const thinklyChat = await prisma.chat.findFirst({
    where: { id: parsed.data.thinklyChatId, userId, kind: "thinkly" },
  });
  if (!thinklyChat?.blueprint) {
    return NextResponse.json({ error: "No blueprint on Thinkly chat" }, { status: 400 });
  }

  const existingBrain = await prisma.chat.findFirst({
    where: {
      userId,
      kind: "brain",
      activatedFromChatId: parsed.data.thinklyChatId,
    },
  });
  if (existingBrain) {
    return NextResponse.json({
      data: existingBrain,
      validation: { valid: true, issues: [], reused: true },
    });
  }

  const blueprintParsed = blueprintSchema.safeParse(thinklyChat.blueprint);
  if (!blueprintParsed.success) {
    return NextResponse.json({ error: "Blueprint invalid", issues: blueprintParsed.error.issues }, { status: 400 });
  }

  const validation = validateBlueprintGraph(
    blueprintParsed.data,
    blueprintParsed.data.openQuestions,
  );

  if (!validation.valid && !parsed.data.force) {
    return NextResponse.json(
      {
        error: "Blueprint graph validation failed",
        issues: validation.issues,
        openQuestions: validation.annotatedOpenQuestions,
      },
      { status: 422 },
    );
  }

  const resolvedBlueprint = {
    ...blueprintParsed.data,
    openQuestions: validation.annotatedOpenQuestions,
    confidence: validation.valid ? blueprintParsed.data.confidence : "draft",
  };

  const title =
    parsed.data.title?.trim() ||
    blueprintParsed.data.title ||
    "Brain workflow";

  const brainChat = await prisma.chat.create({
    data: {
      userId,
      kind: "brain",
      title,
      activatedFromChatId: parsed.data.thinklyChatId,
      blueprintSource: thinklyChat.blueprint as object,
      blueprint: resolvedBlueprint as object,
    },
  });

  return NextResponse.json(
    {
      data: brainChat,
      validation: {
        valid: validation.valid,
        issues: validation.issues,
      },
    },
    { status: 201 },
  );
}
