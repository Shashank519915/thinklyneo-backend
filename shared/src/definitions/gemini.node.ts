import { z } from "zod";
import { NodeDefinition } from "../types/node.types";

export const geminiInputSchema = z.object({
  prompt: z.string({ required_error: "Prompt is required" }).min(1, "Prompt is required"),
  systemPrompt: z.string().nullable().optional(),
  images: z.array(z.string()).optional(),
  video: z.string().nullable().optional(),
  audio: z.string().nullable().optional(),
  file: z.string().nullable().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().min(1).max(8192).optional(),
  topP: z.number().min(0).max(1).optional(),
});

export const geminiOutputSchema = z.object({
  response: z.string(),
});

export const geminiDefinition: NodeDefinition = {
  type: "gemini",
  name: "Gemini",
  category: "text",
  icon: "Sparkles",
  color: "purple",
  credits: {
    base: 450000, // 0.45M microcredits
  },
  inputs: [
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
    {
      key: "systemPrompt",
      label: "System Prompt",
      type: "textarea",
      group: "advanced",
      defaultValue: "",
      handle: {
        type: "text",
        color: "#f59e0b",
      },
    },
    {
      key: "images",
      label: "Input Images",
      type: "image-array",
      group: "primary",
      handle: {
        type: "image",
        color: "#3b82f6",
      },
    },
    {
      key: "video",
      label: "Input Video",
      type: "file-upload",
      group: "primary",
      handle: {
        type: "video",
        color: "#22c55e",
      },
    },
    {
      key: "audio",
      label: "Input Audio",
      type: "file-upload",
      group: "primary",
      handle: {
        type: "audio",
        color: "#06b6d4",
      },
    },
    {
      key: "file",
      label: "Input Document",
      type: "file-upload",
      group: "primary",
      handle: {
        type: "file",
        color: "#a855f7",
      },
    },
    {
      key: "temperature",
      label: "Temperature",
      type: "slider",
      defaultValue: 1.0,
      min: 0.0,
      max: 2.0,
      step: 0.1,
      group: "advanced",
    },
    {
      key: "maxTokens",
      label: "Max Tokens",
      type: "number",
      defaultValue: 2048,
      min: 1,
      max: 8192,
      group: "advanced",
    },
    {
      key: "topP",
      label: "Top P",
      type: "slider",
      defaultValue: 0.95,
      min: 0.0,
      max: 1.0,
      step: 0.05,
      group: "advanced",
    },
  ],
  outputs: [
    {
      key: "response",
      label: "Response Text",
      type: "text",
      handle: {
        type: "text",
        color: "#f59e0b",
      },
    },
  ],
  inputSchema: geminiInputSchema,
  outputSchema: geminiOutputSchema,
  defaultTimeoutSeconds: 15,
  retryPerProvider: 1,
  providers: [
    {
      id: "main-openrouter",
      kind: "openrouter",
      timeoutSeconds: 15,
    },
    {
      id: "backup-stub",
      kind: "stub",
      stubDelaySeconds: 2,
      stubTextTemplate:
        '[Backup Provider Stub Response]\nThis is a fallback response because the primary OpenRouter provider failed or timed out.\n\nPrompt: "{{prompt}}"',
    },
  ],
};
