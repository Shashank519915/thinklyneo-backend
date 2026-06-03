/**
 * Pure DAG helpers for the workflow orchestrator — no Prisma or Trigger SDK.
 * Used by workflowOrchestrator.ts and unit-tested directly.
 */

/** Serialized node from React Flow — fields needed for execution. */
export interface SerializedNode {
  id: string;
  type: string;
  data: Record<string, unknown>;
}

/** Serialized edge from React Flow. */
export interface SerializedEdge {
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

/** Mirrors orchestrator metadata node state (subset used for scheduling). */
export type OrchestratorNodeStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped";

export interface OrchestratorNodeState {
  status: OrchestratorNodeStatus;
  output?: unknown;
  error?: string;
}

/**
 * Nodes that are pending and whose upstream dependencies are all terminal (ready layer).
 */
export function collectReadyPendingNodes(
  sortedNodes: SerializedNode[],
  deps: Map<string, Set<string>>,
  nodeStates: Record<string, OrchestratorNodeState>
): SerializedNode[] {
  const ready: SerializedNode[] = [];

  for (const node of sortedNodes) {
    const currentState = nodeStates[node.id];
    if (!currentState || currentState.status !== "pending") {
      continue;
    }

    const upstreamDeps = deps.get(node.id) ?? new Set();
    let allParentsFinished = true;
    let hasFailedParent = false;

    for (const depId of upstreamDeps) {
      const depState = nodeStates[depId];
      if (!depState) {
        allParentsFinished = false;
        break;
      }
      if (depState.status === "pending" || depState.status === "running") {
        allParentsFinished = false;
        break;
      }
      if (depState.status === "failed" || depState.status === "skipped") {
        hasFailedParent = true;
      }
    }

    if (!allParentsFinished || hasFailedParent) {
      continue;
    }

    ready.push(node);
  }

  return ready;
}

/**
 * Kahn-style topological sort for deterministic execution order.
 */
export function topologicalSort(
  nodes: SerializedNode[],
  edges: SerializedEdge[]
): SerializedNode[] {
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  const nodeMap = new Map<string, SerializedNode>();

  for (const n of nodes) {
    inDegree.set(n.id, 0);
    adjacency.set(n.id, []);
    nodeMap.set(n.id, n);
  }

  for (const e of edges) {
    if (!nodeMap.has(e.source) || !nodeMap.has(e.target)) continue;
    const arr = adjacency.get(e.source) ?? [];
    arr.push(e.target);
    adjacency.set(e.source, arr);
    inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const [id, degree] of inDegree.entries()) {
    if (degree === 0) queue.push(id);
  }

  const sorted: SerializedNode[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const node = nodeMap.get(id);
    if (node) sorted.push(node);
    for (const neighbor of adjacency.get(id) ?? []) {
      const newDegree = (inDegree.get(neighbor) ?? 0) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) queue.push(neighbor);
    }
  }

  return sorted;
}

/**
 * Builds execution frontier for selective runs — targeted ids plus transitive deps.
 */
export function getNodeWithDeps(
  nodes: SerializedNode[],
  edges: SerializedEdge[],
  targetIds: string[],
  existingOutputs: Set<string>
): SerializedNode[] {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const toExecute = new Set<string>();
  const forceRun = new Set(targetIds);

  function collectDeps(id: string, isTarget: boolean) {
    if (toExecute.has(id)) return;
    if (!isTarget && existingOutputs.has(id)) return;
    toExecute.add(id);
    for (const edge of edges) {
      if (edge.target === id) {
        collectDeps(edge.source, false);
      }
    }
  }

  for (const id of targetIds) {
    collectDeps(id, forceRun.has(id));
  }

  const selectedNodes = Array.from(toExecute)
    .map((id) => nodeMap.get(id))
    .filter((n): n is SerializedNode => n !== undefined);

  return topologicalSort(selectedNodes, edges);
}

/**
 * Merges static node data, Request-Inputs overlays, edge fan-in, and Gemini vision arrays.
 */
export function resolveInputsForNode(
  node: SerializedNode,
  edges: SerializedEdge[],
  resolvedOutputs: Map<string, unknown>,
  inputValues: Record<string, unknown>
): Record<string, unknown> {
  const inputs: Record<string, unknown> = {};

  const data = node.data;
  if (data["inputs"] && typeof data["inputs"] === "object") {
    Object.assign(inputs, data["inputs"] as Record<string, unknown>);
  }
  if (data["fields"] && Array.isArray(data["fields"])) {
    for (const f of data["fields"] as Array<{ id: string; value: unknown }>) {
      inputs[f.id] = f.value;
    }
  }

  if (node.type === "requestInputs") {
    for (const [k, v] of Object.entries(inputValues)) {
      inputs[k] = v;
    }
    return inputs;
  }

  const incomingEdges = edges.filter((e) => e.target === node.id);
  for (const edge of incomingEdges) {
    const sourceOutput = resolvedOutputs.get(edge.source);
    if (sourceOutput === undefined) continue;

    const targetHandle = edge.targetHandle ?? "input";
    const sourceHandle = edge.sourceHandle ?? "";

    let valueToPass: unknown = sourceOutput;
    if (
      sourceOutput !== null &&
      typeof sourceOutput === "object" &&
      !Array.isArray(sourceOutput) &&
      sourceHandle
    ) {
      const obj = sourceOutput as Record<string, unknown>;
      const key = sourceHandle.startsWith("out:") ? sourceHandle.slice(4) : sourceHandle;
      if (key in obj) {
        valueToPass = obj[key];
      } else if (sourceHandle in obj) {
        valueToPass = obj[sourceHandle];
      }
    }

    if (targetHandle === "in:images") {
      const existingImages = (inputs["images"] as unknown[]) ?? [];
      if (valueToPass !== null && valueToPass !== undefined) {
        inputs["images"] = [...existingImages, valueToPass];
      } else {
        inputs["images"] = existingImages;
      }
    } else if (targetHandle === "in:video_urls") {
      const existingVideos = (inputs["video_urls"] as unknown[]) ?? [];
      if (valueToPass !== null && valueToPass !== undefined) {
        inputs["video_urls"] = [...existingVideos, valueToPass];
      } else {
        inputs["video_urls"] = existingVideos;
      }
    } else {
      const key = targetHandle.startsWith("in:") ? targetHandle.slice(3) : targetHandle;
      inputs[key] = valueToPass;
    }
  }

  return inputs;
}
