import { z } from "zod";
import { parseMediaList } from "../media-list";
import { isLikelyVideoUrl } from "./merge-video.node";
import { NodeDefinition } from "../types/node.types";

export const mergeAVInputSchema = z.object({
  video_url: z.string({ required_error: "Video is required" }).min(1, "Video is required"),
  audio_url: z.string({ required_error: "Audio is required" }).min(1, "Audio is required"),
  audio_volume: z.number().min(0).max(2).default(0.5),
});

export const mergeAVOutputSchema = z.object({
  video_url: z.string().url(),
});

/** One video URL for Merge A/V (rejects multi-URL comma lists). */
export function resolveMergeAVVideoUrl(resolvedInputs: Record<string, unknown>): string {
  const raw = resolvedInputs.video_url ?? resolvedInputs.videoUrl;
  const urls = parseMediaList(raw).filter(isLikelyVideoUrl);
  if (urls.length === 0) {
    const fallback = parseMediaList(raw);
    if (fallback.length === 1) return fallback[0]!;
    return typeof raw === "string" ? raw.trim() : "";
  }
  if (urls.length > 1) {
    throw new Error(
      "Merge Audio & Video accepts only one video input. Disconnect extra sources or use a single-video field."
    );
  }
  return urls[0]!;
}

export function resolveMergeAVAudioUrl(resolvedInputs: Record<string, unknown>): string {
  const raw = resolvedInputs.audio_url ?? resolvedInputs.audioUrl;
  const urls = parseMediaList(raw);
  if (urls.length > 1) return urls[0]!;
  if (urls.length === 1) return urls[0]!;
  return typeof raw === "string" ? raw.trim() : "";
}

export function resolveMergeAVAudioVolume(resolvedInputs: Record<string, unknown>): number {
  const raw = resolvedInputs.audio_volume ?? resolvedInputs.audioVolume;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(2, Math.max(0, n));
}

export const mergeAVDefinition: NodeDefinition = {
  type: "mergeAV",
  name: "Merge Audio & Video",
  description: "Combine audio track with video",
  category: "video",
  icon: "Video",
  color: "cyan",
  credits: {
    base: 30000, // ~0.03M microcredits (Magica parity)
  },
  inputs: [
    {
      key: "video_url",
      label: "Video",
      type: "file-upload",
      required: true,
      group: "primary",
      uiVariant: "magica-side-label",
      handle: {
        type: "video",
        color: "#22c55e",
      },
    },
    {
      key: "audio_url",
      label: "Audio",
      type: "file-upload",
      required: true,
      group: "primary",
      uiVariant: "magica-side-label",
      handle: {
        type: "audio",
        color: "#06b6d4",
      },
    },
    {
      key: "audio_volume",
      label: "Audio Volume",
      type: "slider",
      group: "primary",
      defaultValue: 0.5,
      min: 0,
      max: 2,
      step: 0.1,
      uiVariant: "magica-volume-row",
      tooltip: "Volume multiplier for the added audio track (0–2).",
      handle: {
        type: "text",
        color: "#ec4899",
      },
    },
  ],
  outputs: [
    {
      key: "video_url",
      label: "Merged Video",
      type: "video",
      handle: {
        type: "video",
        color: "#22c55e",
      },
    },
  ],
  limits: {
    video_url: { mediaKind: "video", maxSizeMb: 100, maxDurationSeconds: 600, maxCount: 1 },
    audio_url: { mediaKind: "audio", maxSizeMb: 50, maxDurationSeconds: 600 },
  },
  inputSchema: mergeAVInputSchema,
  outputSchema: mergeAVOutputSchema,
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
      stubUrl: "https://images.transloadit.com/examples/vertical.mp4",
    },
  ],
};
