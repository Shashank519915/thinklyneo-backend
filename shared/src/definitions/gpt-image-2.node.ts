import { z } from "zod";
import { NodeDefinition } from "../types/node.types";

export const gptImage2InputSchema = z.object({
  prompt: z.string({ required_error: "Prompt is required" }).min(1, "Prompt is required"),
  inputImage: z.string().nullable().optional(),
  size: z.enum(["auto", "1024x1024", "512x512"]).optional(),
  quality: z.enum(["high", "standard"]).optional(),
  n: z.enum(["1", "2", "3", "4"]).optional(),
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
    base: 210000, // Matches the reference ~0.21M microcredits
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
      key: "inputImage",
      label: "Input Image (Image-to-Image)",
      type: "file-upload",
      group: "primary",
      handle: {
        type: "image",
        color: "#F97316",
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
        { label: "512x512", value: "512x512" },
      ],
      handle: {
        type: "text",
        color: "#F59E0B",
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
        { label: "Standard", value: "standard" },
      ],
      handle: {
        type: "text",
        color: "#F59E0B",
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
        color: "#EC4899",
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
