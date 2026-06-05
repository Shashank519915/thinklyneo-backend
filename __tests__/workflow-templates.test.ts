import { describe, it, expect } from "vitest";
import { buildAdvertisementGraph, resolveWorkflowGraph } from "@/lib/workflow-templates";

describe("workflow-templates", () => {
  it("empty template returns requestInputs and response only", () => {
    const { nodes, edges } = resolveWorkflowGraph({ template: "empty" });
    const types = nodes.map((n) => (n as { type: string }).type);
    expect(types).toEqual(["requestInputs", "response"]);
    expect(edges).toEqual([]);
  });

  it("advertisement template builds full marketing pipeline", () => {
    const { nodes, edges } = resolveWorkflowGraph({ template: "advertisement" });
    const types = new Set(nodes.map((n) => (n as { type: string }).type));
    expect(types.has("requestInputs")).toBe(true);
    expect(types.has("response")).toBe(true);
    expect(types.has("cropImage")).toBe(true);
    expect(types.has("openRouter")).toBe(true);
    expect(edges.length).toBeGreaterThan(0);
  });

  it("productBrief seeds request-inputs text field", () => {
    const brief = "T-shirt company: 20% off summer graphic tees";
    const { nodes } = buildAdvertisementGraph(brief);
    const requestInputs = nodes.find((n) => (n as { id: string }).id === "request-inputs") as {
      data: { fields: { id: string; value: string }[] };
    };
    const textField = requestInputs.data.fields.find((f) => f.id === "field_text_1");
    expect(textField?.value).toBe(brief);
  });

  it("crop outputs wire to OpenRouter vision via in:image_urls", () => {
    const { nodes, edges } = buildAdvertisementGraph();
    const cropEdges = edges.filter(
      (e) =>
        (e as { target: string }).target === "gemini-final" &&
        (e as { sourceHandle: string }).sourceHandle === "out:outputImage"
    );
    expect(cropEdges).toHaveLength(2);
    for (const edge of cropEdges) {
      expect((edge as { targetHandle: string }).targetHandle).toBe("in:image_urls");
      expect((edge as { sourceHandle: string }).sourceHandle).toBe("out:outputImage");
    }
    const finalLlm = nodes.find((n) => (n as { id: string }).id === "gemini-final") as {
      data: { inputs: Record<string, unknown> };
    };
    expect(finalLlm.data.inputs).toHaveProperty("image_urls");
    expect(finalLlm.data.inputs).not.toHaveProperty("images");
  });
});
