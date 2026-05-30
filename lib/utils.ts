/**
 * @fileoverview Cross-cutting helpers: Tailwind merge, relative time helpers, deterministic ids,
 * edge value propagation mirrors for preview mode, exporter download helper,
 * React Flow handle color map, user-facing error redaction when rendering.
 */

import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import type { Edge, Node } from "@xyflow/react";

/**
 * Convenience merge of conditional class strings with Tailwind-aware dedupe (`tailwind-merge`).
 *
 * @param inputs — Tokens accepted by `clsx`.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Human readable relative timestamp for dashboards/history (“3 minutes ago”, etc.).
 *
 * @param date — ISO string or Date.
 */
export function formatRelativeTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes !== 1 ? "s" : ""} ago`;
  if (hours < 24) return `${hours} hour${hours !== 1 ? "s" : ""} ago`;
  if (days < 7) return `${days} day${days !== 1 ? "s" : ""} ago`;
  return d.toLocaleDateString();
}

/**
 * Formats millisecond durations for node run timelines.
 *
 * @param ms — Duration from API/store; blanks render as hyphen.
 */
export function formatDuration(ms: number | null | undefined): string {
  if (!ms) return "-";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Creates a quasi-unique DOM id prefix for ephemeral React Flow nodes. */
export function generateNodeId(): string {
  return `node_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Stable-ish unique id helper for persisted edges linking two handles. */
export function generateEdgeId(): string {
  return `edge_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Builds Request-Inputs dynamic field identifiers (`field_*`). */
export function generateFieldId(): string {
  return `field_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export type ResolvePropagatedEdgeOptions = {
  /**
   * When previewing a historical run after reload, upstream `node.data.output` may be cleared.
   * Use persisted run outputs keyed by source node id (same ids as canvas).
   */
  previewOutputsByNodeId?: Record<string, unknown>;
};

/**
 * Resolves “what travels on this edge right now?” for dashboards + live crop previews — mirrors DAG merge rules
 * in `execution.ts` but runs client-side for UI wiring.
 *
 * @param edge — React Flow edge with populated handle ids.
 * @param nodes — Current canvas snapshot.
 * @param options.previewOutputsByNodeId — Fallback map when persisted node data cleared but history replay still needs upstream values.
 * @returns Propagated value or `undefined` when source missing.
 */
export function resolvePropagatedEdgeValue(
  edge: Edge,
  nodes: Node[],
  options?: ResolvePropagatedEdgeOptions,
): unknown {
  const sourceNode = nodes.find((n) => n.id === edge.source);
  if (!sourceNode) return undefined;

  const sourceHandle = edge.sourceHandle ?? "";

  if (sourceNode.type === "requestInputs") {
    const fields =
      (sourceNode.data as { fields?: Array<{ id: string; value: unknown }> }).fields ?? [];
    const field = fields.find((f) => f.id === sourceHandle);
    return field?.value;
  }

  let srcOutput = (sourceNode.data as { output?: unknown }).output;
  const pb = options?.previewOutputsByNodeId;
  if (
    (srcOutput === null || srcOutput === undefined) &&
    pb != null &&
    edge.source in pb
  ) {
    const fromPreview = pb[edge.source];
    if (fromPreview !== undefined) srcOutput = fromPreview;
  }

  let valueToPass: unknown = srcOutput;
  if (
    srcOutput !== null &&
    typeof srcOutput === "object" &&
    !Array.isArray(srcOutput) &&
    sourceHandle
  ) {
    const obj = srcOutput as Record<string, unknown>;
    if (sourceHandle in obj) {
      valueToPass = obj[sourceHandle];
    }
  }

  return valueToPass;
}

/**
 * Triggers a browser download of JSON (workflow export UX).
 *
 * @param data — Serializable payload (`workflowFilePayloadSchema` shape ideally).
 * @param filename — Suggested basename including `.json`.
 */
export function downloadJson(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Canonical mapping from logical handle datatype → dashed edge color tokens. */
export const HANDLE_COLORS = {
  image: "#F97316",    // orange
  text: "#F59E0B",     // amber
  video: "#10B981",    // green
  audio: "#EC4899",    // pink
  number: "#EC4899",   // pink
  boolean: "#6366F1",  // indigo
  response: "#6366F1", // indigo
  generic: "#3B82F6",  // blue
} as const;

export type HandleType = keyof typeof HANDLE_COLORS;

/**
 * Edge stroke color derivation for AnimatedEdge gradients based on originating handle semantics.
 *
 * @param handleId — React Flow handle id (`field_*`, Gemini `out:*`, etc.).
 */
export function getSourceHandleColor(handleId: string | null | undefined): string {
  if (!handleId) return "#7C3AED";
  if (handleId.includes("image") || handleId === "out:outputImage") return "#F97316"; // orange
  if (handleId === "out:response") return "#3B82F6"; // blue (Gemini response)
  if (handleId === "out:result") return "#6366F1"; // indigo
  if (handleId.startsWith("field_")) {
    // Request-Inputs fields: image fields are orange, text fields are amber
    if (handleId.includes("image")) return "#F97316";
    return "#F59E0B";
  }
  return "#7C3AED"; // default purple fallback
}

/**
 * Strips verbose internal/API error detail for alerts + inline badges (full text still logged server-side / DB).
 * Centralises vendor-specific heuristic messages (Gemini, Transloadit, network stack).
 *
 * @param error — Raw string from Trigger / fetch / Gemini SDK wrappers.
 */
export function sanitizeError(error: string): string {
  if (!error) return "An error occurred";

  // GoogleGenerativeAI / Gemini errors
  if (error.includes("GoogleGenerativeAI Error") || error.includes("generativelanguage.googleapis.com")) {
    if (error.includes("API key not valid") || error.includes("API_KEY_INVALID"))
      return "Gemini error: Invalid API key. Please check your GEMINI_API_KEY.";
    if (error.includes("quota") || error.includes("RESOURCE_EXHAUSTED"))
      return "Gemini error: Rate limit or quota exceeded. Try again shortly.";
    if (error.includes("400"))
      return "Gemini error: Bad request. Check your node inputs.";
    if (error.includes("403"))
      return "Gemini error: Access denied. Check your API key permissions.";
    if (error.includes("429"))
      return "Gemini error: Too many requests. Please wait and try again.";
    if (error.includes("500") || error.includes("503"))
      return "Gemini error: Service temporarily unavailable. Try again later.";
    return "Gemini API error. Check your API key and inputs.";
  }

  // Transloadit / Crop Image errors
  if (error.includes("Transloadit") || error.includes("transloadit")) {
    return "Image processing error. Check your Transloadit credentials.";
  }

  // Generic fetch / network errors
  if (error.includes("fetch failed") || error.includes("ECONNREFUSED") || error.includes("network"))
    return "Network error. Check your connection and try again.";

  // If error is already short enough, show it as-is
  if (error.length <= 120) return error;

  // Otherwise truncate with ellipsis
  return error.slice(0, 120) + "…";
}
