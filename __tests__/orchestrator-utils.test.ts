/**
 * Pure unit tests for DAG helpers in trigger/orchestrator-utils.ts.
 * No Prisma, no Trigger SDK — no mocks required.
 */
import { describe, it, expect } from "vitest";
import {
  topologicalSort,
  getNodeWithDeps,
  resolveInputsForNode,
  type SerializedNode,
  type SerializedEdge,
} from "../trigger/orchestrator-utils";

function node(id: string, type: string, data: Record<string, unknown> = {}): SerializedNode {
  return { id, type, data };
}

function edge(
  source: string,
  target: string,
  sourceHandle?: string,
  targetHandle?: string
): SerializedEdge {
  return { source, target, sourceHandle, targetHandle };
}

describe("topologicalSort", () => {
  it("orders a linear chain A -> B -> C", () => {
    const nodes = [node("a", "requestInputs"), node("b", "openRouter"), node("c", "response")];
    const edges = [edge("a", "b"), edge("b", "c")];
    const sorted = topologicalSort(nodes, edges);
    expect(sorted.map((n) => n.id)).toEqual(["a", "b", "c"]);
  });

  it("orders diamond DAG with parallel middle layer", () => {
    const nodes = [node("a", "requestInputs"), node("b", "gptImage2"), node("c", "klingV3"), node("d", "mergeVideo")];
    const edges = [edge("a", "b"), edge("a", "c"), edge("b", "d"), edge("c", "d")];
    const sorted = topologicalSort(nodes, edges);
    expect(sorted[0].id).toBe("a");
    expect(sorted[sorted.length - 1].id).toBe("d");
    expect(sorted.map((n) => n.id)).toContain("b");
    expect(sorted.map((n) => n.id)).toContain("c");
  });

  it("ignores edges pointing to unknown nodes", () => {
    const nodes = [node("a", "requestInputs"), node("b", "response")];
    const edges = [edge("a", "b"), edge("b", "missing")];
    const sorted = topologicalSort(nodes, edges);
    expect(sorted.map((n) => n.id)).toEqual(["a", "b"]);
  });
});

describe("getNodeWithDeps", () => {
  const nodes = [
    node("a", "requestInputs"),
    node("b", "openRouter"),
    node("c", "response"),
    node("d", "gptImage2"),
  ];
  const edges = [edge("a", "b"), edge("b", "c"), edge("a", "d")];

  it("includes target and all upstream dependencies", () => {
    const sorted = getNodeWithDeps(nodes, edges, ["c"], new Set());
    expect(sorted.map((n) => n.id)).toEqual(["a", "b", "c"]);
  });

  it("skips cached deps when not force-running target branch only", () => {
    const sorted = getNodeWithDeps(nodes, edges, ["c"], new Set(["a"]));
    expect(sorted.map((n) => n.id)).toEqual(["b", "c"]);
  });

  it("always includes force-run target even if cached", () => {
    const sorted = getNodeWithDeps(nodes, edges, ["b"], new Set(["b"]));
    expect(sorted.map((n) => n.id)).toContain("b");
  });
});

describe("resolveInputsForNode", () => {
  it("injects inputValues for requestInputs nodes", () => {
    const ri = node("a", "requestInputs", {
      fields: [{ id: "field_text", value: "default" }],
    });
    const inputs = resolveInputsForNode(ri, [], new Map(), { field_text: "from run" });
    expect(inputs.field_text).toBe("from run");
  });

  it("maps upstream output via out: handle to in: target", () => {
    const llm = node("b", "openRouter", { inputs: {} });
    const edges = [edge("a", "b", "out:prompt", "in:prompt")];
    const outputs = new Map<string, unknown>([["a", { prompt: "hello world" }]]);
    const inputs = resolveInputsForNode(llm, edges, outputs, {});
    expect(inputs.prompt).toBe("hello world");
  });

  it("fans in multiple images on in:images target handle", () => {
    const gemini = node("g", "gemini", {});
    const edges = [
      edge("i1", "g", "out:image", "in:images"),
      edge("i2", "g", "out:image", "in:images"),
    ];
    const outputs = new Map<string, unknown>([
      ["i1", "https://img1.png"],
      ["i2", "https://img2.png"],
    ]);
    const inputs = resolveInputsForNode(gemini, edges, outputs, {});
    expect(inputs.images).toEqual(["https://img1.png", "https://img2.png"]);
  });

  it("copies manual inputs from node.data.inputs", () => {
    const crop = node("c", "cropImage", { inputs: { x: 10, y: 20 } });
    const inputs = resolveInputsForNode(crop, [], new Map(), {});
    expect(inputs.x).toBe(10);
    expect(inputs.y).toBe(20);
  });
});
