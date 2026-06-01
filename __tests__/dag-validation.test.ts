import { describe, it, expect } from "vitest";
import { hasCycle, validateNewEdge } from "@/lib/execution";
import type { Node, Edge } from "@xyflow/react";

function node(id: string): Node {
  return { id, type: "cropImage", position: { x: 0, y: 0 }, data: {} };
}

function edge(source: string, target: string): Edge {
  return { id: `${source}-${target}`, source, target };
}

describe("DAG cycle validation", () => {
  it("accepts a simple acyclic graph", () => {
    const nodes = [node("a"), node("b"), node("c")];
    const edges = [edge("a", "b"), edge("b", "c")];
    expect(hasCycle(nodes, edges)).toBe(false);
  });

  it("detects a cycle in the graph", () => {
    const nodes = [node("a"), node("b"), node("c")];
    const edges = [edge("a", "b"), edge("b", "c"), edge("c", "a")];
    expect(hasCycle(nodes, edges)).toBe(true);
  });

  it("detects a cycle introduced by a new edge", () => {
    const nodes = [node("a"), node("b"), node("c")];
    const edges = [edge("a", "b"), edge("b", "c")];
    const result = validateNewEdge(nodes, edges, { source: "c", target: "a" });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/cycle/i);
  });

  it("allows a valid new edge", () => {
    const nodes = [node("a"), node("b"), node("c")];
    const edges = [edge("a", "b")];
    const result = validateNewEdge(nodes, edges, { source: "b", target: "c" });
    expect(result.valid).toBe(true);
  });
});
