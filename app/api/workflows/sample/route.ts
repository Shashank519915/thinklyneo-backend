/**
 * @fileoverview “Load sample” API: provisions or repairs the bundled marketing demo workflow graph.
 */

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const SAMPLE_WORKFLOW_NAME = "Product Marketing Post Generator";

/** Missing any of these ⇒ graph was wiped or truncated; re-seed from the template on "Load sample". */
const SAMPLE_REQUIRED_NODE_IDS = [
  "request-inputs",
  "crop-1",
  "crop-2",
  "gemini-1",
  "gemini-2",
  "gemini-final",
  "response",
] as const;

/** Returns whether stored nodes still contain every canonical sample node id (detects truncation). */
function isSampleGraphIntact(nodes: unknown): boolean {
  if (!Array.isArray(nodes)) return false;
  const ids = new Set(
    nodes.map((n) =>
      typeof n === "object" && n !== null && "id" in n ? String((n as { id: unknown }).id) : "",
    ),
  );
  return SAMPLE_REQUIRED_NODE_IDS.every((id) => ids.has(id));
}

const SAMPLE_NODES = [
  {
    id: "request-inputs",
    type: "requestInputs",
    position: { x: 50, y: 200 },
    data: {
      label: "Request-Inputs",
      fields: [
        {
          id: "field_text_1",
          type: "text_field",
          label: "text_field",
          value:
            "Product: Wireless Bluetooth Headphones. Features: Noise cancellation, 30-hour battery, foldable design.",
        },
        {
          id: "field_image_1",
          type: "image_field",
          label: "image_field",
          value: null,
        },
      ],
    },
  },
  {
    id: "crop-1",
    type: "cropImage",
    position: { x: 480, y: 80 },
    data: {
      label: "Crop Image #1",
      inputs: { inputImage: null, x: 20, y: 20, w: 60, h: 60 },
      output: null,
    },
  },
  {
    id: "crop-2",
    type: "cropImage",
    position: { x: 480, y: 340 },
    data: {
      label: "Crop Image #2",
      inputs: { inputImage: null, x: 0, y: 0, w: 100, h: 50 },
      output: null,
    },
  },
  {
    id: "gemini-1",
    type: "openRouter",
    position: { x: 480, y: 600 },
    data: {
      label: "OpenRouter LLM #1",
      inputs: {
        prompt: null,
        systemPrompt:
          "You are a marketing copywriter. Write a one-paragraph product description based on the product details provided.",
        images: [],
        video: null,
        audio: null,
        file: null,
        temperature: 1.0,
        maxTokens: 2048,
        topP: 0.95,
      },
      output: null,
    },
  },
  {
    id: "gemini-2",
    type: "openRouter",
    position: { x: 860, y: 380 },
    data: {
      label: "OpenRouter LLM #2",
      inputs: {
        prompt: null,
        systemPrompt:
          "Condense the following product description into a tweet-length hook (under 240 characters).",
        images: [],
        video: null,
        audio: null,
        file: null,
        temperature: 1.0,
        maxTokens: 2048,
        topP: 0.95,
      },
      output: null,
    },
  },
  {
    id: "gemini-final",
    type: "openRouter",
    position: { x: 1200, y: 220 },
    data: {
      label: "Final OpenRouter LLM",
      inputs: {
        prompt: null,
        systemPrompt:
          "You are a social media manager. Given a tweet-length hook and one or two cropped product images, write a final engaging social media marketing post ready to publish.",
        images: [],
        video: null,
        audio: null,
        file: null,
        temperature: 1.0,
        maxTokens: 2048,
        topP: 0.95,
      },
      output: null,
    },
  },
  {
    id: "response",
    type: "response",
    position: { x: 1560, y: 220 },
    data: {
      label: "Output",
      results: [{ id: "result", label: "Final Post", value: null }],
    },
  },
];

const SAMPLE_EDGES = [
  {
    id: "edge-ri-image-crop1",
    source: "request-inputs",
    target: "crop-1",
    sourceHandle: "field_image_1",
    targetHandle: "in:inputImage",
    type: "animatedEdge",
    data: { color: "#F97316" },
    markerEnd: { type: "arrowclosed", color: "#F97316", width: 16, height: 16 },
  },
  {
    id: "edge-ri-image-crop2",
    source: "request-inputs",
    target: "crop-2",
    sourceHandle: "field_image_1",
    targetHandle: "in:inputImage",
    type: "animatedEdge",
    data: { color: "#F97316" },
    markerEnd: { type: "arrowclosed", color: "#F97316", width: 16, height: 16 },
  },
  {
    id: "edge-ri-text-gemini1",
    source: "request-inputs",
    target: "gemini-1",
    sourceHandle: "field_text_1",
    targetHandle: "in:prompt",
    type: "animatedEdge",
    data: { color: "#F59E0B" },
    markerEnd: { type: "arrowclosed", color: "#F59E0B", width: 16, height: 16 },
  },
  {
    id: "edge-gemini1-gemini2",
    source: "gemini-1",
    target: "gemini-2",
    sourceHandle: "out:response",
    targetHandle: "in:prompt",
    type: "animatedEdge",
    data: { color: "#3B82F6" },
    markerEnd: { type: "arrowclosed", color: "#3B82F6", width: 16, height: 16 },
  },
  {
    id: "edge-crop1-geminifinal",
    source: "crop-1",
    target: "gemini-final",
    sourceHandle: "out:outputImage",
    targetHandle: "in:images",
    type: "animatedEdge",
    data: { color: "#F97316" },
    markerEnd: { type: "arrowclosed", color: "#F97316", width: 16, height: 16 },
  },
  {
    id: "edge-crop2-geminifinal",
    source: "crop-2",
    target: "gemini-final",
    sourceHandle: "out:outputImage",
    targetHandle: "in:images",
    type: "animatedEdge",
    data: { color: "#F97316" },
    markerEnd: { type: "arrowclosed", color: "#F97316", width: 16, height: 16 },
  },
  {
    id: "edge-gemini2-geminifinal",
    source: "gemini-2",
    target: "gemini-final",
    sourceHandle: "out:response",
    targetHandle: "in:prompt",
    type: "animatedEdge",
    data: { color: "#3B82F6" },
    markerEnd: { type: "arrowclosed", color: "#3B82F6", width: 16, height: 16 },
  },
  {
    id: "edge-geminifinal-response",
    source: "gemini-final",
    target: "response",
    sourceHandle: "out:response",
    targetHandle: "result",
    type: "animatedEdge",
    data: { color: "#3B82F6" },
    markerEnd: { type: "arrowclosed", color: "#3B82F6", width: 16, height: 16 },
  },
];

/**
 * Upserts `"Product Marketing Post Generator"` workflow; rewires truncated graphs from `SAMPLE_*` constants.
 *
 * NOTE: Repairs when `isSampleGraphIntact` fails so “Load sample” always restores full reference topology.
 */
export async function POST() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Check if user already has any workflows
    await prisma.user.upsert({
      where: { id: userId },
      update: {},
      create: { id: userId },
    });

    const existing = await prisma.workflow.findFirst({
      where: { userId, name: SAMPLE_WORKFLOW_NAME },
      select: { id: true, nodes: true },
    });

    if (existing) {
      if (!isSampleGraphIntact(existing.nodes)) {
        const repaired = await prisma.workflow.update({
          where: { id: existing.id },
          data: {
            description:
              "Crops a product image, writes a description and tweet hook with Gemini, then combines them into a final social media marketing post.",
            nodes: SAMPLE_NODES as unknown as Parameters<
              typeof prisma.workflow.update
            >[0]["data"]["nodes"],
            edges: SAMPLE_EDGES as unknown as Parameters<
              typeof prisma.workflow.update
            >[0]["data"]["edges"],
          },
        });
        return NextResponse.json({ data: repaired });
      }
      const full = await prisma.workflow.findUnique({ where: { id: existing.id } });
      return NextResponse.json({ data: full ?? existing });
    }

    const workflow = await prisma.workflow.create({
      data: {
        userId,
        name: SAMPLE_WORKFLOW_NAME,
        description:
          "Crops a product image, writes a description and tweet hook with Gemini, then combines them into a final social media marketing post.",
        nodes: SAMPLE_NODES as unknown as Parameters<typeof prisma.workflow.create>[0]["data"]["nodes"],
        edges: SAMPLE_EDGES as unknown as Parameters<typeof prisma.workflow.create>[0]["data"]["edges"],
        status: "idle",
      },
    });

    return NextResponse.json({ data: workflow });
  } catch (error) {
    console.error("POST /api/workflows/sample error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
