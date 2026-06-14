import { describe, it, expect } from "vitest";
import { validateBlueprintGraph } from "@/lib/chat/blueprint-validate";

describe("validateBlueprintGraph", () => {
  it("accepts a minimal valid blueprint", () => {
    const result = validateBlueprintGraph({
      requestFields: [{ id: "field_text_1" }],
      nodes: [
        { id: "request-inputs", type: "requestInputs", label: "Inputs" },
        { id: "n1", type: "openRouter", label: "LLM" },
        { id: "response", type: "response", label: "Output" },
      ],
      edges: [
        {
          source: "field_text_1",
          sourceHandle: "field_text_1",
          target: "n1",
          targetHandle: "in:prompt",
        },
        {
          source: "n1",
          sourceHandle: "out:response",
          target: "response",
          targetHandle: "result",
        },
      ],
    });
    expect(result.valid).toBe(true);
    expect(result.issues.filter((i) => i.severity === "error")).toHaveLength(0);
  });

  it("rejects unknown node types", () => {
    const result = validateBlueprintGraph({
      requestFields: [],
      nodes: [{ id: "n1", type: "fakeNode", label: "Bad" }],
      edges: [],
    });
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "unknown_node_type")).toBe(true);
  });
});
