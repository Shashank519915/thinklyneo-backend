/**
 * @fileoverview Static fractional “million-credit” estimates surfaced on Crop/Gemini nodes + top chrome.
 * These constants are illustrative only — no metering backend verifies spend.
 */

import type { Node } from "@xyflow/react";

/** Fixed placeholder “cost” per node type for Est UI only (no billing backend). */
export const ESTIMATE_CROP_M = 0.21;
export const ESTIMATE_GEMINI_M = 0.45;

export const NODE_ESTIMATE_LABEL: Record<"cropImage" | "gemini", string> = {
  cropImage: `~${ESTIMATE_CROP_M}M`,
  gemini: `~${ESTIMATE_GEMINI_M}M`,
};

/**
 * Walks workflow nodes accumulating fixed placeholders for UI aggregate display.
 *
 * @param nodeList — Current React Flow node array (may contain unrelated types — ignored silently).
 */
export function sumWorkflowEstimateMillions(nodeList: Node[]): number {
  let sum = 0;
  for (const n of nodeList) {
    if (n.type === "cropImage") sum += ESTIMATE_CROP_M;
    if (n.type === "gemini") sum += ESTIMATE_GEMINI_M;
  }
  return sum;
}
