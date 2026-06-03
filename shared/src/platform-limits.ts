/**
 * Platform-wide media limits aligned with Transloadit upload/handle, serverless FFmpeg
 * memory, and trial doc Req 4 / Req 11 (file size, duration, resolution).
 *
 * Transloadit assemblies accept large files on paid tiers (up to 512MB+ per file);
 * we use conservative caps so Trigger.dev FFmpeg tasks stay within serverless bounds.
 */

export interface MediaKindLimits {
  maxSizeMb: number;
  maxCount?: number;
  maxLength?: number;
  maxDurationSeconds?: number;
  maxWidth?: number;
  maxHeight?: number;
}

export const PLATFORM_LIMITS = {
  /** Matches gpt-image-2 / request-inputs UI cap */
  image: {
    maxSizeMb: 15,
    maxCount: 10,
    maxWidth: 4096,
    maxHeight: 4096,
  } satisfies MediaKindLimits,
  /** FFmpeg concat / mux — practical serverless cap */
  video: {
    maxSizeMb: 100,
    maxDurationSeconds: 600,
    maxCount: 3,
  } satisfies MediaKindLimits,
  audio: {
    maxSizeMb: 50,
    maxDurationSeconds: 600,
  } satisfies MediaKindLimits,
  file: {
    maxSizeMb: 25,
  } satisfies MediaKindLimits,
  prompt: {
    maxLength: 32_000,
  },
  /** Request-Inputs multi-image fields */
  requestMultiImage: {
    maxCount: 10,
    maxSizeMb: 15,
  },
} as const;

/** Upload route byte caps by MIME prefix */
export function maxUploadBytesForMime(mime: string): number {
  if (mime.startsWith("video/")) return PLATFORM_LIMITS.video.maxSizeMb * 1024 * 1024;
  if (mime.startsWith("audio/")) return PLATFORM_LIMITS.audio.maxSizeMb * 1024 * 1024;
  if (mime.startsWith("image/")) return PLATFORM_LIMITS.image.maxSizeMb * 1024 * 1024;
  return PLATFORM_LIMITS.file.maxSizeMb * 1024 * 1024;
}
