import type { NodeInputLimit, NodeDefinition } from "./types/node.types";
import { PLATFORM_LIMITS } from "./platform-limits";
import { EXECUTABLE_NODE_DEFINITIONS } from "./definitions/registry";

export interface InputLimitError {
  message: string;
  nodeId?: string;
  nodeType?: string;
  field?: string;
}

export interface MediaUrlSizeCheck {
  url: string;
  maxSizeMb: number;
  label: string;
  nodeId?: string;
  nodeType?: string;
  field?: string;
}

interface WorkflowNodeLike {
  id: string;
  type: string;
  data?: Record<string, unknown>;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function normalizeUrlList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter(isNonEmptyString).map((s) => s.trim());
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

function effectiveLimit(
  fieldKey: string,
  fieldLimit: NodeInputLimit | undefined,
  fallbackKind?: NodeInputLimit["mediaKind"]
): NodeInputLimit | undefined {
  if (fieldLimit) return fieldLimit;
  if (!fallbackKind) return undefined;
  const platform = PLATFORM_LIMITS[fallbackKind as keyof typeof PLATFORM_LIMITS];
  if (!platform || typeof platform !== "object" || !("maxSizeMb" in platform)) {
    return undefined;
  }
  return { ...platform, mediaKind: fallbackKind };
}

function checkTextLength(
  value: unknown,
  maxLength: number,
  ctx: { nodeId?: string; nodeType?: string; field: string }
): InputLimitError | null {
  if (value == null || value === "") return null;
  const text = String(value);
  if (text.length > maxLength) {
    return {
      ...ctx,
      message: `Input "${ctx.field}" exceeds maximum length of ${maxLength.toLocaleString()} characters (got ${text.length.toLocaleString()}).`,
    };
  }
  return null;
}

function checkUrlList(
  value: unknown,
  limit: NodeInputLimit,
  ctx: { nodeId?: string; nodeType?: string; field: string },
  sizeChecks: MediaUrlSizeCheck[]
): InputLimitError | null {
  const urls = normalizeUrlList(value);
  if (urls.length === 0) return null;

  const maxCount = limit.maxCount ?? PLATFORM_LIMITS.image.maxCount;
  if (urls.length > maxCount) {
    return {
      ...ctx,
      message: `Input "${ctx.field}" exceeds maximum of ${maxCount} file(s) (got ${urls.length}).`,
    };
  }

  const maxSizeMb = limit.maxSizeMb ?? PLATFORM_LIMITS.image.maxSizeMb;
  for (const url of urls) {
    if (url.startsWith("data:") || url.startsWith("http://") || url.startsWith("https://")) {
      sizeChecks.push({
        url,
        maxSizeMb,
        label: ctx.field,
        nodeId: ctx.nodeId,
        nodeType: ctx.nodeType,
        field: ctx.field,
      });
    }
  }
  return null;
}

function checkSingleMediaUrl(
  value: unknown,
  limit: NodeInputLimit,
  ctx: { nodeId?: string; nodeType?: string; field: string },
  sizeChecks: MediaUrlSizeCheck[]
): InputLimitError | null {
  if (!isNonEmptyString(value)) return null;
  const url = value.trim();
  const maxSizeMb =
    limit.maxSizeMb ??
    (limit.mediaKind === "video"
      ? PLATFORM_LIMITS.video.maxSizeMb
      : limit.mediaKind === "audio"
        ? PLATFORM_LIMITS.audio.maxSizeMb
        : PLATFORM_LIMITS.image.maxSizeMb);

  if (url.startsWith("data:") || url.startsWith("http://") || url.startsWith("https://")) {
    sizeChecks.push({
      url,
      maxSizeMb,
      label: ctx.field,
      nodeId: ctx.nodeId,
      nodeType: ctx.nodeType,
      field: ctx.field,
    });
  }
  return null;
}

function validateFieldAgainstLimit(
  fieldKey: string,
  value: unknown,
  limit: NodeInputLimit | undefined,
  ctx: { nodeId?: string; nodeType?: string },
  sizeChecks: MediaUrlSizeCheck[]
): InputLimitError | null {
  if (value == null || value === "") return null;

  const resolved = effectiveLimit(fieldKey, limit, limit?.mediaKind);
  if (!resolved) {
    if (fieldKey === "prompt" || fieldKey.includes("prompt") || fieldKey.includes("text")) {
      return checkTextLength(value, PLATFORM_LIMITS.prompt.maxLength, { ...ctx, field: fieldKey });
    }
    return null;
  }

  if (resolved.maxLength != null) {
    const err = checkTextLength(value, resolved.maxLength, { ...ctx, field: fieldKey });
    if (err) return err;
  }

  if (
    resolved.mediaKind === "image" &&
    (Array.isArray(value) || (typeof value === "string" && value.includes(",")))
  ) {
    return checkUrlList(value, resolved, { ...ctx, field: fieldKey }, sizeChecks);
  }

  if (resolved.mediaKind === "video" && (Array.isArray(value) || typeof value === "string")) {
    return checkUrlList(value, resolved, { ...ctx, field: fieldKey }, sizeChecks);
  }

  if (resolved.maxCount != null && Array.isArray(value) && value.length > resolved.maxCount) {
    return {
      ...ctx,
      field: fieldKey,
      message: `Input "${fieldKey}" exceeds maximum of ${resolved.maxCount} item(s).`,
    };
  }

  if (resolved.mediaKind) {
    return checkSingleMediaUrl(value, resolved, { ...ctx, field: fieldKey }, sizeChecks);
  }

  return null;
}

function validateNodeInputs(
  node: WorkflowNodeLike,
  sizeChecks: MediaUrlSizeCheck[]
): InputLimitError | null {
  const def = EXECUTABLE_NODE_DEFINITIONS[node.type];
  if (!def) return null;

  const inputs = (node.data?.inputs as Record<string, unknown> | undefined) ?? {};
  for (const [key, value] of Object.entries(inputs)) {
    const err = validateFieldAgainstLimit(
      key,
      value,
      def.limits?.[key],
      { nodeId: node.id, nodeType: node.type },
      sizeChecks
    );
    if (err) return err;
  }
  return null;
}

function requestFieldKind(field: { id: string; type?: string }): "image" | "video" | "audio" | "file" | "text" {
  if (field.id.includes("image") || field.type === "image_field") return "image";
  if (field.id.includes("video") || field.type === "video_field") return "video";
  if (field.id.includes("audio") || field.type === "audio_field") return "audio";
  if (field.type === "file_field" || field.type === "media_field") return "file";
  return "text";
}

function validateRequestInputValues(
  nodes: WorkflowNodeLike[],
  inputValues: Record<string, unknown>,
  sizeChecks: MediaUrlSizeCheck[]
): InputLimitError | null {
  for (const node of nodes) {
    if (node.type !== "requestInputs") continue;
    const fields = (node.data?.fields as Array<{ id: string; type?: string }> | undefined) ?? [];

    for (const field of fields) {
      const raw = inputValues[field.id];
      if (raw == null || raw === "") continue;

      const kind = requestFieldKind(field);
      const ctx = { nodeId: node.id, nodeType: node.type, field: field.id };

      if (kind === "text") {
        const err = checkTextLength(raw, PLATFORM_LIMITS.prompt.maxLength, ctx);
        if (err) return err;
        continue;
      }

      if (kind === "image") {
        const err = checkUrlList(
          raw,
          {
            maxCount: PLATFORM_LIMITS.requestMultiImage.maxCount,
            maxSizeMb: PLATFORM_LIMITS.requestMultiImage.maxSizeMb,
            mediaKind: "image",
          },
          ctx,
          sizeChecks
        );
        if (err) return err;
        continue;
      }

      if (kind === "video") {
        const err = checkUrlList(
          raw,
          {
            maxCount: 10,
            maxSizeMb: PLATFORM_LIMITS.video.maxSizeMb,
            mediaKind: "video",
          },
          ctx,
          sizeChecks
        );
        if (err) return err;
        continue;
      }

      const mediaKind = kind === "audio" ? "audio" : "file";
      const platform = PLATFORM_LIMITS[mediaKind];
      const err = checkSingleMediaUrl(
        raw,
        { mediaKind, maxSizeMb: platform.maxSizeMb },
        ctx,
        sizeChecks
      );
      if (err) return err;
    }
  }
  return null;
}

function targetNodesForScope(
  nodes: WorkflowNodeLike[],
  scope: "full" | "partial" | "single",
  targetNodeIds?: string[]
): WorkflowNodeLike[] {
  if (scope === "full") return nodes;
  const ids = new Set(targetNodeIds ?? []);
  return nodes.filter((n) => ids.has(n.id));
}

/**
 * Synchronous checks: counts, text length, URL shape. Returns first violation or null.
 * Populates `sizeChecks` for async HEAD/data-URI size validation on the server.
 */
export function validateWorkflowInputsSync(params: {
  nodes: WorkflowNodeLike[];
  inputValues: Record<string, unknown>;
  scope: "full" | "partial" | "single";
  targetNodeIds?: string[];
  sizeChecks?: MediaUrlSizeCheck[];
}): InputLimitError | null {
  const sizeChecks = params.sizeChecks ?? [];

  const requestErr = validateRequestInputValues(params.nodes, params.inputValues, sizeChecks);
  if (requestErr) return requestErr;

  const targets = targetNodesForScope(params.nodes, params.scope, params.targetNodeIds);
  for (const node of targets) {
    const err = validateNodeInputs(node, sizeChecks);
    if (err) return err;
  }

  return null;
}

/** Resolve effective max size in MB for a definition field (used by upload route). */
export function maxUploadMbForDefinitionField(
  definition: NodeDefinition,
  fieldKey: string
): number | undefined {
  const limit = definition.limits?.[fieldKey];
  if (limit?.maxSizeMb) return limit.maxSizeMb;
  if (limit?.mediaKind) {
    return PLATFORM_LIMITS[limit.mediaKind]?.maxSizeMb;
  }
  return undefined;
}
