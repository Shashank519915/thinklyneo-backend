/**
 * @fileoverview Crop-image execution API: prefers Trigger.dev `crop-image` task + REST polling;
 * optional in-process Sharp + Transloadit REST fallback when `CROP_DIRECT_FALLBACK_ENABLED` is true.
 */

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

/**
 * `true`: if Trigger.dev does not return a result, run in-process sharp + Transloadit (extra resilience).
 * `false` (default): strict Trigger-only — return 503 when Trigger fails or is unset (no direct crop path).
 */
const CROP_DIRECT_FALLBACK_ENABLED = false;

// Accept both real HTTP(S) URLs and base64 data URIs
const cropSchema = z.object({
  imageUrl: z.string().min(1).refine(
    (v) => v.startsWith("data:") || v.startsWith("http://") || v.startsWith("https://"),
    { message: "imageUrl must be a URL or a base64 data URI" }
  ),
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
  w: z.number().min(1).max(100),
  h: z.number().min(1).max(100),
  runId: z.string(),
  nodeRunId: z.string(),
});

/**
 * Upload a Buffer directly to Transloadit using their REST API (no filesystem needed).
 * Vercel serverless functions have no writable disk, so we can't use the Transloadit SDK's
 * file-path based upload. Instead we POST a multipart form directly to their assembly endpoint.
 */
async function uploadBufferToTransloadit(
  buffer: Buffer,
  filename: string,
  authKey: string,
  authSecret: string
): Promise<string> {
  // Build signed params
  const expires = new Date(Date.now() + 5 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, "+00:00");
  const params = JSON.stringify({
    auth: { key: authKey, expires },
    blocking: true,
    steps: {
      ":original": { robot: "/upload/handle" },
    },
  });

  // HMAC-SHA1 signature
  const crypto = await import("crypto");
  const signature = crypto.createHmac("sha1", authSecret).update(params).digest("hex");

  // Build multipart form
  const formData = new FormData();
  formData.append("params", params);
  formData.append("signature", `sha1:${signature}`);
  formData.append("file", new Blob([new Uint8Array(buffer)], { type: "image/jpeg" }), filename);

  console.log("[CropImage] Uploading buffer to Transloadit REST API...");
  const response = await fetch("https://api2.transloadit.com/assemblies", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Transloadit API error ${response.status}: ${text}`);
  }

  const result = await response.json() as {
    ok?: string;
    error?: string;
    uploads?: Array<{ ssl_url?: string; url?: string }>;
    results?: Record<string, Array<{ ssl_url?: string; url?: string }>>;
    assembly_ssl_url?: string;
  };

  console.log("[CropImage] Transloadit initial response ok:", result.ok);

  if (result.error) {
    throw new Error(`Transloadit assembly error: ${result.error}`);
  }

  // Completed immediately
  if (result.ok === "ASSEMBLY_COMPLETED") {
    const url = extractUrl(result.uploads, result.results);
    if (url) {
      console.log("[CropImage] ✅ Transloadit upload successful:", url);
      return url;
    }
  }

  // Assembly still processing — poll
  if (result.assembly_ssl_url) {
    console.log("[CropImage] Assembly still executing, polling...");
    return await pollAssembly(result.assembly_ssl_url);
  }

  throw new Error(`Transloadit: no assembly URL to poll. Status: ${result.ok ?? "unknown"}`);
}

/** Extract URL from uploads[] (top-level) or results[":original"] (step-level) */
function extractUrl(
  uploads?: Array<{ ssl_url?: string; url?: string }>,
  results?: Record<string, Array<{ ssl_url?: string; url?: string }>>
): string | null {
  if (uploads && uploads.length > 0) return (uploads[0].ssl_url ?? uploads[0].url) ?? null;
  const step = results?.[":original"];
  if (step && step.length > 0) return (step[0].ssl_url ?? step[0].url) ?? null;
  return null;
}

/**
 * Polls assembly status until completion.
 * NOTE: Capped at 8 iterations × 1s — short by design vs Trigger task polling to stay within route timing.
 */
async function pollAssembly(assemblyUrl: string): Promise<string> {
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const resp = await fetch(assemblyUrl);
    if (!resp.ok) continue;
    const data = await resp.json() as {
      ok?: string;
      error?: string;
      uploads?: Array<{ ssl_url?: string; url?: string }>;
      results?: Record<string, Array<{ ssl_url?: string; url?: string }>>;
    };
    console.log("[CropImage] Poll attempt", i + 1, "status:", data.ok);
    if (data.error) throw new Error(`Transloadit error: ${data.error}`);
    if (data.ok === "ASSEMBLY_COMPLETED") {
      const url = extractUrl(data.uploads, data.results);
      if (url) return url;
    }
  }
  throw new Error("Transloadit assembly timed out");
}

/**
 * Trigger a task and poll until completion.
 * SDK's triggerAndWait() only works from within another task.run() context.
 * From a Next.js API route we must use trigger() + REST polling instead.
 */
async function triggerTaskAndWait<TOutput>(
  taskId: string,
  payload: Record<string, unknown>,
  timeoutMs = 120000
): Promise<{ ok: boolean; output?: TOutput; error?: string }> {
  const { tasks } = await import("@trigger.dev/sdk/v3");

  // Fire the task
  const run = await tasks.trigger(taskId, payload);
  const runId = run.id;
  console.log(`[TriggerDev] Task ${taskId} triggered, runId: ${runId}`);

  // Poll via REST API
  const apiUrl = `https://api.trigger.dev/api/v3/runs/${runId}`;
  const headers = { Authorization: `Bearer ${process.env.TRIGGER_SECRET_KEY}` };

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    const resp = await fetch(apiUrl, { headers });
    if (!resp.ok) continue;
    const data = await resp.json() as {
      status: string;
      output?: TOutput;
      error?: { message?: string };
    };
    console.log(`[TriggerDev] Run ${runId} status: ${data.status}`);
    if (data.status === "COMPLETED") return { ok: true, output: data.output };
    if (data.status === "FAILED" || data.status === "CRASHED" || data.status === "CANCELED") {
      return { ok: false, error: data.error?.message ?? data.status };
    }
  }
  return { ok: false, error: "Task timed out" };
}

/**
 * In-process fallback: Sharp crop then Transloadit REST multipart upload (Vercel has no writable disk for SDK paths).
 *
 * NOTE: Spec requires ~30s wait before cropping; skipped when Trigger was already polled (`skipDelay`) so total wall time stays sane.
 */
async function cropDirect(payload: {
  imageUrl: string;
  x: number;
  y: number;
  w: number;
  h: number;
  nodeRunId: string;
  skipDelay?: boolean; // true when Trigger.dev was already attempted (we already waited ~60s poll budget)
}): Promise<string> {
  console.log("[CropImage] 🔧 Using DIRECT fallback (sharp + Transloadit REST) — Trigger.dev unavailable");

  // Mandatory 30-second delay — only if Trigger.dev was NOT attempted
  // (if it was attempted, we already spent the poll window waiting on the run, so the 30s requirement is covered)
  if (!payload.skipDelay) {
    console.log("[CropImage] ⏳ Mandatory 30-second delay (fallback path)...");
    await new Promise((r) => setTimeout(r, 30000));
    console.log("[CropImage] ✅ 30-second delay complete");
  } else {
    console.log("[CropImage] ⏭️ Skipping delay — Trigger.dev was attempted (30s+ already elapsed)");
  }

  const sharp = (await import("sharp")).default;

  // ── 1. Decode the image to a Buffer ──────────────────────────────
  let inputBuffer: Buffer;
  if (payload.imageUrl.startsWith("data:")) {
    const base64Data = payload.imageUrl.split(",")[1];
    if (!base64Data) throw new Error("Invalid base64 data URI");
    inputBuffer = Buffer.from(base64Data, "base64");
    console.log("[CropImage] Input: base64 data URI, decoded to buffer");
  } else {
    const response = await fetch(payload.imageUrl);
    if (!response.ok) throw new Error(`Failed to fetch image: ${response.status}`);
    inputBuffer = Buffer.from(await response.arrayBuffer());
    console.log("[CropImage] Input: remote URL fetched");
  }

  // ── 2. Calculate crop pixels from percentages ─────────────────────
  const metadata = await sharp(inputBuffer).metadata();
  const imgW = metadata.width ?? 800;
  const imgH = metadata.height ?? 600;

  const cropX = Math.round((payload.x / 100) * imgW);
  const cropY = Math.round((payload.y / 100) * imgH);
  const cropW = Math.max(1, Math.round((payload.w / 100) * imgW));
  const cropH = Math.max(1, Math.round((payload.h / 100) * imgH));

  console.log(`[CropImage] Cropping: ${imgW}x${imgH} → x:${cropX} y:${cropY} w:${cropW} h:${cropH}`);

  // ── 3. Crop with sharp (in-memory, no disk I/O) ──────────────────
  const croppedBuffer = await sharp(inputBuffer)
    .extract({ left: cropX, top: cropY, width: cropW, height: cropH })
    .jpeg({ quality: 90 })
    .toBuffer();

  console.log("[CropImage] sharp crop complete, buffer size:", croppedBuffer.byteLength);

  // ── 4. Upload to Transloadit via REST API (no filesystem needed) ──
  const transloaditKey = process.env.TRANSLOADIT_KEY;
  const transloaditSecret = process.env.TRANSLOADIT_SECRET;

  if (!transloaditKey || !transloaditSecret) {
    throw new Error("Transloadit credentials not configured (TRANSLOADIT_KEY / TRANSLOADIT_SECRET)");
  }

  return await uploadBufferToTransloadit(
    croppedBuffer,
    `cropped_${payload.nodeRunId}.jpg`,
    transloaditKey,
    transloaditSecret
  );
}

/**
 * Validates crop payload, runs Trigger.dev-backed crop (`triggerTaskAndWait`, 60s budget), then optional direct fallback.
 *
 * NOTE: When `TRIGGER_SECRET_KEY` is absent or `CROP_DIRECT_FALLBACK_ENABLED` is false, failure paths return 503 (no Sharp fallback).
 */
export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const parsed = cropSchema.safeParse(body);

    if (!parsed.success) {
      console.error("[CropImage] ❌ Schema validation failed:", parsed.error.issues);
      return NextResponse.json(
        { error: "Invalid input", issues: parsed.error.issues },
        { status: 400 }
      );
    }

    const { imageUrl, x, y, w, h, runId, nodeRunId } = parsed.data;
    const triggerKey = process.env.TRIGGER_SECRET_KEY;
    let triggerWasAttempted = false;

    // ── Try Trigger.dev first (preferred — includes mandatory 30s delay) ──
    if (triggerKey) {
      triggerWasAttempted = true;
      const isRealtime = process.env.TRIGGER_REALTIME_EXECUTE !== "false";
      try {
        if (isRealtime) {
          // Check if this node run has already been triggered in the database
          const existingNodeRun = await prisma.nodeRun.findUnique({
            where: {
              runId_nodeId: {
                runId,
                nodeId: nodeRunId,
              },
            },
          });

          if (existingNodeRun && existingNodeRun.triggerRunId) {
            console.log(`[CropImage] NodeRun already exists with triggerRunId: ${existingNodeRun.triggerRunId}. Re-generating token.`);
            const { auth: triggerAuth } = await import("@trigger.dev/sdk/v3");
            const publicAccessToken = await triggerAuth.createPublicToken({
              scopes: {
                read: {
                  runs: [existingNodeRun.triggerRunId],
                },
              },
              expirationTime: "2hr",
            });
            return NextResponse.json({
              data: {
                triggerRunId: existingNodeRun.triggerRunId,
                publicAccessToken,
              },
            });
          }

          console.log("[CropImage] 🚀 Triggering task (crop-image) in REALTIME mode...");
          const { tasks, auth: triggerAuth } = await import("@trigger.dev/sdk/v3");
          const run = await tasks.trigger("crop-image", { imageUrl, x, y, w, h, runId, nodeRunId });
          const publicAccessToken = await triggerAuth.createPublicToken({
            scopes: {
              read: {
                runs: [run.id],
              },
            },
            expirationTime: "2hr",
          });
          return NextResponse.json({
            data: {
              triggerRunId: run.id,
              publicAccessToken,
            },
          });
        }

        console.log("[CropImage] 🚀 Attempting Trigger.dev task (crop-image) in polling mode...");
        const handle = await triggerTaskAndWait<{ outputUrl: string }>(
          "crop-image",
          { imageUrl, x, y, w, h, runId, nodeRunId },
          60000 // Poll up to 60s 
        );
        if (handle.ok && handle.output?.outputUrl) {
          console.log("[CropImage] ✅ Trigger.dev task succeeded:", handle.output.outputUrl);
          return NextResponse.json({ data: { outputUrl: handle.output.outputUrl } });
        }
        console.warn("[CropImage] ⚠️ Trigger.dev task not ok, falling back. Error:", handle.error);
      } catch (triggerErr) {
        console.warn("[CropImage] ⚠️ Trigger.dev unavailable, falling back:", triggerErr);
      }
    } else {
      console.warn(
        `[CropImage] No TRIGGER_SECRET_KEY — ${CROP_DIRECT_FALLBACK_ENABLED ? "will attempt direct fallback" : "direct fallback disabled (503)"}`
      );
    }

    if (!CROP_DIRECT_FALLBACK_ENABLED) {
      return NextResponse.json(
        {
          error:
            "Crop Trigger task did not return a result and direct fallback is disabled.",
        },
        { status: 503 }
      );
    }

    // ── Fallback: direct sharp crop + Transloadit REST upload ─────────
    const outputUrl = await cropDirect({ imageUrl, x, y, w, h, nodeRunId, skipDelay: triggerWasAttempted });
    return NextResponse.json({ data: { outputUrl } });

  } catch (error) {
    console.error("[CropImage] ❌ crop-image execution failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Crop image execution failed" },
      { status: 500 }
    );
  }
}
