/**
 * @fileoverview Canvas graph validation helpers (cycle detection, handle type compatibility).
 * Production runs use Trigger.dev `workflow-orchestrator` (not client-side executeDAG).
 */

import { type Node, type Edge } from "@xyflow/react";

export function hasCycle(
  nodes: Node[],
  edges: Edge[],
  newEdge?: { source: string; target: string }
): boolean {
  const allEdges = newEdge ? [...edges, newEdge] : edges;
  const adjacency = new Map<string, string[]>();

  for (const n of nodes) {
    adjacency.set(n.id, []);
  }
  for (const e of allEdges) {
    const arr = adjacency.get(e.source) ?? [];
    arr.push(e.target);
    adjacency.set(e.source, arr);
  }

  const visited = new Set<string>();
  const inStack = new Set<string>();

  function dfs(nodeId: string): boolean {
    if (inStack.has(nodeId)) return true;
    if (visited.has(nodeId)) return false;
    visited.add(nodeId);
    inStack.add(nodeId);
    for (const neighbor of adjacency.get(nodeId) ?? []) {
      if (dfs(neighbor)) return true;
    }
    inStack.delete(nodeId);
    return false;
  }

  for (const n of nodes) {
    if (!visited.has(n.id)) {
      if (dfs(n.id)) return true;
    }
  }
  return false;
}

export function validateNewEdge(
  nodes: Node[],
  edges: Edge[],
  newEdge: { source: string; target: string }
): { valid: boolean; error?: string } {
  if (hasCycle(nodes, edges, newEdge)) {
    return { valid: false, error: "This connection would create a cycle." };
  }
  return { valid: true };
}

function getHandleDataType(
  handleId: string | null | undefined,
  nodeType: string | undefined
): string {
  if (!handleId) return "generic";

  if (handleId === "result") return "response";

  if (handleId.startsWith("field_")) {
    if (handleId.includes("image")) return "image";
    if (handleId.includes("video")) return "video";
    if (handleId.includes("audio")) return "audio";
    if (handleId.includes("media")) return "media";
    if (handleId.includes("file")) return "file";
    if (handleId.includes("number")) return "number";
    if (handleId.includes("boolean")) return "boolean";
    if (handleId.includes("select")) return "text";
    if (handleId.includes("text")) return "text";
    return "generic";
  }

  if (
    handleId.includes("Image") ||
    handleId.includes("image") ||
    handleId === "in:inputImage" ||
    handleId === "out:outputImage" ||
    (handleId === "out:result" && nodeType === "gptImage2")
  )
    return "image";
  if (handleId === "in:images" || handleId === "in:image_urls") return "image";
  if (handleId === "in:video_urls") return "video";
  if (handleId === "in:audio_urls") return "audio";
  if (handleId === "in:audio_volume") return "number";
  if (handleId === "in:format") return "text";
  if (
    handleId === "in:temperature" ||
    handleId === "in:maxTokens" ||
    handleId === "in:topP" ||
    handleId === "in:topK" ||
    handleId === "in:frequencyPenalty" ||
    handleId === "in:presencePenalty" ||
    handleId === "in:repetitionPenalty" ||
    handleId === "in:minP" ||
    handleId === "in:topA" ||
    handleId === "in:seed" ||
    handleId === "in:reasoning" ||
    handleId === "in:response_format"
  )
    return "generic";
  if (handleId === "in:stop") return "text";
  if (handleId.includes("Video") || handleId.includes("video")) return "video";
  if (handleId.includes("Audio") || handleId.includes("audio")) return "audio";
  if (handleId.includes("media") || handleId.includes("Media")) return "media";
  if (handleId.includes("file") || handleId.includes("File") || handleId === "in:file") return "file";
  if (handleId.includes("prompt") || handleId === "in:prompt" || handleId === "in:systemPrompt") return "text";
  if (handleId === "out:response") return "text";
  if (handleId.includes("x") || handleId.includes("y") || handleId.includes(":w") || handleId.includes(":h")) return "number";

  if (nodeType === "cropImage") return "image";
  if (nodeType === "gemini") return "text";
  if (nodeType === "openRouter") return "text";

  return "generic";
}

export function isValidConnection(
  sourceHandle: string | null | undefined,
  targetHandle: string | null | undefined,
  sourceNodeType: string | undefined,
  targetNodeType: string | undefined
): boolean {
  const sourceType = getHandleDataType(sourceHandle, sourceNodeType);
  const targetType = getHandleDataType(targetHandle, targetNodeType);

  if (sourceType === "generic" || targetType === "generic") return true;
  if (targetType === "response") return true;

  if (
    (targetHandle === "in:images" || targetHandle === "in:image_urls") &&
    sourceType === "image"
  )
    return true;

  if (targetHandle === "in:video_urls" && sourceType === "video") return true;
  if (targetHandle === "in:audio_urls" && sourceType === "audio") return true;

  return sourceType === targetType;
}
