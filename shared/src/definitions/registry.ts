import type { NodeDefinition } from "../types/node.types";
import { cropImageDefinition } from "./crop-image.node";
import { extractAudioDefinition } from "./extract-audio.node";
import { geminiDefinition } from "./gemini.node";
import { gptImage2Definition } from "./gpt-image-2.node";
import { klingV3Definition } from "./kling-v3.node";
import { mergeAVDefinition } from "./merge-av.node";
import { mergeVideoDefinition } from "./merge-video.node";
import { openrouterLlmDefinition } from "./openrouter-llm.node";

/** All billable executable node definitions — single registry for credits + limits. */
export const EXECUTABLE_NODE_DEFINITIONS: Record<string, NodeDefinition> = {
  cropImage: cropImageDefinition,
  gemini: geminiDefinition,
  openRouter: openrouterLlmDefinition,
  gptImage2: gptImage2Definition,
  klingV3: klingV3Definition,
  mergeVideo: mergeVideoDefinition,
  mergeAV: mergeAVDefinition,
  extractAudio: extractAudioDefinition,
};

export function estimateWorkflowCostMicrocredits(nodes: { type: string }[]): number {
  let total = 0;
  for (const node of nodes) {
    const def = EXECUTABLE_NODE_DEFINITIONS[node.type];
    if (def?.credits?.base) {
      total += def.credits.base;
    }
  }
  return total;
}

export function estimateWorkflowCostMillions(nodes: { type: string }[]): number {
  return estimateWorkflowCostMicrocredits(nodes) / 1_000_000;
}
