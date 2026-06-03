import { z } from "zod";
import { STUB_DEMO_AUDIO_MP3_URL } from "../stub-demo-urls";
import { NodeDefinition } from "../types/node.types";

export const extractAudioFormatSchema = z.enum(["mp3", "wav", "aac"]);
export type ExtractAudioFormat = z.infer<typeof extractAudioFormatSchema>;

/** Normalize dropdown or wired text (e.g. Request select_field) into output format. */
export function parseExtractAudioFormat(raw: unknown): ExtractAudioFormat {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "");
  if (s === "wav") return "wav";
  if (s === "aac" || s === "acc") return "aac";
  if (s === "mp3") return "mp3";
  return "mp3";
}

export function extractAudioFfmpegConfig(format: ExtractAudioFormat): {
  codec: string;
  ext: string;
  mime: string;
} {
  switch (format) {
    case "wav":
      return { codec: "pcm_s16le", ext: "wav", mime: "audio/wav" };
    case "aac":
      return { codec: "aac", ext: "aac", mime: "audio/aac" };
    default:
      return { codec: "libmp3lame", ext: "mp3", mime: "audio/mpeg" };
  }
}

export const extractAudioInputSchema = z.object({
  videoUrl: z.string({ required_error: "Video is required" }).min(1, "Video is required"),
  format: extractAudioFormatSchema.default("mp3"),
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
    {
      key: "format",
      label: "Format",
      type: "select",
      group: "primary",
      defaultValue: "mp3",
      options: [
        { value: "mp3", label: "mp3" },
        { value: "wav", label: "wav" },
        { value: "aac", label: "aac" },
      ],
      handle: {
        type: "text",
        color: "#f59e0b",
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
