import { z } from "zod";
import { NodeDefinition } from "../types/node.types";

export const gptImage2InputSchema = z.object({
  prompt: z.string({ required_error: "Prompt is required" }).min(1, "Prompt is required"),
  negativePrompt: z.string().nullable().optional(),
  aspectRatio: z.enum(["1:1", "16:9", "9:16"]).optional(),
});

export const gptImage2OutputSchema = z.object({
  outputImage: z.string().url(),
});

export const gptImage2Definition: NodeDefinition = {
  type: "gptImage2",
  name: "GPT-Image-2",
  category: "image",
  icon: "Sparkles",
  color: "purple",
  credits: {
    base: 750000, // 0.75M microcredits
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
        color: "#3B82F6",
      },
    },
    {
      key: "negativePrompt",
      label: "Negative Prompt",
      type: "textarea",
      group: "advanced",
      defaultValue: "",
      handle: {
        type: "text",
        color: "#3B82F6",
      },
    },
    {
      key: "aspectRatio",
      label: "Aspect Ratio",
      type: "select",
      group: "advanced",
      defaultValue: "1:1",
      options: [
        { label: "1:1 Square", value: "1:1" },
        { label: "16:9 Widescreen", value: "16:9" },
        { label: "9:16 Portrait", value: "9:16" },
      ],
    },
  ],
  outputs: [
    {
      key: "outputImage",
      label: "Output Image",
      type: "image",
      handle: {
        type: "image",
        color: "#F97316",
      },
    },
  ],
  inputSchema: gptImage2InputSchema,
  outputSchema: gptImage2OutputSchema,
};
