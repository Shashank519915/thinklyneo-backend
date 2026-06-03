import { z } from "zod";
import { STUB_DEMO_AUDIO_MP3_URL } from "../stub-demo-urls";
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
        color: "#22c55e",
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
        color: "#06b6d4",
      },
    },
  ],
  limits: {
    videoUrl: { mediaKind: "video", maxSizeMb: 100, maxDurationSeconds: 600 },
  },
  inputSchema: extractAudioInputSchema,
  outputSchema: extractAudioOutputSchema,
  retryPerProvider: 1,
  providers: [
    {
      id: "main-ffmpeg",
      kind: "ffmpeg",
    },
    {
      id: "backup-stub",
      kind: "stub",
      stubDelaySeconds: 2,
      stubUrl: STUB_DEMO_AUDIO_MP3_URL,
    },
  ],
};
