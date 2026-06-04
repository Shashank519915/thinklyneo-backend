import { describe, it, expect } from "vitest";
import {
  cropImageDefinition,
  gptImage2Definition,
  klingV3Definition,
  mergeVideoDefinition,
  geminiDefinition,
  extractAudioDefinition,
  mergeAVDefinition,
} from "@shashank519915/shared";

/**
 * Pure re-implementation of `estimateWorkflowCost` without importing Prisma-backed `lib/credits.ts`.
 * Mirrors the production logic: sums `definition.credits.base` for nodes present in the DEFINITIONS map.
 */
function estimateWorkflowCost(nodes: { type: string }[]): number {
  const DEFINITIONS: Record<string, { credits?: { base?: number } }> = {
    cropImage: cropImageDefinition,
    gptImage2: gptImage2Definition,
    klingV3: klingV3Definition,
    mergeVideo: mergeVideoDefinition,
    gemini: geminiDefinition,
    extractAudio: extractAudioDefinition,
    mergeAV: mergeAVDefinition,
  };
  let total = 0;
  for (const node of nodes) {
    const def = DEFINITIONS[node.type];
    if (def?.credits?.base) total += def.credits.base;
  }
  return total;
}

describe("credit estimation — base costs from @shashank519915/shared definitions", () => {
  it("gptImage2 has a positive base cost", () => {
    expect((gptImage2Definition.credits?.base ?? 0)).toBeGreaterThan(0);
  });

  it("klingV3 has a positive base cost", () => {
    expect((klingV3Definition.credits?.base ?? 0)).toBeGreaterThan(0);
  });

  it("cropImage has a positive base cost", () => {
    expect((cropImageDefinition.credits?.base ?? 0)).toBeGreaterThan(0);
  });

  it("mergeVideo has a positive base cost", () => {
    expect((mergeVideoDefinition.credits?.base ?? 0)).toBeGreaterThan(0);
  });

  it("gemini has a positive base cost", () => {
    expect((geminiDefinition.credits?.base ?? 0)).toBeGreaterThan(0);
  });

  it("extractAudio has a positive base cost", () => {
    expect((extractAudioDefinition.credits?.base ?? 0)).toBeGreaterThan(0);
  });

  it("mergeAV has a positive base cost", () => {
    expect((mergeAVDefinition.credits?.base ?? 0)).toBeGreaterThan(0);
  });

  it("klingV3 costs more than gptImage2 (video > image)", () => {
    expect(klingV3Definition.credits?.base ?? 0).toBeGreaterThan(
      gptImage2Definition.credits?.base ?? 0
    );
  });
});

describe("estimateWorkflowCost — summing", () => {
  it("sums all four original node types correctly", () => {
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

  it("sums all seven billable node types", () => {
    const total = estimateWorkflowCost([
      { type: "gptImage2" },
      { type: "klingV3" },
      { type: "cropImage" },
      { type: "mergeVideo" },
      { type: "gemini" },
      { type: "extractAudio" },
      { type: "mergeAV" },
    ]);
    const expected =
      (gptImage2Definition.credits?.base ?? 0) +
      (klingV3Definition.credits?.base ?? 0) +
      (cropImageDefinition.credits?.base ?? 0) +
      (mergeVideoDefinition.credits?.base ?? 0) +
      (geminiDefinition.credits?.base ?? 0) +
      (extractAudioDefinition.credits?.base ?? 0) +
      (mergeAVDefinition.credits?.base ?? 0);
    expect(total).toBe(expected);
  });

  it("returns 0 for requestInputs (free scaffold node)", () => {
    expect(estimateWorkflowCost([{ type: "requestInputs" }])).toBe(0);
  });

  it("returns 0 for response (free scaffold node)", () => {
    expect(estimateWorkflowCost([{ type: "response" }])).toBe(0);
  });

  it("returns 0 for completely unknown node type", () => {
    expect(estimateWorkflowCost([{ type: "unknownNode" }])).toBe(0);
  });

  it("returns 0 for empty node list", () => {
    expect(estimateWorkflowCost([])).toBe(0);
  });

  it("counts multiple instances of the same node type", () => {
    const single = estimateWorkflowCost([{ type: "gptImage2" }]);
    const double = estimateWorkflowCost([{ type: "gptImage2" }, { type: "gptImage2" }]);
    expect(double).toBe(single * 2);
  });

  it("ignores unknown types mixed with known types", () => {
    const knownOnly = estimateWorkflowCost([{ type: "gptImage2" }]);
    const mixed = estimateWorkflowCost([{ type: "gptImage2" }, { type: "openRouter" }]);
    // openRouter is not in DEFINITIONS map so should not add to cost
    expect(mixed).toBe(knownOnly);
  });

  it("a realistic workflow: prompt -> image -> response costs only the image node", () => {
    const total = estimateWorkflowCost([
      { type: "requestInputs" },
      { type: "gptImage2" },
      { type: "response" },
    ]);
    expect(total).toBe(gptImage2Definition.credits?.base ?? 0);
  });

  it("a video pipeline costs more than an image pipeline", () => {
    const imagePipeline = estimateWorkflowCost([{ type: "gptImage2" }]);
    const videoPipeline = estimateWorkflowCost([{ type: "klingV3" }]);
    expect(videoPipeline).toBeGreaterThan(imagePipeline);
  });
});
