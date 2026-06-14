/**
 * Deterministic Blueprint graph validation (structural + handle/cycle rules).
 * Uses shared node registry for type checks; cycle/type rules mirror MCP graph-validation.
 */

import { EXECUTABLE_NODE_DEFINITIONS } from "@shashank519915/shared";
import {
  FAN_IN_TARGET_HANDLES,
  hasCycle,
  isValidConnection,
  type GraphEdgeLike,
  type GraphNodeLike,
} from "@/lib/mcp/graph-validation";

const SCAFFOLD_TYPES = new Set(["requestInputs", "response"]);
const EXECUTABLE_TYPES = new Set(Object.keys(EXECUTABLE_NODE_DEFINITIONS));

export type BlueprintValidationIssue = {
  code: string;
  message: string;
  severity: "error" | "warning";
};

export type BlueprintGraphInput = {
  requestFields: Array<{ id: string }>;
  nodes: Array<{ id: string; type: string; label?: string }>;
  edges: Array<{
    source: string;
    sourceHandle: string;
    target: string;
    targetHandle: string;
  }>;
};

export type BlueprintValidationResult = {
  valid: boolean;
  issues: BlueprintValidationIssue[];
  /** Blueprint copy with validation notes appended to openQuestions */
  annotatedOpenQuestions: string[];
};

function nodeTypeMap(blueprint: BlueprintGraphInput): Map<string, string> {
  const map = new Map<string, string>();
  for (const n of blueprint.nodes) map.set(n.id, n.type);
  for (const f of blueprint.requestFields) map.set(f.id, "requestInputs");
  // Implicit scaffold ids used by Thinkly blueprints
  map.set("request-inputs", "requestInputs");
  map.set("requestInputs", "requestInputs");
  map.set("response", "response");
  return map;
}

/** Validate a Thinkly Blueprint before Brain activation. */
export function validateBlueprintGraph(
  blueprint: BlueprintGraphInput,
  existingOpenQuestions: string[] = [],
): BlueprintValidationResult {
  const issues: BlueprintValidationIssue[] = [];
  const types = nodeTypeMap(blueprint);

  const hasRequestScaffold = blueprint.nodes.some((n) => n.type === "requestInputs");
  const hasResponseScaffold = blueprint.nodes.some((n) => n.type === "response");

  if (!hasRequestScaffold) {
    issues.push({
      code: "missing_request_scaffold",
      message: "Blueprint should include a requestInputs scaffold node (or edges referencing request-inputs).",
      severity: "warning",
    });
  }
  if (!hasResponseScaffold) {
    issues.push({
      code: "missing_response_scaffold",
      message: "Blueprint should include a response scaffold node.",
      severity: "warning",
    });
  }

  for (const field of blueprint.requestFields) {
    if (!field.id?.startsWith("field_")) {
      issues.push({
        code: "invalid_field_id",
        message: `Request field id "${field.id}" should use field_* convention.`,
        severity: "warning",
      });
    }
  }

  for (const n of blueprint.nodes) {
    if (SCAFFOLD_TYPES.has(n.type)) continue;
    if (!EXECUTABLE_TYPES.has(n.type)) {
      issues.push({
        code: "unknown_node_type",
        message: `Node "${n.id}" has unknown type "${n.type}".`,
        severity: "error",
      });
    }
  }

  const nodeIds = new Set<string>([
    ...blueprint.nodes.map((n) => n.id),
    ...blueprint.requestFields.map((f) => f.id),
    "request-inputs",
    "requestInputs",
    "response",
  ]);

  for (const e of blueprint.edges) {
    if (!nodeIds.has(e.source)) {
      issues.push({
        code: "dangling_edge_source",
        message: `Edge source "${e.source}" does not resolve to a node.`,
        severity: "error",
      });
    }
    if (!nodeIds.has(e.target)) {
      issues.push({
        code: "dangling_edge_target",
        message: `Edge target "${e.target}" does not resolve to a node.`,
        severity: "error",
      });
    }

    const sourceType = types.get(e.source);
    const targetType = types.get(e.target);
    if (sourceType && targetType && !isValidConnection(e.sourceHandle, e.targetHandle, sourceType, targetType)) {
      issues.push({
        code: "type_mismatch",
        message: `Incompatible handles: ${e.sourceHandle} → ${e.targetHandle} (${e.source} → ${e.target}).`,
        severity: "error",
      });
    }

    if (
      !FAN_IN_TARGET_HANDLES.has(e.targetHandle) &&
      blueprint.edges.filter((x) => x.target === e.target && x.targetHandle === e.targetHandle).length > 1
    ) {
      issues.push({
        code: "duplicate_target_handle",
        message: `Multiple edges target ${e.target}:${e.targetHandle} (only fan-in array handles allow this).`,
        severity: "error",
      });
    }
  }

  const graphNodes: GraphNodeLike[] = blueprint.nodes.map((n) => ({ id: n.id, type: n.type }));
  if (!hasRequestScaffold) graphNodes.push({ id: "request-inputs", type: "requestInputs" });
  if (!hasResponseScaffold) graphNodes.push({ id: "response", type: "response" });

  const graphEdges: GraphEdgeLike[] = blueprint.edges.map((e) => ({
    source: e.source,
    target: e.target,
  }));

  if (hasCycle(graphNodes, graphEdges)) {
    issues.push({
      code: "cycle",
      message: "Blueprint graph contains a cycle.",
      severity: "error",
    });
  }

  const hasErrors = issues.some((i) => i.severity === "error");
  const annotatedOpenQuestions = [
    ...existingOpenQuestions,
    ...issues.map((i) => `[${i.severity}] ${i.message}`),
  ];

  return {
    valid: !hasErrors,
    issues,
    annotatedOpenQuestions,
  };
}
