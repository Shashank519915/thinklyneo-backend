import { z } from "zod";
import { STUB_DEMO_VIDEO_MP4_URL } from "../stub-demo-urls";
import { NodeDefinition } from "../types/node.types";

const klingElementSchema = z.object({
  frontal_image_url: z.string().min(1, "Frontal image is required"),
  reference_image_urls: z.array(z.string()).min(1).max(3).optional(),
  video_url: z.string().optional(),
});

export const klingV3InputSchema = z.object({
  // Text-to-video fields
  prompt: z.string().optional(),
  aspect_ratio: z.enum(["16:9", "9:16", "1:1"]).optional(),
  // Image-to-video fields
  start_image_url: z.string().optional(),
  end_image_url: z.string().optional(),
  elements: z.array(klingElementSchema).optional(),
  // Shared fields
  duration: z.string().optional(),
  negative_prompt: z.string().optional(),
  // Settings
  cfg_scale: z.number().min(0).max(1).optional(),
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
    // ── Text-to-Video fields ─────────────────────────────────────────────
    {
      key: "prompt",
      label: "Prompt",
      type: "textarea",
      placeholder: "Describe the video you want to generate...",
      group: "primary",
      handle: {
        type: "text",
        color: "#f59e0b",
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

    // ── Image-to-Video fields ────────────────────────────────────────────
    {
      key: "start_image_url",
      label: "Start Frame",
      type: "file-upload",
      required: true,
      group: "image-mode",
      uiVariant: "kling-image-upload",
      handle: {
        type: "image",
        color: "#3b82f6",
      },
    },
    {
      key: "description",
      label: "Description",
      type: "textarea",
      required: true,
      placeholder: "Describe the video scene you want to create...",
      group: "image-mode",
      handle: {
        type: "text",
        color: "#f59e0b",
      },
    },
    {
      key: "end_image_url",
      label: "End Frame",
      type: "file-upload",
      group: "image-mode",
      uiVariant: "kling-image-upload",
      handle: {
        type: "image",
        color: "#3b82f6",
      },
    },

    // ── Shared fields (shown in both tabs) ───────────────────────────────
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

    // ── Elements (image-to-video only) ───────────────────────────────────
    {
      key: "elements",
      label: "Elements",
      type: "element-array",
      group: "image-mode",
      tooltip: "Add character or object references to guide the video generation.",
      elementFields: [
        {
          key: "frontal_image_url",
          label: "Frontal Image",
          type: "file-upload-single",
          required: true,
          accept: "image/*",
          handle: { type: "image", color: "#3b82f6" },
        },
        {
          key: "reference_image_urls",
          label: "Reference Images",
          type: "file-upload-multi",
          required: true,
          accept: "image/*",
          maxCount: 3,
          uploadRequirements: "Max 3 images",
          handle: { type: "image", color: "#3b82f6" },
        },
        {
          key: "video_url",
          label: "Video Element",
          type: "file-upload-single",
          required: true,
          accept: "video/*",
          uploadRequirements: "Upload requirements",
          handle: { type: "video", color: "#22c55e" },
        },
      ],
    },

    // ── Settings (collapsible) ───────────────────────────────────────────
    {
      key: "cfg_scale",
      label: "CFG Scale",
      type: "slider",
      group: "settings",
      defaultValue: 0.5,
      min: 0,
      max: 1,
      step: 0.1,
      tooltip: "Controls how closely the video follows the prompt. Higher = more literal.",
      handle: {
        type: "text",
        color: "#ec4899",
      },
    },
    {
      key: "generate_audio",
      label: "Generate Audio",
      type: "boolean",
      defaultValue: true,
      group: "settings",
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
    description: { maxLength: 2500 },
    negative_prompt: { maxLength: 2500 },
    start_image_url: { mediaKind: "image", maxSizeMb: 15, maxWidth: 4096, maxHeight: 4096 },
    end_image_url: { mediaKind: "image", maxSizeMb: 15, maxWidth: 4096, maxHeight: 4096 },
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
