import { z } from "zod";
import { NodeDefinition } from "../types/node.types";

export const klingV3InputSchema = z.object({
  prompt: z.string({ required_error: "Prompt is required" }).min(1, "Prompt is required"),
  inputImage: z.string().nullable().optional(),
  aspectRatio: z.enum(["16:9", "9:16", "1:1"]).optional(),
  duration: z.enum(["5s", "10s"]).optional(),
});

export const klingV3OutputSchema = z.object({
  outputVideo: z.string().url(),
});

export const klingV3Definition: NodeDefinition = {
  type: "klingV3",
  name: "Kling v3",
  category: "video",
  icon: "Video",
  color: "red",
  credits: {
    base: 1500000, // 1.50M microcredits
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
      key: "inputImage",
      label: "Input Image (Image-to-Video)",
      type: "file-upload",
      group: "primary",
      handle: {
        type: "image",
        color: "#3b82f6",
      },
    },
    {
      key: "aspectRatio",
      label: "Aspect Ratio",
      type: "select",
      group: "advanced",
      defaultValue: "16:9",
      options: [
        { label: "16:9 Landscape", value: "16:9" },
        { label: "9:16 Portrait", value: "9:16" },
        { label: "1:1 Square", value: "1:1" },
      ],
    },
    {
      key: "duration",
      label: "Duration",
      type: "select",
      group: "advanced",
      defaultValue: "5s",
      options: [
        { label: "5 Seconds", value: "5s" },
        { label: "10 Seconds", value: "10s" },
      ],
    },
  ],
  outputs: [
    {
      key: "outputVideo",
      label: "Output Video",
      type: "video",
      handle: {
        type: "video",
        color: "#22c55e",
      },
    },
  ],
  inputSchema: klingV3InputSchema,
  outputSchema: klingV3OutputSchema,
};
