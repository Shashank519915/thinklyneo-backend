import { describe, it, expect } from "vitest";
import {
  cropImageDefinition,
  gptImage2Definition,
  klingV3Definition,
  mergeVideoDefinition,
} from "@galaxy/shared";

/** Mirror of `estimateWorkflowCost` without importing Prisma-backed `lib/credits.ts`. */
function estimateWorkflowCost(nodes: { type: string }[]): number {
  const defs: Record<string, { credits?: { base?: number } }> = {
    cropImage: cropImageDefinition,
    gptImage2: gptImage2Definition,
    klingV3: klingV3Definition,
    mergeVideo: mergeVideoDefinition,
  };
  let total = 0;
  for (const node of nodes) {
    const d = defs[node.type];
    if (d?.credits?.base) total += d.credits.base;
  }
  return total;
}

describe("credit estimation", () => {
  it("sums base microcredits from shared node definitions", () => {
    const total = estimateWorkflowCost([
      { type: "gptImage2" },
      { type: "klingV3" },
      { type: "cropImage" },
      { type: "mergeVideo" },
    ]);
    const expected =
      (gptImage2Definition.credits?.base ?? 0) +
      (klingV3Definition.credits?.base ?? 0) +
      (cropImageDefinition.credits?.base ?? 0) +
      (mergeVideoDefinition.credits?.base ?? 0);
    expect(total).toBe(expected);
  });

  it("ignores unknown node types", () => {
    expect(estimateWorkflowCost([{ type: "requestInputs" }])).toBe(0);
  });
});
