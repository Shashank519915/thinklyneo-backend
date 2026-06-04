import type { NodeDefinition } from "../types/node.types";
import { estimateNodeDisplayMicrocredits } from "../node-estimates";
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

export type WorkflowNodeEstimate = {
  type: string;
  /** Live canvas inputs — used for dynamic display estimates (e.g. OpenRouter). */
  inputs?: Record<string, unknown> | null;
};

export function estimateWorkflowCostMicrocredits(
  nodes: WorkflowNodeEstimate[],
): number {
  let total = 0;
  for (const node of nodes) {
    const def = EXECUTABLE_NODE_DEFINITIONS[node.type];
    if (!def?.credits?.base) continue;
    total += estimateNodeDisplayMicrocredits(
      node.type,
      node.inputs ?? undefined,
      def.credits.base,
    );
  }
  return total;
}

export function estimateWorkflowCostMillions(
  nodes: WorkflowNodeEstimate[],
): number {
  return estimateWorkflowCostMicrocredits(nodes) / 1_000_000;
}

/** Default `data.inputs` for a new canvas node — mirrors GenericNode reset logic. */
export function buildDefaultNodeInputs(
  def: NodeDefinition,
): Record<string, unknown> {
  const inputs: Record<string, unknown> = {};
  for (const param of def.inputs) {
    if (param.defaultValue !== undefined) {
      inputs[param.key] = param.defaultValue;
    } else if (
      param.type === "image-array" ||
      param.type === "video-array" ||
      param.type === "audio-array"
    ) {
      inputs[param.key] = [];
    } else if (param.type === "boolean") {
      inputs[param.key] = false;
    } else {
      inputs[param.key] = null;
    }
  }
  return inputs;
}
