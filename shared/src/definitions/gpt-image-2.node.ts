import { z } from "zod";
import { STUB_DEMO_IMAGE_URL } from "../stub-demo-urls";
import { NodeDefinition } from "../types/node.types";

export const gptImage2InputSchema = z.object({
  prompt: z.string({ required_error: "Prompt is required" }).min(1, "Prompt is required"),
  uploadedImages: z.array(z.string()).min(1, "At least one input image is required").optional().nullable(),
  size: z.enum(["auto", "1024x1024", "1536x1024", "1024x1536", "2048x2048", "2048x1152", "3840x2160", "2160x3840"]).optional(),
  quality: z.enum(["high", "medium", "low"]).optional(),
  n: z.enum(["1", "2", "3", "4"]).optional(),
  background: z.enum(["auto", "opaque"]).optional(),
  output_format: z.enum(["PNG", "JPEG", "WebP"]).optional(),
});

export const gptImage2OutputSchema = z.object({
  result: z.string().url(),
});

export const gptImage2Definition: NodeDefinition = {
  type: "gptImage2",
  name: "GPT Image 2",
  description: "OpenAI's newest image model with any-resolution support and improved quality",
  category: "image",
  icon: "Sparkles",
  color: "purple",
  credits: {
    base: 210000, // ~0.21M microcredits
  },
  inputs: [
    // ── Both tabs ─────────────────────────────────────────────────────────
    {
      key: "prompt",
      label: "Prompt",
      type: "textarea",
      required: true,
      group: "primary",
      handle: {
        type: "text",
        color: "#f59e0b",
      },
    },
    // ── Image-to-Image tab (inserted here so it renders right after prompt) ─
    {
      key: "uploadedImages",
      label: "Input Images",
      type: "image-array",
      required: true,
      group: "image-mode",
      tooltip: "Max 10 images",
      handle: {
        type: "image",
        color: "#3b82f6",
      },
    },
    {
      key: "size",
      label: "Size",
      type: "select",
      group: "primary",
      defaultValue: "auto",
      options: [
        { label: "Auto", value: "auto" },
        { label: "1024x1024", value: "1024x1024" },
        { label: "1536x1024", value: "1536x1024" },
        { label: "1024x1536", value: "1024x1536" },
        { label: "2048x2048", value: "2048x2048" },
        { label: "2048x1152", value: "2048x1152" },
        { label: "3840x2160", value: "3840x2160" },
        { label: "2160x3840", value: "2160x3840" },
      ],
      handle: {
        type: "text",
        color: "#f59e0b",
      },
    },
    {
      key: "quality",
      label: "Quality",
      type: "select",
      group: "primary",
      defaultValue: "high",
      options: [
        { label: "High", value: "high" },
        { label: "Medium", value: "medium" },
        { label: "Low", value: "low" },
      ],
      handle: {
        type: "text",
        color: "#f59e0b",
      },
    },
    {
      key: "n",
      label: "Number of Images",
      type: "select",
      group: "primary",
      defaultValue: "1",
      options: [
        { label: "1", value: "1" },
        { label: "2", value: "2" },
        { label: "3", value: "3" },
        { label: "4", value: "4" },
      ],
      handle: {
        type: "text",
        color: "#ec4899",
      },
    },
    // ── Settings (collapsible) ─────────────────────────────────────────────
    {
      key: "background",
      label: "Background",
      type: "select",
      group: "advanced",
      defaultValue: "auto",
      options: [
        { label: "Auto", value: "auto" },
        { label: "Opaque", value: "opaque" },
      ],
      handle: {
        type: "text",
        color: "#f59e0b",
      },
    },
    {
      key: "output_format",
      label: "Output Format",
      type: "select",
      group: "advanced",
      defaultValue: "PNG",
      options: [
        { label: "PNG", value: "PNG" },
        { label: "JPEG", value: "JPEG" },
        { label: "WebP", value: "WebP" },
      ],
      handle: {
        type: "text",
        color: "#f59e0b",
      },
    },
  ],
  outputs: [
    {
      key: "result",
      label: "Generated Images",
      type: "image",
      handle: {
        type: "image",
        color: "#3b82f6",
      },
    },
  ],
  limits: {
    prompt: { maxLength: 4000 },
    uploadedImages: { mediaKind: "image", maxCount: 10, maxSizeMb: 15, maxWidth: 4096, maxHeight: 4096 },
  },
  inputSchema: gptImage2InputSchema,
  outputSchema: gptImage2OutputSchema,
  retryPerProvider: 1,
  providers: [
    {
      id: "gpt-image-webhook",
      kind: "webhook-sim",
      nodeType: "gptImage2",
      delaySeconds: 10,
      tokenTimeout: "5m",
    },
    {
      id: "backup-stub",
      kind: "stub",
      stubDelaySeconds: 2,
      stubUrl: STUB_DEMO_IMAGE_URL,
    },
  ],
};
