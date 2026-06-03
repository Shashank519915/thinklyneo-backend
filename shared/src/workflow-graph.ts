/**
 * @fileoverview Which nodes belong to a workflow run (main path + scoped partial/single).
 */

export type GraphNode = { id: string; type: string };
export type GraphEdge = { source: string; target: string };

function forwardReachable(startId: string, edges: GraphEdge[]): Set<string> {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    const list = adj.get(e.source) ?? [];
    list.push(e.target);
    adj.set(e.source, list);
  }
  const seen = new Set<string>();
  const queue = [startId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const next of adj.get(id) ?? []) {
      if (!seen.has(next)) queue.push(next);
    }
  }
  return seen;
}

function backwardReachable(endId: string, edges: GraphEdge[]): Set<string> {
  const rev = new Map<string, string[]>();
  for (const e of edges) {
    const list = rev.get(e.target) ?? [];
    list.push(e.source);
    rev.set(e.target, list);
  }
  const seen = new Set<string>();
  const queue = [endId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const prev of rev.get(id) ?? []) {
      if (!seen.has(prev)) queue.push(prev);
    }
  }
  return seen;
}

/**
 * Nodes on at least one path from Request-Inputs → Response (excludes orphan islands).
 */
export function getRunnableNodeIds(nodes: GraphNode[], edges: GraphEdge[]): Set<string> {
  const request = nodes.find((n) => n.type === "requestInputs");
  const response = nodes.find((n) => n.type === "response");
  if (!request || !response) {
    return new Set(nodes.map((n) => n.id));
  }

  const downstream = forwardReachable(request.id, edges);
  const upstream = backwardReachable(response.id, edges);
  const ids = new Set<string>([request.id, response.id]);
  for (const id of downstream) {
    if (upstream.has(id)) ids.add(id);
  }
  return ids;
}

/** Target ids plus transitive upstream deps (mirrors orchestrator getNodeWithDeps). */
export function getScopedRunNodeIds(
  nodes: GraphNode[],
  edges: GraphEdge[],
  targetIds: string[],
  existingOutputIds: Iterable<string> = []
): Set<string> {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const cached = new Set(existingOutputIds);
  const toExecute = new Set<string>();
  const forceRun = new Set(targetIds);

  function collectDeps(id: string, isTarget: boolean) {
    if (toExecute.has(id)) return;
    if (!isTarget && cached.has(id)) return;
    toExecute.add(id);
    for (const edge of edges) {
      if (edge.target === id) collectDeps(edge.source, false);
    }
  }

  for (const id of targetIds) {
    if (nodeMap.has(id)) collectDeps(id, forceRun.has(id));
  }
  return toExecute;
}

export function resolveActiveRunNodeIds(
  nodes: GraphNode[],
  edges: GraphEdge[],
  scope: "full" | "partial" | "single",
  targetNodeIds?: string[],
  existingOutputIds?: Iterable<string>
): Set<string> {
  if ((scope === "single" || scope === "partial") && targetNodeIds?.length) {
    return getScopedRunNodeIds(nodes, edges, targetNodeIds, existingOutputIds);
  }
  return getRunnableNodeIds(nodes, edges);
}
