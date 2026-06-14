import { createOpenAI } from "@ai-sdk/openai";

/** OpenRouter model ids per chat mode. Override via env for production tuning. */

export type ChatMode = "helper" | "thinkly" | "brain";

/**
 * Free OpenRouter models — no prepaid credits; shared upstream rate limits apply.
 * Thinkly/Brain use `openrouter/free` so OpenRouter picks an available free model
 * with tool support (avoids single-provider 429s on e.g. Llama 3.3 70B via Venice).
 */
const FREE_MODELS: Record<ChatMode, string> = {
  helper: "meta-llama/llama-3.2-3b-instruct:free",
  thinkly: "openrouter/free",
  brain: "openrouter/free",
};

/** Alternate free ids if one provider is 429 — set via CHAT_MODEL_* in .env.local */
export const FREE_MODEL_ALTERNATES = [
  "openrouter/free",
  "qwen/qwen3-next-80b-a3b-instruct:free",
  "google/gemma-3-12b-it:free",
  "meta-llama/llama-3.3-70b-instruct:free",
] as const;

const DEFAULT_MODELS: Record<ChatMode, string> = {
  helper: process.env.CHAT_MODEL_HELPER ?? FREE_MODELS.helper,
  thinkly: process.env.CHAT_MODEL_THINKLY ?? FREE_MODELS.thinkly,
  brain: process.env.CHAT_MODEL_BRAIN ?? FREE_MODELS.brain,
};

export function resolveModelForMode(mode: ChatMode): string {
  return DEFAULT_MODELS[mode];
}

/** Caps output reservation on OpenRouter (undefined defaults to 65535 and can 402 on low balance). */
export function resolveMaxOutputTokens(): number {
  const raw = process.env.CHAT_MAX_OUTPUT_TOKENS;
  if (raw) {
    const n = parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) return Math.min(n, 8192);
  }
  return 4096;
}

export function getOpenRouterProvider() {
  return createOpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: process.env.OPENROUTER_API_KEY ?? "",
    headers: {
      "HTTP-Referer": process.env.OPENROUTER_SITE_URL ?? "https://thinkly.app",
      "X-Title": process.env.OPENROUTER_APP_NAME ?? "Thinkly",
    },
  });
}
