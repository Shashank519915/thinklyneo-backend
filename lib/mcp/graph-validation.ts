/**
 * @fileoverview Server-side graph connection validation for the MCP graph-editing tools.
 *
 * This is a backend-owned PORT of the canvas rules in
 * `galaxy-temp-frontend/lib/execution.ts` (cycle detection + handle type compatibility).
 * It is intentionally duplicated here (rather than added to the shared dist) so that the
 * Trigger.dev orchestrator and live workflow runs — which import the built shared package —
 * are NEVER affected by changes to MCP-side validation.
 *
 * Keep the type-compatibility table in sync with the canvas if handles change.
 */

export type GraphNodeLike = { id: string; type: string };
export type GraphEdgeLike = { source: string; target: string };

/** Target handles that aggregate multiple incoming edges into an array (orchestrator fan-in). */
export const FAN_IN_TARGET_HANDLES = new Set([
  "in:images",
  "in:image_urls",
  "in:video_urls",
  "in:audio_urls",
]);

/** DFS cycle check treating edges as directed source → target; probes an optional new edge. */
export function hasCycle(
  nodes: GraphNodeLike[],
  edges: GraphEdgeLike[],
  newEdge?: { source: string; target: string }
): boolean {
  const allEdges = newEdge ? [...edges, newEdge] : edges;
  const adjacency = new Map<string, string[]>();
  for (const n of nodes) adjacency.set(n.id, []);
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
    if (!visited.has(n.id) && dfs(n.id)) return true;
  }
  return false;
}

/** Coarse data-type of a handle, mirroring the canvas `getHandleDataType`. */
export function getHandleDataType(
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
  if (handleId.includes("x") || handleId.includes("y") || handleId.includes(":w") || handleId.includes(":h"))
    return "number";

  if (nodeType === "cropImage") return "image";
  if (nodeType === "gemini") return "text";
  if (nodeType === "openRouter") return "text";

  return "generic";
}

/** Whether a connection between two handles is type-compatible (mirrors canvas). */
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
  if ((targetHandle === "in:images" || targetHandle === "in:image_urls") && sourceType === "image") return true;
  if (targetHandle === "in:video_urls" && sourceType === "video") return true;
  if (targetHandle === "in:audio_urls" && sourceType === "audio") return true;
  return sourceType === targetType;
}
