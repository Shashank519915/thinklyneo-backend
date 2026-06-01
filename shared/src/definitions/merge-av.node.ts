import { z } from "zod";
import { NodeDefinition } from "../types/node.types";

export const mergeAVInputSchema = z.object({
  videoUrl: z.string({ required_error: "Video is required" }).min(1, "Video is required"),
  audioUrl: z.string({ required_error: "Audio is required" }).min(1, "Audio is required"),
});

export const mergeAVOutputSchema = z.object({
  outputVideo: z.string().url(),
});

export const mergeAVDefinition: NodeDefinition = {
  type: "mergeAV",
  name: "Merge A/V",
  category: "video",
  icon: "Video",
  color: "cyan",
  credits: {
    base: 200000, // 0.20M microcredits
  },
  inputs: [
    {
      key: "videoUrl",
      label: "Video Input",
      type: "file-upload",
      required: true,
      group: "primary",
      handle: {
        type: "video",
        color: "#22c55e",
      },
    },
    {
      key: "audioUrl",
      label: "Audio Input",
      type: "file-upload",
      required: true,
      group: "primary",
      handle: {
        type: "audio",
        color: "#ec4899",
      },
    },
  ],
  outputs: [
    {
      key: "outputVideo",
      label: "Merged Video",
      type: "video",
      handle: {
        type: "video",
        color: "#22c55e",
      },
    },
  ],
  inputSchema: mergeAVInputSchema,
  outputSchema: mergeAVOutputSchema,
};
