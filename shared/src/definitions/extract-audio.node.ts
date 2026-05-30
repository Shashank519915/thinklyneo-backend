import { z } from "zod";
import { NodeDefinition } from "../types/node.types";

export const extractAudioInputSchema = z.object({
  videoUrl: z.string({ required_error: "Video is required" }).min(1, "Video is required"),
});

export const extractAudioOutputSchema = z.object({
  outputAudio: z.string().url(),
});

export const extractAudioDefinition: NodeDefinition = {
  type: "extractAudio",
  name: "Extract Audio",
  category: "audio",
  icon: "Volume2",
  color: "amber",
  credits: {
    base: 150000, // 0.15M microcredits
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
        color: "#3B82F6",
      },
    },
  ],
  outputs: [
    {
      key: "outputAudio",
      label: "Extracted Audio",
      type: "audio",
      handle: {
        type: "audio",
        color: "#10B981",
      },
    },
  ],
  inputSchema: extractAudioInputSchema,
  outputSchema: extractAudioOutputSchema,
};
