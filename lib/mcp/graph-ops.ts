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
  data?: Record<string, unknown>;
  markerEnd?: Record<string, unknown>;
}

/**
 * Ensure a raw edge (e.g. from update_workflow PUT body) has the React Flow fields
 * required for correct canvas rendering: `type`, `data.color`, and `markerEnd`.
 * Safe to call on already-normalized edges — only fills missing fields.
 */
export function normalizeEdge(edge: GraphEdge, nodes: GraphNode[]): GraphEdge {
  if (edge.type && edge.data && edge.markerEnd) return edge;

  const sourceNode = nodes.find((n) => n.id === edge.source);
  const color = sourceNode ? resolveEdgeColor(sourceNode, edge.sourceHandle ?? "") : "#7C3AED";

  return {
    ...edge,
    type: edge.type ?? "animatedEdge",
    data: edge.data ?? { color },
    markerEnd: edge.markerEnd ?? {
      type: "arrowclosed",
      color,
      width: 16,
      height: 16,
    },
  };
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

// Handle type → edge stroke color (mirrors frontend lib/utils HANDLE_COLORS).
const HANDLE_TYPE_COLORS: Record<string, string> = {
  image:   "#F97316",
  text:    "#F59E0B",
  video:   "#10B981",
  audio:   "#EC4899",
  number:  "#EC4899",
  boolean: "#6366F1",
  generic: "#3B82F6",
};

/**
 * Derive the edge stroke/arrow color from the source node's output handle definition.
 * Falls back to a neutral purple if the handle or definition is not found.
 */
function resolveEdgeColor(sourceNode: GraphNode, sourceHandle: string): string {
  // Request-Inputs fields don't have a typed output — use neutral color.
  if (sourceNode.type === "requestInputs") return "#7C3AED";

  if (sourceHandle.startsWith("out:")) {
    const key = sourceHandle.slice(4);
    const def = defFor(sourceNode.type);
    const output = def?.outputs?.find((o) => o.key === key);
    if (output?.handle?.color) return output.handle.color as string;
    if (output?.type && HANDLE_TYPE_COLORS[output.type]) return HANDLE_TYPE_COLORS[output.type];
  }
  return "#7C3AED";
}

/** Label for a new Response slot — mirrors frontend Canvas.resolveResultLabel. */
function resolveResultLabel(
  sourceNode: GraphNode | undefined,
  sourceHandle: string | null | undefined
): string {
  if (!sourceNode) return "Result";
  if (sourceNode.type === "requestInputs") return "Request Input";
  const def = defFor(sourceNode.type);
  if (def) {
    const key = sourceHandle?.replace(/^out:/, "");
    const outLabel = key ? def.outputs?.find((o) => o.key === key)?.label : undefined;
    return outLabel || def.name || "Result";
  }
  return "Result";
}

interface ResponseResultSlot {
  id: string;
  label: string;
  value: unknown;
}

/**
 * When connecting to the Response node's drop zone (`targetHandle === "result"`) on an empty
 * canvas, mirror the frontend: append a `res_*` slot to `data.results` and wire the edge to
 * that slot id. Pre-seeded templates (e.g. advertisement with id `"result"`) keep using `"result"`.
 */
function ensureResponseResultSlot(
  targetNode: GraphNode,
  sourceNode: GraphNode | undefined,
  sourceHandle: string,
  targetHandle: string
): string {
  if (targetNode.type !== "response" || targetHandle !== "result") return targetHandle;

  targetNode.data = targetNode.data ?? {};
  const existingResults = (targetNode.data.results as ResponseResultSlot[] | undefined) ?? [];
  if (existingResults.some((r) => r.id === "result")) return "result";

  const newResultId = `res_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  targetNode.data.results = [
    ...existingResults,
    { id: newResultId, label: resolveResultLabel(sourceNode, sourceHandle), value: null },
  ];
  return newResultId;
}

type RequestFieldRecord = {
  id: string;
  type?: string;
  value?: unknown;
  linkedTarget?: { nodeId: string; handle: string };
  mediaMaxCount?: number;
};

const ARRAY_MEDIA_INPUT_KEYS = new Set([
  "images",
  "uploadedImages",
  "image_urls",
  "video_urls",
  "audio_urls",
]);

function parseMediaList(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((x): x is string => typeof x === "string" && x.length > 0);
  }
  if (typeof raw === "string" && raw.length > 0) {
    return raw.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

function coerceRequestFieldValueForInput(field: RequestFieldRecord, paramKey: string): unknown {
  const v = field.value;
  if (field.type === "boolean_field") return v === "true";
  if (field.type === "number_field" || field.type === "slider_field") {
    if (v === null || v === undefined || v === "") return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  if (v === null || v === undefined) return undefined;

  if (
    field.type === "image_field" ||
    field.type === "video_field" ||
    field.type === "audio_field"
  ) {
    const urls = parseMediaList(v);
    if (ARRAY_MEDIA_INPUT_KEYS.has(paramKey)) return urls;
    if (field.mediaMaxCount === 1) return urls[0] ?? null;
    return urls.length <= 1 ? (urls[0] ?? null) : urls.join(",");
  }

  if (field.type === "file_field") {
    const urls = parseMediaList(v);
    return urls[0] ?? (typeof v === "string" ? v : null);
  }

  return v;
}

/** Mirrors canvas “Add to request”: mark the field as promoted to a target handle. */
function linkRequestFieldToTarget(
  nodes: GraphNode[],
  requestNodeId: string,
  fieldId: string,
  targetNodeId: string,
  targetHandle: string
) {
  const req = findNode(nodes, requestNodeId);
  if (!req || req.type !== "requestInputs") return;

  req.data = req.data ?? {};
  const fields = (req.data.fields as RequestFieldRecord[] | undefined) ?? [];
  const idx = fields.findIndex((f) => f.id === fieldId);
  if (idx < 0) return;

  const nextLink = { nodeId: targetNodeId, handle: targetHandle };
  const existing = fields[idx].linkedTarget;
  if (
    existing &&
    (existing.nodeId !== targetNodeId || existing.handle !== targetHandle)
  ) {
    // Same field wired to a second handle (e.g. duration + duration_text): keep the first link
    // so canvas promotion stays stable; run-time still resolves all edges.
    if (existing.nodeId !== targetNodeId) {
      fields[idx] = { ...fields[idx], linkedTarget: nextLink };
    }
  } else {
    fields[idx] = { ...fields[idx], linkedTarget: nextLink };
  }
  req.data.fields = fields;
}

/** Copy the request field's current value onto the target node's `inputs` bag. */
function syncTargetInputFromRequestField(
  nodes: GraphNode[],
  requestNodeId: string,
  fieldId: string,
  targetNodeId: string,
  targetHandle: string
) {
  const req = findNode(nodes, requestNodeId);
  const target = findNode(nodes, targetNodeId);
  if (!req || req.type !== "requestInputs" || !target || target.type === "response") return;

  const fields = (req.data?.fields as RequestFieldRecord[] | undefined) ?? [];
  const field = fields.find((f) => f.id === fieldId);
  if (!field) return;

  const paramKey = targetHandle.startsWith("in:") ? targetHandle.slice(3) : targetHandle;
  const coerced = coerceRequestFieldValueForInput(field, paramKey);
  if (coerced === undefined) return;

  target.data = target.data ?? {};
  const inputs = (target.data.inputs as Record<string, unknown> | undefined) ?? {};
  target.data.inputs = { ...inputs, [paramKey]: coerced };
}

function clearRequestFieldLinkForEdge(
  nodes: GraphNode[],
  edge: GraphEdge
) {
  const source = findNode(nodes, edge.source);
  if (!source || source.type !== "requestInputs" || !edge.sourceHandle) return;

  source.data = source.data ?? {};
  const fields = (source.data.fields as RequestFieldRecord[] | undefined) ?? [];
  let changed = false;
  const nextFields = fields.map((f) => {
    if (f.id !== edge.sourceHandle) return f;
    const link = f.linkedTarget;
    if (
      !link ||
      link.nodeId !== edge.target ||
      link.handle !== edge.targetHandle
    ) {
      return f;
    }
    changed = true;
    const { linkedTarget: _removed, ...rest } = f;
    return rest;
  });
  if (changed) source.data.fields = nextFields;
}

/** Remove Response result slots orphaned by disconnecting edges (mirrors workflow-store onEdgesChange). */
function pruneResponseResultSlots(nodes: GraphNode[], removedEdges: GraphEdge[]) {
  for (const edge of removedEdges) {
    const targetNode = findNode(nodes, edge.target);
    if (targetNode?.type !== "response") continue;
    const resultId = edge.targetHandle;
    if (!resultId || resultId === "result") continue;

    targetNode.data = targetNode.data ?? {};
    const existingResults = (targetNode.data.results as ResponseResultSlot[] | undefined) ?? [];
    targetNode.data.results = existingResults.filter((r) => r.id !== resultId);
  }
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

  const effectiveTargetHandle = ensureResponseResultSlot(
    targetNode,
    sourceNode,
    op.sourceHandle,
    op.targetHandle
  );

  if (!isValidConnection(op.sourceHandle, effectiveTargetHandle, sourceNode.type, targetNode.type)) {
    throw new GraphOpError(
      `Incompatible handle types: "${op.sourceHandle}" (${sourceNode.type}) → "${effectiveTargetHandle}" (${targetNode.type}).`
    );
  }

  // Single-input rule: a non-fan-in target handle accepts only one incoming edge.
  if (!FAN_IN_TARGET_HANDLES.has(effectiveTargetHandle)) {
    const occupied = edges.find(
      (e) => e.target === op.target && e.targetHandle === effectiveTargetHandle
    );
    if (occupied) {
      throw new GraphOpError(
        `Target handle "${effectiveTargetHandle}" on "${op.target}" already has an incoming edge (${occupied.id}). Disconnect it first, or use a fan-in handle (in:image_urls/in:video_urls/in:audio_urls).`
      );
    }
  }

  if (hasCycle(nodes, edges, { source: op.source, target: op.target })) {
    throw new GraphOpError("This connection would create a cycle.");
  }

  const taken = new Set(edges.map((e) => e.id));
  const id = uniqueId(`edge-${op.source}-${op.target}`, taken);

  // Resolve edge color from the source output handle so the frontend renders
  // the arrowhead and stroke in the correct type color (same as manual onConnect).
  const edgeColor = resolveEdgeColor(sourceNode, op.sourceHandle);

  edges.push({
    id,
    source: op.source,
    target: op.target,
    sourceHandle: op.sourceHandle,
    targetHandle: effectiveTargetHandle,
    type: "animatedEdge",
    data: { color: edgeColor },
    markerEnd: {
      type: "arrowclosed",
      color: edgeColor,
      width: 16,
      height: 16,
    },
  });

  if (sourceNode.type === "requestInputs") {
    linkRequestFieldToTarget(
      nodes,
      op.source,
      op.sourceHandle,
      op.target,
      effectiveTargetHandle
    );
    syncTargetInputFromRequestField(
      nodes,
      op.source,
      op.sourceHandle,
      op.target,
      effectiveTargetHandle
    );
  }

  return {
    op: "connectNodes",
    edgeId: id,
    message: `Connected ${op.source}:${op.sourceHandle} → ${op.target}:${effectiveTargetHandle}.`,
  };
}

function applyDisconnectNodes(
  nodes: GraphNode[],
  edges: GraphEdge[],
  op: Extract<GraphOp, { op: "disconnectNodes" }>
): {
  nodes: GraphNode[];
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
  for (const edge of removed) clearRequestFieldLinkForEdge(nodes, edge);
  pruneResponseResultSlots(nodes, removed);
  return {
    nodes,
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
  const removed = edges.filter((e) => e.source === op.nodeId || e.target === op.nodeId);
  const removedIds = new Set(removed.map((e) => e.id));
  const nextEdges = edges.filter((e) => !removedIds.has(e.id));

  const nextNodes = nodes
    .filter((n) => n.id !== op.nodeId)
    .map((n) => {
      if (n.type !== "requestInputs") return n;
      const data = n.data ?? {};
      const fields = (data.fields as RequestFieldRecord[] | undefined) ?? [];
      const filtered = fields.filter((f) => f.linkedTarget?.nodeId !== op.nodeId);
      if (filtered.length === fields.length) return n;
      return { ...n, data: { ...data, fields: filtered } };
    });

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
        const r = applyDisconnectNodes(nodes, edges, op);
        nodes = r.nodes;
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
