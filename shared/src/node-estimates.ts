/**
 * Dynamic per-node cost estimates (display only). Static billing still uses credits.base.
 */

const OPENROUTER_BASE_MICRO = 100; // ~0.0001M
const OPENROUTER_PER_200_CHARS_MICRO = 100; // ~0.0001M per 200 chars
const OPENROUTER_PER_IMAGE_MICRO = 300; // ~0.0003M
const OPENROUTER_PER_VIDEO_MICRO = 700; // ~0.0007M
const OPENROUTER_PER_AUDIO_MICRO = 500; // ~0.0005M

function charBlockCost(length: number): number {
  if (length <= 0) return 0;
  return Math.floor(length / 200) * OPENROUTER_PER_200_CHARS_MICRO;
}

function asStringArray(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string" && v.length > 0);
  }
  if (typeof value === "string" && value.length > 0) {
    return value.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

export type OpenRouterEstimateInputs = {
  prompt?: string | null;
  systemPrompt?: string | null;
  image_urls?: unknown;
  images?: unknown;
  video_urls?: unknown;
  audio_urls?: unknown;
};

/** Magica-style dynamic estimate for OpenRouter / Gemini LLM nodes. */
export function estimateOpenRouterCostMicrocredits(
  inputs: OpenRouterEstimateInputs | null | undefined,
): number {
  const data = inputs ?? {};
  const promptLen = String(data.prompt ?? "").length;
  const systemLen = String(data.systemPrompt ?? "").length;
  const images = asStringArray(data.image_urls ?? data.images);
  const videos = asStringArray(data.video_urls);
  const audios = asStringArray(data.audio_urls);

  return (
    OPENROUTER_BASE_MICRO +
    charBlockCost(promptLen) +
    charBlockCost(systemLen) +
    images.length * OPENROUTER_PER_IMAGE_MICRO +
    videos.length * OPENROUTER_PER_VIDEO_MICRO +
    audios.length * OPENROUTER_PER_AUDIO_MICRO
  );
}

/** Numeric millions string for canvas chrome (no ~ prefix). */
export function formatMillionsValueFromMicrocredits(microcredits: number): string {
  const m = microcredits / 1_000_000;
  if (m < 0.001) {
    return m.toFixed(4);
  }
  if (m < 0.01) {
    return m.toFixed(3);
  }
  return m.toFixed(2);
}

/** Format microcredits as `~0.0001M` (reference portal precision). */
export function formatNodeEstimateMillions(microcredits: number): string {
  return `~${formatMillionsValueFromMicrocredits(microcredits)}M`;
}

export function estimateNodeDisplayMicrocredits(
  nodeType: string,
  inputs: Record<string, unknown> | null | undefined,
  staticBaseMicro: number,
): number {
  if (nodeType === "openRouter" || nodeType === "gemini") {
    return estimateOpenRouterCostMicrocredits(inputs as OpenRouterEstimateInputs);
  }
  return staticBaseMicro;
}
