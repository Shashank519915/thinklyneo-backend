/**
 * @fileoverview Pure, validated graph mutation engine for the MCP graph-editing tools.
 *
 * `applyGraphOps` takes the current React-Flow style nodes/edges of a workflow plus an
 * ordered list of operations (addNode / updateNode / connectNodes / disconnectNodes /
 * deleteNode) and returns the new nodes/edges. Every op is validated; the first invalid op
 * throws {@link GraphOpError} and NO partial mutation is returned (the caller persists only
 * on success), giving the agent precise, self-correcting errors.
 *
 * Read-only over `@shashank519915/shared` (definitions + default inputs). No DB, no I/O.
 */

import {
  EXECUTABLE_NODE_DEFINITIONS,
  buildDefaultNodeInputs,
} from "@shashank519915/shared";
import {
  FAN_IN_TARGET_HANDLES,
  hasCycle,
  isValidConnection,
} from "./graph-validation";

export class GraphOpError extends Error {}

export interface GraphNode {
  id: string;
  type: string;
  position?: { x: number; y: number };
  data?: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  type?: string;
}

export type GraphOp =
  | {
      op: "addNode";
      nodeType: string;
      label?: string;
      column?: number;
      row?: number;
      position?: { x: number; y: number };
      inputs?: Record<string, unknown>;
    }
  | { op: "updateNode"; nodeId: string; inputs?: Record<string, unknown>; label?: string; position?: { x: number; y: number } }
  | { op: "connectNodes"; source: string; sourceHandle: string; target: string; targetHandle: string }
  | { op: "disconnectNodes"; edgeId?: string; source?: string; target?: string; sourceHandle?: string; targetHandle?: string }
  | { op: "deleteNode"; nodeId: string };

export interface GraphOpResult {
  op: string;
  nodeId?: string;
  edgeId?: string;
  removedEdgeIds?: string[];
  inputPorts?: Array<{ handle: string; type: string }>;
  outputPorts?: Array<{ handle: string; type: string }>;
  message?: string;
}

const SCAFFOLD_TYPES = new Set(["requestInputs", "response"]);
const COL_BASE_X = 120;
const COL_SPACING_X = 360;
const ROW_BASE_Y = 80;
const ROW_SPACING_Y = 240;

function shortId(): string {
  return Math.random().toString(36).slice(2, 8);
}

function uniqueId(base: string, taken: Set<string>): string {
  let id = `${base}-${shortId()}`;
  while (taken.has(id)) id = `${base}-${shortId()}`;
  return id;
}

function defFor(nodeType: string) {
  return EXECUTABLE_NODE_DEFINITIONS[nodeType];
}

function inputKeys(nodeType: string): Set<string> {
  const def = defFor(nodeType);
  return new Set((def?.inputs ?? []).map((i) => i.key));
}

function outputKeys(nodeType: string): Set<string> {
  const def = defFor(nodeType);
  return new Set((def?.outputs ?? []).map((o) => o.key));
}

function findNode(nodes: GraphNode[], id: string): GraphNode | undefined {
  return nodes.find((n) => n.id === id);
}

/** Validate that a source handle exists for the given source node. */
function assertValidSourceHandle(node: GraphNode, handle: string) {
  if (node.type === "response") {
    throw new GraphOpError(`Node "${node.id}" (response) is a terminal node and cannot be a connection source.`);
  }
  if (node.type === "requestInputs") {
    const fields = (node.data?.fields as Array<{ id: string }> | undefined) ?? [];
    const ids = fields.map((f) => f.id);
    if (!ids.includes(handle)) {
      throw new GraphOpError(
        `Request-Inputs node "${node.id}" has no field "${handle}". Available field handles: ${ids.join(", ") || "(none)"}.`
      );
    }
    return;
  }
  // executable
  if (!handle.startsWith("out:")) {
    throw new GraphOpError(`Source handle "${handle}" must be an output port like "out:<key>".`);
  }
  const key = handle.slice(4);
  const keys = outputKeys(node.type);
  if (!keys.has(key)) {
    throw new GraphOpError(
      `Node "${node.id}" (${node.type}) has no output "${key}". Valid outputs: ${[...keys].map((k) => `out:${k}`).join(", ")}.`
    );
  }
}

/** Validate that a target handle exists for the given target node. */
function assertValidTargetHandle(node: GraphNode, handle: string) {
  if (node.type === "requestInputs") {
    throw new GraphOpError(`Node "${node.id}" (requestInputs) is the entry node and cannot be a connection target.`);
  }
  if (node.type === "response") {
    const slots = (node.data?.results as Array<{ id: string }> | undefined) ?? [];
    const ids = new Set(["result", ...slots.map((s) => s.id)]);
    if (!ids.has(handle)) {
      throw new GraphOpError(
        `Response node "${node.id}" has no result slot "${handle}". Use "result" or an existing slot: ${[...ids].join(", ")}.`
      );
    }
    return;
  }
  // executable
  if (!handle.startsWith("in:")) {
    throw new GraphOpError(`Target handle "${handle}" must be an input port like "in:<key>".`);
  }
  const key = handle.slice(3);
  const keys = inputKeys(node.type);
  // "in:images" is a runtime alias for image_urls fan-in.
  if (key === "images" && keys.has("image_urls")) return;
  if (!keys.has(key)) {
    throw new GraphOpError(
      `Node "${node.id}" (${node.type}) has no input "${key}". Valid inputs: ${[...keys].map((k) => `in:${k}`).join(", ")}.`
    );
  }
}

function applyAddNode(nodes: GraphNode[], op: Extract<GraphOp, { op: "addNode" }>): GraphOpResult {
  const def = defFor(op.nodeType);
  if (!def) {
    throw new GraphOpError(
      `Unknown node type "${op.nodeType}". Call list_node_types for valid executable node types. (Scaffold nodes requestInputs/response are created with the workflow and cannot be added.)`
    );
  }
  const taken = new Set(nodes.map((n) => n.id));
  const id = uniqueId(op.nodeType, taken);

  const position =
    op.position ??
    (op.column !== undefined || op.row !== undefined
      ? {
          x: COL_BASE_X + (op.column ?? 0) * COL_SPACING_X,
          y: ROW_BASE_Y + (op.row ?? 0) * ROW_SPACING_Y,
        }
      : { x: 400, y: 200 });

  const defaults = buildDefaultNodeInputs(def);
  const inputs = { ...defaults, ...(op.inputs ?? {}) };

  nodes.push({
    id,
    type: op.nodeType,
    position,
    data: { label: op.label ?? def.name, inputs, output: null },
  });

  return {
    op: "addNode",
    nodeId: id,
    inputPorts: def.inputs.map((i) => ({ handle: `in:${i.key}`, type: i.handle?.type ?? "text" })),
    outputPorts: def.outputs.map((o) => ({ handle: `out:${o.key}`, type: o.type })),
    message: `Added ${def.name} as "${id}".`,
  };
}

function applyUpdateNode(nodes: GraphNode[], op: Extract<GraphOp, { op: "updateNode" }>): GraphOpResult {
  const node = findNode(nodes, op.nodeId);
  if (!node) throw new GraphOpError(`Node "${op.nodeId}" not found.`);
  if (SCAFFOLD_TYPES.has(node.type) && op.inputs) {
    throw new GraphOpError(
      `Node "${op.nodeId}" is a ${node.type} scaffold node; edit its fields/results through workflow tools, not update_node inputs.`
    );
  }
  node.data = node.data ?? {};
  if (op.label !== undefined) node.data.label = op.label;
  if (op.position) node.position = op.position;
  if (op.inputs) {
    const existing = (node.data.inputs as Record<string, unknown> | undefined) ?? {};
    node.data.inputs = { ...existing, ...op.inputs };
  }
  return { op: "updateNode", nodeId: op.nodeId, message: `Updated "${op.nodeId}".` };
}

function applyConnectNodes(
  nodes: GraphNode[],
  edges: GraphEdge[],
  op: Extract<GraphOp, { op: "connectNodes" }>
): GraphOpResult {
  const sourceNode = findNode(nodes, op.source);
  const targetNode = findNode(nodes, op.target);
  if (!sourceNode) throw new GraphOpError(`Source node "${op.source}" not found.`);
  if (!targetNode) throw new GraphOpError(`Target node "${op.target}" not found.`);
  if (op.source === op.target) throw new GraphOpError("Cannot connect a node to itself.");

  assertValidSourceHandle(sourceNode, op.sourceHandle);
  assertValidTargetHandle(targetNode, op.targetHandle);

  if (!isValidConnection(op.sourceHandle, op.targetHandle, sourceNode.type, targetNode.type)) {
    throw new GraphOpError(
      `Incompatible handle types: "${op.sourceHandle}" (${sourceNode.type}) → "${op.targetHandle}" (${targetNode.type}).`
    );
  }

  // Single-input rule: a non-fan-in target handle accepts only one incoming edge.
  if (!FAN_IN_TARGET_HANDLES.has(op.targetHandle)) {
    const occupied = edges.find((e) => e.target === op.target && e.targetHandle === op.targetHandle);
    if (occupied) {
      throw new GraphOpError(
        `Target handle "${op.targetHandle}" on "${op.target}" already has an incoming edge (${occupied.id}). Disconnect it first, or use a fan-in handle (in:image_urls/in:video_urls/in:audio_urls).`
      );
    }
  }

  if (hasCycle(nodes, edges, { source: op.source, target: op.target })) {
    throw new GraphOpError("This connection would create a cycle.");
  }

  const taken = new Set(edges.map((e) => e.id));
  const id = uniqueId(`edge-${op.source}-${op.target}`, taken);
  edges.push({
    id,
    source: op.source,
    target: op.target,
    sourceHandle: op.sourceHandle,
    targetHandle: op.targetHandle,
    type: "animatedEdge",
  });
  return { op: "connectNodes", edgeId: id, message: `Connected ${op.source}:${op.sourceHandle} → ${op.target}:${op.targetHandle}.` };
}

function applyDisconnectNodes(edges: GraphEdge[], op: Extract<GraphOp, { op: "disconnectNodes" }>): {
  edges: GraphEdge[];
  result: GraphOpResult;
} {
  let removed: GraphEdge[];
  if (op.edgeId) {
    removed = edges.filter((e) => e.id === op.edgeId);
  } else if (op.source && op.target) {
    removed = edges.filter(
      (e) =>
        e.source === op.source &&
        e.target === op.target &&
        (op.sourceHandle === undefined || e.sourceHandle === op.sourceHandle) &&
        (op.targetHandle === undefined || e.targetHandle === op.targetHandle)
    );
  } else {
    throw new GraphOpError("disconnectNodes requires either edgeId or both source and target.");
  }
  if (removed.length === 0) throw new GraphOpError("No matching edge found to disconnect.");
  const removedIds = new Set(removed.map((e) => e.id));
  const next = edges.filter((e) => !removedIds.has(e.id));
  return {
    edges: next,
    result: { op: "disconnectNodes", removedEdgeIds: [...removedIds], message: `Removed ${removedIds.size} edge(s).` },
  };
}

function applyDeleteNode(
  nodes: GraphNode[],
  edges: GraphEdge[],
  op: Extract<GraphOp, { op: "deleteNode" }>
): { nodes: GraphNode[]; edges: GraphEdge[]; result: GraphOpResult } {
  const node = findNode(nodes, op.nodeId);
  if (!node) throw new GraphOpError(`Node "${op.nodeId}" not found.`);
  if (SCAFFOLD_TYPES.has(node.type)) {
    throw new GraphOpError(`Cannot delete scaffold node "${op.nodeId}" (${node.type}). Every workflow must keep requestInputs and response.`);
  }
  const nextNodes = nodes.filter((n) => n.id !== op.nodeId);
  const removed = edges.filter((e) => e.source === op.nodeId || e.target === op.nodeId);
  const removedIds = new Set(removed.map((e) => e.id));
  const nextEdges = edges.filter((e) => !removedIds.has(e.id));
  return {
    nodes: nextNodes,
    edges: nextEdges,
    result: {
      op: "deleteNode",
      nodeId: op.nodeId,
      removedEdgeIds: [...removedIds],
      message: `Deleted "${op.nodeId}" and ${removedIds.size} connected edge(s).`,
    },
  };
}

/**
 * Apply ops sequentially to clones of nodes/edges. Throws GraphOpError on the first invalid
 * op (no partial result). Returns the new graph plus a per-op result list.
 */
export function applyGraphOps(
  inputNodes: GraphNode[],
  inputEdges: GraphEdge[],
  ops: GraphOp[]
): { nodes: GraphNode[]; edges: GraphEdge[]; results: GraphOpResult[] } {
  let nodes: GraphNode[] = structuredClone(inputNodes);
  let edges: GraphEdge[] = structuredClone(inputEdges);
  const results: GraphOpResult[] = [];

  for (const op of ops) {
    switch (op.op) {
      case "addNode":
        results.push(applyAddNode(nodes, op));
        break;
      case "updateNode":
        results.push(applyUpdateNode(nodes, op));
        break;
      case "connectNodes":
        results.push(applyConnectNodes(nodes, edges, op));
        break;
      case "disconnectNodes": {
        const r = applyDisconnectNodes(edges, op);
        edges = r.edges;
        results.push(r.result);
        break;
      }
      case "deleteNode": {
        const r = applyDeleteNode(nodes, edges, op);
        nodes = r.nodes;
        edges = r.edges;
        results.push(r.result);
        break;
      }
      default:
        throw new GraphOpError(`Unknown op "${(op as { op: string }).op}".`);
    }
  }

  return { nodes, edges, results };
}
