import { describe, it, expect } from "vitest";
import {
  validateWorkflowInputsSync,
  estimateWorkflowCostMillions,
  PLATFORM_LIMITS,
} from "@shashank519915/shared";

describe("estimateWorkflowCostMillions", () => {
  it("sums all 8 executable node types", () => {
    const total = estimateWorkflowCostMillions([
      { type: "gptImage2" },
      { type: "klingV3" },
      { type: "openRouter" },
      { type: "mergeVideo" },
    ]);
    // 0.21 + 0.84 + 0.45 (openRouter billing base) + 0.04 = 1.54
    expect(total).toBeCloseTo(1.54);
  });

  it("ignores requestInputs and response", () => {
    expect(
      estimateWorkflowCostMillions([{ type: "requestInputs" }, { type: "response" }])
    ).toBe(0);
  });
});

describe("validateWorkflowInputsSync", () => {
  it("rejects request-input text over max length", () => {
    const err = validateWorkflowInputsSync({
      nodes: [
        {
          id: "ri",
          type: "requestInputs",
          data: { fields: [{ id: "field_text_prompt", type: "text_field" }] },
        },
      ],
      inputValues: { field_text_prompt: "x".repeat(PLATFORM_LIMITS.prompt.maxLength + 1) },
      scope: "full",
    });
    expect(err).not.toBeNull();
    expect(err?.message).toMatch(/maximum length/i);
  });

  it("rejects more than 10 request-input images", () => {
    const urls = Array.from({ length: 11 }, (_, i) => `https://example.com/${i}.png`).join(",");
    const err = validateWorkflowInputsSync({
      nodes: [
        {
          id: "ri",
          type: "requestInputs",
          data: { fields: [{ id: "field_image_refs", type: "image_field" }] },
        },
      ],
      inputValues: { field_image_refs: urls },
      scope: "full",
    });
    expect(err?.message).toMatch(/maximum of 10/i);
  });

  it("rejects gptImage2 node with too many uploadedImages in data.inputs", () => {
    const err = validateWorkflowInputsSync({
      nodes: [
        {
          id: "g1",
          type: "gptImage2",
          data: {
            inputs: {
              uploadedImages: Array.from({ length: 11 }, (_, i) => `https://img/${i}.png`),
            },
          },
        },
      ],
      inputValues: {},
      scope: "single",
      targetNodeIds: ["g1"],
    });
    expect(err?.message).toMatch(/maximum of 10/i);
  });

  it("passes valid minimal workflow inputs", () => {
    const err = validateWorkflowInputsSync({
      nodes: [
        {
          id: "ri",
          type: "requestInputs",
          data: { fields: [{ id: "field_text_x", type: "text_field" }] },
        },
        { id: "llm", type: "openRouter", data: { inputs: { prompt: "hello" } } },
      ],
      inputValues: { field_text_x: "hi" },
      scope: "full",
    });
    expect(err).toBeNull();
  });
});
