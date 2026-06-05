/**
 * Builds Trigger.dev payloads for OpenRouter/Gemini nodes from orchestrator-resolved inputs.
 * Keeps workflowOrchestrator in sync with geminiTask / openrouterTask and shared Zod schemas.
 */

import {
  geminiInputSchema,
  openrouterLlmDefinition,
  openrouterLlmInputSchema,
} from "@shashank519915/shared";
import type { z } from "zod";
import type { SerializedNode } from "./orchestrator-utils";

/** OpenRouter slug passed to the executor (maps to google/gemini-2.5-flash in executeOpenRouterProvider). */
export const GEMINI_LLM_MODEL = "gemini-2.5-flash";

const openrouterProviderModel =
  openrouterLlmDefinition.providers.find((p) => p.kind === "openrouter")?.model ??
  "google/gemini-2.5-flash";

export interface NodeTaskCoordinationFields {
  runId: string;
  nodeRunId: string;
  orchestratorRunId: string;
  waitpointTokenId: string;
  workflowId: string;
}

export function collectNodeMediaUrls(
  resolvedInputs: Record<string, unknown>,
  nodeInputs: Record<string, unknown>,
  key: string,
  legacyKey?: string
): string[] {
  const raw =
    resolvedInputs[key] ??
    (legacyKey ? resolvedInputs[legacyKey] : undefined) ??
    nodeInputs[key] ??
    (legacyKey ? nodeInputs[legacyKey] : undefined);
  const out: string[] = [];
  const items = Array.isArray(raw) ? raw : raw ? [raw] : [];
  for (const item of items) {
    if (typeof item === "string" && item.length > 0) {
      out.push(...item.split(",").map((s) => s.trim()).filter(Boolean));
    }
  }
  return out;
}

function requirePrompt(resolvedInputs: Record<string, unknown>): string {
  const prompt = resolvedInputs["prompt"];
  if (typeof prompt !== "string" || !prompt.trim()) {
    throw new Error("Prompt is required");
  }
  return prompt;
}

function resolveSystemPrompt(
  resolvedInputs: Record<string, unknown>,
  nodeInputs: Record<string, unknown>
): string | undefined {
  const raw = resolvedInputs["systemPrompt"] ?? nodeInputs.systemPrompt;
  if (raw == null || raw === "") return undefined;
  return typeof raw === "string" ? raw : String(raw);
}

function coerceOptionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function coerceOptionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return Boolean(value);
}

function coerceOptionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const s = typeof value === "string" ? value : String(value);
  return s.length > 0 ? s : undefined;
}

/** Merged resolved edge/request values win over static node.data.inputs. */
function pickLlmSettings(
  resolvedInputs: Record<string, unknown>,
  nodeInputs: Record<string, unknown>
) {
  const src = { ...nodeInputs, ...resolvedInputs };
  return {
    temperature: coerceOptionalNumber(src.temperature),
    maxTokens: coerceOptionalNumber(src.maxTokens),
    reasoning: coerceOptionalBoolean(src.reasoning),
    topP: coerceOptionalNumber(src.topP),
    topK: coerceOptionalNumber(src.topK),
    frequencyPenalty: coerceOptionalNumber(src.frequencyPenalty),
    presencePenalty: coerceOptionalNumber(src.presencePenalty),
    repetitionPenalty: coerceOptionalNumber(src.repetitionPenalty),
    minP: coerceOptionalNumber(src.minP),
    topA: coerceOptionalNumber(src.topA),
    seed: coerceOptionalNumber(src.seed),
    stop: coerceOptionalString(src.stop) ?? null,
    response_format: coerceOptionalBoolean(src.response_format),
  };
}

type GeminiInput = z.infer<typeof geminiInputSchema>;
type OpenRouterInput = z.infer<typeof openrouterLlmInputSchema>;

export function buildGeminiInferencePayload(
  node: SerializedNode,
  resolvedInputs: Record<string, unknown>,
  coordination: NodeTaskCoordinationFields
): GeminiInput & NodeTaskCoordinationFields & { model: string } {
  const nodeInputs = (node.data.inputs as Record<string, unknown>) ?? {};
  const parsed = geminiInputSchema.parse({
    prompt: requirePrompt(resolvedInputs),
    systemPrompt: resolveSystemPrompt(resolvedInputs, nodeInputs),
    image_urls: collectNodeMediaUrls(resolvedInputs, nodeInputs, "image_urls", "images"),
    video_urls: collectNodeMediaUrls(resolvedInputs, nodeInputs, "video_urls", "video"),
    audio_urls: collectNodeMediaUrls(resolvedInputs, nodeInputs, "audio_urls", "audio"),
    ...pickLlmSettings(resolvedInputs, nodeInputs),
  } satisfies GeminiInput);

  return {
    ...parsed,
    model: GEMINI_LLM_MODEL,
    ...coordination,
  };
}

export function buildOpenRouterInferencePayload(
  node: SerializedNode,
  resolvedInputs: Record<string, unknown>,
  coordination: NodeTaskCoordinationFields
): OpenRouterInput &
  NodeTaskCoordinationFields & {
    model: string;
    images: string[];
  } {
  const nodeInputs = (node.data.inputs as Record<string, unknown>) ?? {};
  const parsed = openrouterLlmInputSchema.parse({
    prompt: requirePrompt(resolvedInputs),
    systemPrompt: resolveSystemPrompt(resolvedInputs, nodeInputs),
    image_urls: collectNodeMediaUrls(resolvedInputs, nodeInputs, "image_urls", "images"),
    video_urls: collectNodeMediaUrls(resolvedInputs, nodeInputs, "video_urls", "video"),
    audio_urls: collectNodeMediaUrls(resolvedInputs, nodeInputs, "audio_urls", "audio"),
    ...pickLlmSettings(resolvedInputs, nodeInputs),
  } satisfies OpenRouterInput);

  return {
    ...parsed,
    model: openrouterProviderModel,
    images: parsed.image_urls ?? [],
    ...coordination,
  };
}
