/**
 * Validated graph-editing engine — covers add/connect/fan-in/single-input/cycle/scaffold rules.
 */
import { describe, it, expect } from "vitest";
import { DEFAULT_EMPTY_NODES, DEFAULT_EMPTY_EDGES } from "@/lib/workflow-templates";
import { applyGraphOps, GraphOpError, type GraphEdge, type GraphNode } from "@/lib/mcp/graph-ops";

function emptyGraph(): { nodes: GraphNode[]; edges: GraphEdge[] } {
  return {
    nodes: structuredClone(DEFAULT_EMPTY_NODES) as GraphNode[],
    edges: structuredClone(DEFAULT_EMPTY_EDGES) as GraphEdge[],
  };
}

describe("applyGraphOps", () => {
  it("adds an executable node with default inputs and ports", () => {
    const { nodes, edges } = emptyGraph();
    const out = applyGraphOps(nodes, edges, [{ op: "addNode", nodeType: "openRouter" }]);
    expect(out.nodes).toHaveLength(3);
    const added = out.nodes.find((n) => n.type === "openRouter");
    expect(added).toBeTruthy();
    expect(out.results[0].outputPorts).toEqual([{ handle: "out:response", type: "text" }]);
  });

  it("rejects an unknown node type", () => {
    const { nodes, edges } = emptyGraph();
    expect(() => applyGraphOps(nodes, edges, [{ op: "addNode", nodeType: "nope" }])).toThrow(GraphOpError);
  });

  it("connects request field → llm prompt → response result", () => {
    const { nodes, edges } = emptyGraph();
    const out = applyGraphOps(nodes, edges, [
      { op: "addNode", nodeType: "openRouter" },
    ]);
    const llmId = out.results[0].nodeId!;
    const wired = applyGraphOps(out.nodes, out.edges, [
      { op: "connectNodes", source: "request-inputs", sourceHandle: "field_text_default", target: llmId, targetHandle: "in:prompt" },
      { op: "connectNodes", source: llmId, sourceHandle: "out:response", target: "response", targetHandle: "result" },
    ]);
    expect(wired.edges).toHaveLength(2);
  });

  it("rejects an invalid target input key", () => {
    const { nodes, edges } = emptyGraph();
    const out = applyGraphOps(nodes, edges, [{ op: "addNode", nodeType: "openRouter" }]);
    const llmId = out.results[0].nodeId!;
    expect(() =>
      applyGraphOps(out.nodes, out.edges, [
        { op: "connectNodes", source: "request-inputs", sourceHandle: "field_text_default", target: llmId, targetHandle: "in:bogus" },
      ])
    ).toThrow(/has no input/);
  });

  it("enforces single-input on non-fan-in handles", () => {
    const { nodes, edges } = emptyGraph();
    let g = applyGraphOps(nodes, edges, [
      { op: "addNode", nodeType: "openRouter" },
      { op: "addNode", nodeType: "openRouter" },
    ]);
    const [a, b] = g.results.map((r) => r.nodeId!);
    g = applyGraphOps(g.nodes, g.edges, [
      { op: "connectNodes", source: a, sourceHandle: "out:response", target: b, targetHandle: "in:prompt" },
    ]);
    expect(() =>
      applyGraphOps(g.nodes, g.edges, [
        { op: "connectNodes", source: "request-inputs", sourceHandle: "field_text_default", target: b, targetHandle: "in:prompt" },
      ])
    ).toThrow(/already has an incoming edge/);
  });

  it("allows fan-in into in:image_urls", () => {
    const { nodes, edges } = emptyGraph();
    let g = applyGraphOps(nodes, edges, [
      { op: "addNode", nodeType: "cropImage" },
      { op: "addNode", nodeType: "cropImage" },
      { op: "addNode", nodeType: "openRouter" },
    ]);
    const [c1, c2, llm] = g.results.map((r) => r.nodeId!);
    g = applyGraphOps(g.nodes, g.edges, [
      { op: "connectNodes", source: c1, sourceHandle: "out:outputImage", target: llm, targetHandle: "in:image_urls" },
      { op: "connectNodes", source: c2, sourceHandle: "out:outputImage", target: llm, targetHandle: "in:image_urls" },
    ]);
    expect(g.edges.filter((e) => e.targetHandle === "in:image_urls")).toHaveLength(2);
  });

  it("prevents cycles", () => {
    const { nodes, edges } = emptyGraph();
    let g = applyGraphOps(nodes, edges, [
      { op: "addNode", nodeType: "openRouter" },
      { op: "addNode", nodeType: "openRouter" },
    ]);
    const [a, b] = g.results.map((r) => r.nodeId!);
    g = applyGraphOps(g.nodes, g.edges, [
      { op: "connectNodes", source: a, sourceHandle: "out:response", target: b, targetHandle: "in:prompt" },
    ]);
    expect(() =>
      applyGraphOps(g.nodes, g.edges, [
        { op: "connectNodes", source: b, sourceHandle: "out:response", target: a, targetHandle: "in:prompt" },
      ])
    ).toThrow(/cycle/);
  });

  it("cannot delete scaffold nodes", () => {
    const { nodes, edges } = emptyGraph();
    expect(() => applyGraphOps(nodes, edges, [{ op: "deleteNode", nodeId: "response" }])).toThrow(/scaffold/);
  });

  it("deleteNode removes connected edges", () => {
    const { nodes, edges } = emptyGraph();
    let g = applyGraphOps(nodes, edges, [{ op: "addNode", nodeType: "openRouter" }]);
    const llm = g.results[0].nodeId!;
    g = applyGraphOps(g.nodes, g.edges, [
      { op: "connectNodes", source: "request-inputs", sourceHandle: "field_text_default", target: llm, targetHandle: "in:prompt" },
    ]);
    expect(g.edges).toHaveLength(1);
    g = applyGraphOps(g.nodes, g.edges, [{ op: "deleteNode", nodeId: llm }]);
    expect(g.edges).toHaveLength(0);
    expect(g.nodes.find((n) => n.id === llm)).toBeUndefined();
  });
});
