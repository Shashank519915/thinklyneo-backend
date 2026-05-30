/**
 * @fileoverview Trigger.dev `crop-image` task implementing mandatory pause, FFmpeg-based crop in temp dirs, Transloadit REST upload.
 */

import { task, wait } from "@trigger.dev/sdk/v3";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { createHmac } from "crypto";
import { notifyCoordinator } from "./utils";

interface CropImagePayload {
  imageUrl: string;
  x: number;
  y: number;
  w: number;
  h: number;
  runId: string;
  nodeRunId: string;
  orchestratorRunId?: string;
  waitpointTokenId?: string;
  workflowId?: string;
}


/** Upload a Buffer to Transloadit via REST API — no filesystem file-path needed */
async function uploadBufferToTransloadit(
  buffer: Buffer,
  filename: string
): Promise<string> {
  const authKey = process.env.TRANSLOADIT_KEY!;
  const authSecret = process.env.TRANSLOADIT_SECRET!;

  if (!authKey || !authSecret) {
    throw new Error("Transloadit credentials not configured");
  }

  const expires = new Date(Date.now() + 5 * 60 * 1000)
    .toISOString()
    .replace(/\.\d{3}Z$/, "+00:00");

  const params = JSON.stringify({
    auth: { key: authKey, expires },
    blocking: true,
    steps: {
      ":original": { robot: "/upload/handle" },
    },
  });

  const signature = createHmac("sha1", authSecret).update(params).digest("hex");

  const formData = new FormData();
  formData.append("params", params);
  formData.append("signature", `sha1:${signature}`);
  // Use Blob from global (available in Node 18+ and Trigger.dev containers)
  formData.append(
    "file",
    new Blob([new Uint8Array(buffer)], { type: "image/jpeg" }),
    filename
  );

  console.log("[CropImageTask] 📤 Uploading to Transloadit REST API...");
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
    message?: string;
    assembly_ssl_url?: string;
    uploads?: Array<{ ssl_url?: string; url?: string }>;
    results?: Record<string, Array<{ ssl_url?: string; url?: string }>>;
  };

  console.log("[CropImageTask] Transloadit initial response ok:", result.ok);

  if (result.error) {
    throw new Error(`Transloadit error: ${result.error} — ${result.message ?? ""}`);
  }

  // Check if already completed on initial response
  if (result.ok === "ASSEMBLY_COMPLETED") {
    const url = extractTransloaditUrl(result.uploads, result.results);
    if (url) {
      console.log("[CropImageTask] ✅ Transloadit upload successful (immediate):", url);
      return url;
    }
  }

  // Poll if still executing
  if (result.assembly_ssl_url) {
    console.log("[CropImageTask] Assembly still executing, polling...");
    return await pollTransloaditAssembly(result.assembly_ssl_url);
  }

  throw new Error(`Transloadit: no assembly URL to poll. Status: ${result.ok ?? "unknown"}`);
}

/** Extract URL from either uploads[] or results[":original"] */
function extractTransloaditUrl(
  uploads?: Array<{ ssl_url?: string; url?: string }>,
  results?: Record<string, Array<{ ssl_url?: string; url?: string }>>
): string | null {
  // uploads[] is the top-level array of all uploaded files
  if (uploads && uploads.length > 0) {
    return (uploads[0].ssl_url ?? uploads[0].url) ?? null;
  }
  // results[":original"] is the step-level results
  const stepResults = results?.[":original"];
  if (stepResults && stepResults.length > 0) {
    return (stepResults[0].ssl_url ?? stepResults[0].url) ?? null;
  }
  return null;
}

/**
 * Uses Trigger `wait.for({ seconds: 2 })` between polls (distinct from naive `setTimeout` in Next routes).
 *
 * NOTE: Hard cap 30 polls (~60s ceiling) awaiting `ASSEMBLY_COMPLETED` / uploads extraction.
 */
async function pollTransloaditAssembly(assemblyUrl: string): Promise<string> {
  for (let i = 0; i < 30; i++) {
    await wait.for({ seconds: 2 });
    const resp = await fetch(assemblyUrl);
    if (!resp.ok) {
      console.log("[CropImageTask] Poll attempt", i + 1, "HTTP error:", resp.status);
      continue;
    }
    const data = await resp.json() as {
      ok?: string;
      error?: string;
      uploads?: Array<{ ssl_url?: string; url?: string }>;
      results?: Record<string, Array<{ ssl_url?: string; url?: string }>>;
    };
    console.log("[CropImageTask] Poll attempt", i + 1, "status:", data.ok);
    if (data.error) throw new Error(`Transloadit poll error: ${data.error}`);
    if (data.ok === "ASSEMBLY_COMPLETED" || data.ok === "REQUEST_ABORTED") {
      const url = extractTransloaditUrl(data.uploads, data.results);
      if (url) {
        console.log("[CropImageTask] ✅ Transloadit poll succeeded:", url);
        return url;
      }
      throw new Error(`Transloadit assembly completed but no file URL found`);
    }
  }
  throw new Error("Transloadit assembly polling timed out");
}

/**
 * Runs spec-mandated 30s checkpointed wait, downloads source URI, FFmpeg-crops, uploads cropped JPEG buffer.
 *
 * NOTE: Mirrors API-route resilience by preferring multipart REST upload over SDK file-path writes in ephemeral FS.
 */
export const cropImageTask = task({
  id: "crop-image",
  run: async (payload: CropImagePayload) => {
    const {
      imageUrl,
      x,
      y,
      w,
      h,
      runId,
      nodeRunId,
      orchestratorRunId,
      waitpointTokenId,
      workflowId,
    } = payload;
    const startMs = Date.now();

    console.log(`[CropImageTask] 🚀 Starting crop task (nodeRunId: ${nodeRunId})`);
    console.log(`[CropImageTask] Crop params: x=${x}% y=${y}% w=${w}% h=${h}%`);

    try {
      if (!imageUrl) throw new Error("No image URL provided for crop operation");

      // MANDATORY 30-second delay (hard requirement from spec)
      console.log("[CropImageTask] ⏳ Starting mandatory 30-second delay...");
      await wait.for({ seconds: 30 });
      console.log("[CropImageTask] ✅ 30-second delay complete");

      // ── 1. Get image as Buffer ────────────────────────────────────────
      let inputBuffer: Buffer;
      if (imageUrl.startsWith("data:")) {
        console.log("[CropImageTask] Input: base64 data URI — decoding to buffer");
        const base64Data = imageUrl.split(",")[1];
        if (!base64Data) throw new Error("Invalid base64 data URI");
        inputBuffer = Buffer.from(base64Data, "base64");
      } else {
        console.log("[CropImageTask] Input: remote URL — downloading...");
        const dlResponse = await fetch(imageUrl);
        if (!dlResponse.ok) throw new Error(`Failed to download image: ${dlResponse.statusText}`);
        inputBuffer = Buffer.from(await dlResponse.arrayBuffer());
        console.log("[CropImageTask] Download complete, buffer size:", inputBuffer.byteLength);
      }

      // ── 2. Write to temp file for FFmpeg ─────────────────────────────
      const tmpDir = os.tmpdir();
      const inputPath = path.join(tmpDir, `input_${nodeRunId}.jpg`);
      const outputPath = path.join(tmpDir, `output_${nodeRunId}.jpg`);
      fs.writeFileSync(inputPath, inputBuffer);
      console.log("[CropImageTask] Input written to temp file:", inputPath);

      // ── 3. FFmpeg crop ────────────────────────────────────────────────
      console.log("[CropImageTask] 🎬 Running FFmpeg crop...");
      const Ffmpeg = (await import("fluent-ffmpeg")).default;

      await new Promise<void>((resolve, reject) => {
        Ffmpeg(inputPath)
          .outputOptions([
            `-vf crop=iw*${w / 100}:ih*${h / 100}:iw*${x / 100}:ih*${y / 100}`,
          ])
          .output(outputPath)
          .on("end", () => {
            console.log("[CropImageTask] ✅ FFmpeg crop complete");
            resolve();
          })
          .on("error", (err: Error) => {
            console.error("[CropImageTask] ❌ FFmpeg error:", err.message);
            reject(err);
          })
          .run();
      });

      // ── 4. Read cropped file into Buffer, then upload via REST ────────
      const croppedBuffer = fs.readFileSync(outputPath);
      console.log("[CropImageTask] Cropped buffer size:", croppedBuffer.byteLength);

      // Clean up temp files
      fs.unlink(inputPath, () => {});
      fs.unlink(outputPath, () => {});

      const outputUrl = await uploadBufferToTransloadit(
        croppedBuffer,
        `cropped_${nodeRunId}.jpg`
      );

      const durationMs = Date.now() - startMs;
      console.log(`[CropImageTask] 🏁 Task complete (runId: ${runId})`);

      // Notify the coordinator task if coordination fields are provided
      if (workflowId && orchestratorRunId && waitpointTokenId) {
        await notifyCoordinator({
          workflowId,
          runId,
          nodeId: nodeRunId,
          status: "success",
          output: outputUrl,
          durationMs,
          orchestratorRunId,
          waitpointTokenId,
        });
      }

      return { outputUrl, runId, nodeRunId };
    } catch (err) {
      const durationMs = Date.now() - startMs;
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[CropImageTask] ❌ Task failed:`, errorMsg);

      if (workflowId && orchestratorRunId && waitpointTokenId) {
        await notifyCoordinator({
          workflowId,
          runId,
          nodeId: nodeRunId,
          status: "failed",
          error: errorMsg,
          durationMs,
          orchestratorRunId,
          waitpointTokenId,
        });
      }

      throw err;
    }
  },
});

