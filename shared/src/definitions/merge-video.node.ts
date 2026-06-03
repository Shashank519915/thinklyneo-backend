import { z } from "zod";
import { parseMediaList } from "../media-list";
import { STUB_DEMO_VIDEO_MP4_URL } from "../stub-demo-urls";
import { NodeDefinition } from "../types/node.types";

export const mergeVideoTransitionSchema = z.enum(["none", "fade", "dissolve"]);
export type MergeVideoTransition = z.infer<typeof mergeVideoTransitionSchema>;

const VIDEO_URL_RE = /\.(mp4|webm|mov|m4v|mkv)(\?|#|$)/i;

/** Normalize dropdown or wired text (e.g. Request text_field) into a transition enum. */
export function parseMergeVideoTransition(raw: unknown): MergeVideoTransition {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "");
  if (s === "fade" || s === "dissolve" || s === "none") return s;
  return "none";
}

/** Reject image/audio URLs mistaken for video inputs before FFmpeg runs. */
export function isLikelyVideoUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed.startsWith("http") && !trimmed.startsWith("data:")) return false;
  if (/\.(webp|jpe?g|png|gif|svg|bmp|mp3|wav|ogg|m4a|aac|csv|pdf)(\?|#|$)/i.test(trimmed)) {
    return false;
  }
  return VIDEO_URL_RE.test(trimmed) || trimmed.startsWith("data:video/");
}

export const mergeVideoInputSchema = z.object({
  video_urls: z
    .array(z.string().min(1))
    .min(2, "At least two videos are required"),
  transition: mergeVideoTransitionSchema.default("none"),
});

export const mergeVideoOutputSchema = z.object({
  outputVideo: z.string().url(),
});

/** Resolves wired/manual/legacy merge inputs into an ordered URL list. */
export function resolveMergeVideoUrls(resolvedInputs: Record<string, unknown>): string[] {
  const urls: string[] = [];
  const raw = resolvedInputs.video_urls;
  if (Array.isArray(raw)) {
    for (const item of raw) {
      urls.push(...parseMediaList(item));
    }
  } else if (raw != null) {
    urls.push(...parseMediaList(raw));
  }

  if (urls.length < 2) {
    for (const key of ["videoUrl1", "videoUrl2", "videoUrl3"] as const) {
      urls.push(...parseMediaList(resolvedInputs[key]));
    }
  }

  return urls.filter(isLikelyVideoUrl);
}

export const mergeVideoDefinition: NodeDefinition = {
  type: "mergeVideo",
  name: "Merge Videos",
  description: "Concatenate multiple videos into one",
  category: "video",
  icon: "Video",
  color: "teal",
  credits: {
    base: 40000, // ~0.04M microcredits (Magica parity)
  },
  inputs: [
    {
      key: "video_urls",
      label: "Videos",
      type: "video-array",
      required: true,
      group: "primary",
      handle: {
        type: "video",
        color: "#22c55e",
      },
    },
    {
      key: "transition",
      label: "Transition",
      type: "select",
      group: "primary",
      defaultValue: "none",
      options: [
        { value: "none", label: "none" },
        { value: "fade", label: "fade" },
        { value: "dissolve", label: "dissolve" },
      ],
      handle: {
        type: "text",
        color: "#f59e0b",
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
  limits: {
    video_urls: {
      mediaKind: "video",
      maxCount: 10,
      maxSizeMb: 100,
      maxDurationSeconds: 600,
    },
  },
  inputSchema: mergeVideoInputSchema,
  outputSchema: mergeVideoOutputSchema,
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
      stubUrl: STUB_DEMO_VIDEO_MP4_URL,
    },
  ],
};
