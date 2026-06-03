/**
 * Server-side workflow input limit validation (sync + async remote size checks).
 */

import {
  validateWorkflowInputsSync,
  type InputLimitError,
  type MediaUrlSizeCheck,
} from "@galaxy/shared";

export type { InputLimitError };

function dataUriByteLength(url: string): number | null {
  const match = /^data:[^;]+;base64,(.+)$/i.exec(url);
  if (!match) return null;
  const base64 = match[1];
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

async function resolveContentLength(url: string): Promise<number | null> {
  if (url.startsWith("data:")) {
    return dataUriByteLength(url);
  }

  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return null;
  }

  // Files uploaded via our Transloadit route were size-checked at upload time.
  if (url.includes("transloadit.com/")) {
    return null;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const response = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
      redirect: "follow",
    });
    clearTimeout(timer);

    if (!response.ok) {
      return null;
    }

    const header = response.headers.get("content-length");
    if (!header) return null;
    const bytes = Number.parseInt(header, 10);
    return Number.isFinite(bytes) ? bytes : null;
  } catch {
    return null;
  }
}

async function validateRemoteSizes(checks: MediaUrlSizeCheck[]): Promise<InputLimitError | null> {
  const seen = new Set<string>();

  for (const check of checks) {
    if (seen.has(check.url)) continue;
    seen.add(check.url);

    const bytes = await resolveContentLength(check.url);
    if (bytes == null) continue;

    const maxBytes = check.maxSizeMb * 1024 * 1024;
    if (bytes > maxBytes) {
      const sizeMb = (bytes / (1024 * 1024)).toFixed(1);
      const nodeLabel = check.nodeType ? `${check.nodeType}` : "workflow";
      const fieldLabel = check.field ?? check.label;
      return {
        nodeId: check.nodeId,
        nodeType: check.nodeType,
        field: check.field,
        message: `Input exceeds limits: ${nodeLabel} field "${fieldLabel}" is ${sizeMb}MB (maximum ${check.maxSizeMb}MB).`,
      };
    }
  }

  return null;
}

/**
 * Validates request-input values and scoped node inputs before placing a credit hold.
 * Returns a user-facing error message object or null if OK.
 */
export async function validateWorkflowInputs(params: {
  nodes: Array<{ id: string; type: string; data?: Record<string, unknown> }>;
  inputValues: Record<string, unknown>;
  scope: "full" | "partial" | "single";
  targetNodeIds?: string[];
  checkRemoteSize?: boolean;
}): Promise<InputLimitError | null> {
  const sizeChecks: MediaUrlSizeCheck[] = [];

  const syncError = validateWorkflowInputsSync({
    nodes: params.nodes,
    inputValues: params.inputValues,
    scope: params.scope,
    targetNodeIds: params.targetNodeIds,
    sizeChecks,
  });

  if (syncError) return syncError;

  if (params.checkRemoteSize !== false && sizeChecks.length > 0) {
    return validateRemoteSizes(sizeChecks);
  }

  return null;
}
