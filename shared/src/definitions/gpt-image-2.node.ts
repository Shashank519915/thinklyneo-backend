import { z } from "zod";
import { NodeDefinition } from "../types/node.types";

export const gptImage2InputSchema = z.object({
  prompt: z.string({ required_error: "Prompt is required" }).min(1, "Prompt is required"),
  uploadedImages: z.array(z.string()).min(1, "At least one input image is required").optional().nullable(),
  size: z.enum(["auto", "1024x1024", "512x512"]).optional(),
  quality: z.enum(["high", "standard"]).optional(),
  n: z.enum(["1", "2", "3", "4"]).optional(),
  background: z.enum(["auto", "transparent", "white", "black"]).optional(),
  output_format: z.enum(["PNG", "JPG", "WEBP"]).optional(),
});

export const gptImage2OutputSchema = z.object({
  result: z.string().url(),
});

export const gptImage2Definition: NodeDefinition = {
  type: "gptImage2",
  name: "GPT Image 2",
  category: "image",
  icon: "Sparkles",
  color: "purple",
  credits: {
    base: 210000, // Matches reference ~0.21M
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
        color: "#f59e0b", // Yellow
      },
    },
    {
      key: "uploadedImages",
      label: "Input Images",
      type: "image-array",
      required: true,
      group: "primary",
      handle: {
        type: "image",
        color: "#3b82f6", // Blue
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
        color: "#f59e0b", // Yellow
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
        color: "#f59e0b", // Yellow
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
        color: "#ec4899", // Pink
      },
    },
    {
      key: "background",
      label: "Background",
      type: "select",
      group: "advanced",
      defaultValue: "auto",
      options: [
        { label: "Auto", value: "auto" },
        { label: "Transparent", value: "transparent" },
        { label: "White", value: "white" },
        { label: "Black", value: "black" },
      ],
      handle: {
        type: "text",
        color: "#f59e0b", // Yellow
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
        { label: "JPG", value: "JPG" },
        { label: "WEBP", value: "WEBP" },
      ],
      handle: {
        type: "text",
        color: "#f59e0b", // Yellow
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
        color: "#3b82f6", // Blue
      },
    },
  ],
  inputSchema: gptImage2InputSchema,
  outputSchema: gptImage2OutputSchema,
};
