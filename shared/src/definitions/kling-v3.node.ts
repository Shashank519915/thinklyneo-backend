import { z } from "zod";
import { STUB_DEMO_VIDEO_MP4_URL } from "../stub-demo-urls";
import { NodeDefinition } from "../types/node.types";

export const klingV3InputSchema = z.object({
  prompt: z.string({ required_error: "Prompt is required" }).min(1, "Prompt is required"),
  inputImage: z.string().nullable().optional(),
  aspect_ratio: z.enum(["16:9", "9:16", "1:1"]).optional(),
  duration: z.number().min(3).max(15).optional(),
  negative_prompt: z.string().optional(),
  generate_audio: z.boolean().optional(),
});

export const klingV3OutputSchema = z.object({
  result: z.string().url(),
});

export const klingV3Definition: NodeDefinition = {
  type: "klingV3",
  name: "Kling v3 Pro",
  description: "Premium Kling v3 Pro model with top-tier video quality and advanced prompt adherence.",
  category: "video",
  icon: "Video",
  color: "red",
  credits: {
    base: 840000, // ~0.84M microcredits
  },
  inputs: [
    {
      key: "prompt",
      label: "Prompt",
      type: "textarea",
      required: true,
      placeholder: "Describe the video you want to generate...",
      group: "primary",
      handle: {
        type: "text",
        color: "#f59e0b",
      },
    },
    {
      key: "inputImage",
      label: "Input Image",
      type: "file-upload",
      group: "primary",
      handle: {
        type: "image",
        color: "#3b82f6",
      },
    },
    {
      key: "aspect_ratio",
      label: "Aspect Ratio",
      type: "select",
      group: "primary",
      defaultValue: "16:9",
      options: [
        { label: "16:9", value: "16:9" },
        { label: "9:16", value: "9:16" },
        { label: "1:1", value: "1:1" },
      ],
      handle: {
        type: "text",
        color: "#f59e0b",
      },
    },
    {
      key: "duration",
      label: "Duration",
      type: "select",
      group: "primary",
      defaultValue: "5",
      options: Array.from({ length: 13 }, (_, i) => {
        const v = String(i + 3);
        return { label: v, value: v };
      }),
      handle: {
        type: "text",
        color: "#ec4899",
      },
    },
    {
      key: "negative_prompt",
      label: "Negative Prompt",
      type: "textarea",
      placeholder: "Describe what you don't want in the video...",
      group: "primary",
      handle: {
        type: "text",
        color: "#f59e0b",
      },
    },
    {
      key: "generate_audio",
      label: "Generate Audio",
      type: "boolean",
      defaultValue: true,
      group: "primary",
      handle: {
        type: "text",
        color: "#6366f1",
      },
    },
  ],
  outputs: [
    {
      key: "result",
      label: "Generated Video",
      type: "video",
      handle: {
        type: "video",
        color: "#22c55e",
      },
    },
  ],
  limits: {
    prompt: { maxLength: 2500 },
    negative_prompt: { maxLength: 2500 },
    inputImage: { mediaKind: "image", maxSizeMb: 15, maxWidth: 4096, maxHeight: 4096 },
  },
  inputSchema: klingV3InputSchema,
  outputSchema: klingV3OutputSchema,
  retryPerProvider: 1,
  providers: [
    {
      id: "kling-webhook",
      kind: "webhook-sim",
      nodeType: "klingV3",
      delaySeconds: 12,
      tokenTimeout: "5m",
    },
    {
      id: "backup-stub",
      kind: "stub",
      stubDelaySeconds: 2,
      stubUrl: STUB_DEMO_VIDEO_MP4_URL,
    },
  ],
};
