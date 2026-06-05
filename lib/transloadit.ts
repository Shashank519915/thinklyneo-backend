/**
 * @fileoverview Minimal server-side Transloadit upload helper (memory buffer → stable URL).
 *
 * Extracted so multiple routes can share the signed-assembly logic. Mirrors the proven
 * approach in `app/api/upload/route.ts` (REST `/upload/handle` robot, blocking assembly,
 * poll fallback) without modifying that existing dashboard route.
 */

import { createHmac } from "crypto";

function extractTransloaditUrl(
  uploads?: Array<{ ssl_url?: string; url?: string }>,
  results?: Record<string, Array<{ ssl_url?: string; url?: string }>>
): string | null {
  if (uploads && uploads.length > 0) return (uploads[0].ssl_url ?? uploads[0].url) ?? null;
  const stepResults = results?.[":original"];
  if (stepResults && stepResults.length > 0) return (stepResults[0].ssl_url ?? stepResults[0].url) ?? null;
  return null;
}

async function pollAssembly(assemblyUrl: string): Promise<string> {
  for (let i = 0; i < 30; i++) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const resp = await fetch(assemblyUrl);
    if (!resp.ok) continue;
    const data = (await resp.json()) as {
      ok?: string;
      error?: string;
      uploads?: Array<{ ssl_url?: string; url?: string }>;
      results?: Record<string, Array<{ ssl_url?: string; url?: string }>>;
    };
    if (data.error) throw new Error(`Transloadit poll error: ${data.error}`);
    if (data.ok === "ASSEMBLY_COMPLETED" || data.ok === "REQUEST_ABORTED") {
      const url = extractTransloaditUrl(data.uploads, data.results);
      if (url) return url;
      throw new Error("Transloadit assembly completed but no file URL found");
    }
  }
  throw new Error("Transloadit assembly polling timed out");
}

export interface TransloaditCreds {
  configured: boolean;
}

export function transloaditConfigured(): boolean {
  return !!(process.env.TRANSLOADIT_KEY && process.env.TRANSLOADIT_SECRET);
}

/** Upload an in-memory buffer to permanent Transloadit storage; returns the stable ssl URL. */
export async function uploadBufferToTransloadit(
  buffer: Buffer,
  filename: string,
  mime: string
): Promise<string> {
  const authKey = process.env.TRANSLOADIT_KEY;
  const authSecret = process.env.TRANSLOADIT_SECRET;
  if (!authKey || !authSecret) {
    throw new Error("Transloadit credentials not configured (TRANSLOADIT_KEY / TRANSLOADIT_SECRET).");
  }

  const expires = new Date(Date.now() + 5 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, "+00:00");
  const params = JSON.stringify({
    auth: { key: authKey, expires },
    blocking: true,
    steps: { ":original": { robot: "/upload/handle" } },
  });
  const signature = createHmac("sha1", authSecret).update(params).digest("hex");

  const form = new FormData();
  form.append("params", params);
  form.append("signature", `sha1:${signature}`);
  form.append("file", new Blob([new Uint8Array(buffer)], { type: mime || "application/octet-stream" }), filename);

  const response = await fetch("https://api2.transloadit.com/assemblies", { method: "POST", body: form });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Transloadit API error ${response.status}: ${text}`);
  }

  const result = (await response.json()) as {
    ok?: string;
    error?: string;
    message?: string;
    assembly_ssl_url?: string;
    uploads?: Array<{ ssl_url?: string; url?: string }>;
    results?: Record<string, Array<{ ssl_url?: string; url?: string }>>;
  };
  if (result.error) throw new Error(`Transloadit error: ${result.error} — ${result.message ?? ""}`);

  let url: string | null = null;
  if (result.ok === "ASSEMBLY_COMPLETED") url = extractTransloaditUrl(result.uploads, result.results);
  if (!url && result.assembly_ssl_url) url = await pollAssembly(result.assembly_ssl_url);
  if (!url) throw new Error("Failed to extract uploaded file URL");
  return url;
}
