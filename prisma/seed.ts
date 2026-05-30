/**
 * @fileoverview Seeds Prisma demo user + deterministic marketing workflow mirroring onboarding sample graphs.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const SEED_USER_ID = "seed_user_demo";

const sampleNodes = [
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
      inputs: {
        inputImage: null,
        x: 20,
        y: 20,
        w: 60,
        h: 60,
      },
      output: null,
    },
  },
  {
    id: "crop-2",
    type: "cropImage",
    position: { x: 480, y: 340 },
    data: {
      label: "Crop Image #2",
      inputs: {
        inputImage: null,
        x: 0,
        y: 0,
        w: 100,
        h: 50,
      },
      output: null,
    },
  },
  {
    id: "gemini-1",
    type: "gemini",
    position: { x: 480, y: 600 },
    data: {
      label: "Gemini #1",
      model: "gemini-2.5-flash",
      inputs: {
        prompt: null,
        systemPrompt:
          "You are a marketing copywriter. Write a one-paragraph product description.",
        images: [],
        temperature: 1.0,
        maxTokens: 2048,
        topP: 0.95,
      },
      output: null,
    },
  },
  {
    id: "gemini-2",
    type: "gemini",
    position: { x: 860, y: 380 },
    data: {
      label: "Gemini #2",
      model: "gemini-2.5-flash",
      inputs: {
        prompt: null,
        systemPrompt:
          "Condense the following product description into a tweet-length hook (under 240 characters).",
        images: [],
        temperature: 1.0,
        maxTokens: 2048,
        topP: 0.95,
      },
      output: null,
    },
  },
  {
    id: "gemini-final",
    type: "gemini",
    position: { x: 1200, y: 220 },
    data: {
      label: "Final Gemini",
      model: "gemini-2.5-flash",
      inputs: {
        prompt: null,
        systemPrompt:
          "You are a social media manager. Combine the tweet hook and the two product crops into a final marketing post.",
        images: [],
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

const sampleEdges = [
  {
    id: "edge-ri-image-crop1",
    source: "request-inputs",
    target: "crop-1",
    sourceHandle: "field_image_1",
    targetHandle: "in:inputImage",
    type: "animatedEdge",
  },
  {
    id: "edge-ri-image-crop2",
    source: "request-inputs",
    target: "crop-2",
    sourceHandle: "field_image_1",
    targetHandle: "in:inputImage",
    type: "animatedEdge",
  },
  {
    id: "edge-ri-text-gemini1",
    source: "request-inputs",
    target: "gemini-1",
    sourceHandle: "field_text_1",
    targetHandle: "in:prompt",
    type: "animatedEdge",
  },
  {
    id: "edge-gemini1-gemini2",
    source: "gemini-1",
    target: "gemini-2",
    sourceHandle: "out:response",
    targetHandle: "in:prompt",
    type: "animatedEdge",
  },
  {
    id: "edge-crop1-geminifinal",
    source: "crop-1",
    target: "gemini-final",
    sourceHandle: "out:outputImage",
    targetHandle: "in:images",
    type: "animatedEdge",
  },
  {
    id: "edge-crop2-geminifinal",
    source: "crop-2",
    target: "gemini-final",
    sourceHandle: "out:outputImage",
    targetHandle: "in:images",
    type: "animatedEdge",
  },
  {
    id: "edge-gemini2-geminifinal",
    source: "gemini-2",
    target: "gemini-final",
    sourceHandle: "out:response",
    targetHandle: "in:prompt",
    type: "animatedEdge",
  },
  {
    id: "edge-geminifinal-response",
    source: "gemini-final",
    target: "response",
    sourceHandle: "out:response",
    targetHandle: "result",
    type: "animatedEdge",
  },
];

/** Upserts synthetic demo account (`SEED_USER_ID`) and lazily inserts the bundled workflow when absent. */
async function main() {
  console.log("Seeding database...");

  // Upsert seed user
  await prisma.user.upsert({
    where: { id: SEED_USER_ID },
    update: {},
    create: { id: SEED_USER_ID },
  });

  // Create sample workflow
  const existing = await prisma.workflow.findFirst({
    where: {
      userId: SEED_USER_ID,
      name: "AI Racing Car Generator",
    },
  });

  if (!existing) {
    await prisma.workflow.create({
      data: {
        userId: SEED_USER_ID,
        name: "AI Racing Car Generator",
        description:
          "Generate marketing content for products using AI image processing and text generation",
        nodes: sampleNodes,
        edges: sampleEdges,
        status: "idle",
      },
    });
    console.log("Sample workflow created.");
  } else {
    console.log("Sample workflow already exists, skipping.");
  }

  console.log("Seeding complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
