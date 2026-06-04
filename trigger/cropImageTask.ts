/**
 * @fileoverview Trigger.dev `crop-image`: FFmpeg crop with config-driven provider fallback.
 *
 * Provider order: cropImageDefinition.providers (main-ffmpeg -> backup-stub)
 * Includes mandatory 30s wait inside the ffmpeg executor.
 */

import { task, wait } from "@trigger.dev/sdk/v3";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { createHmac } from "crypto";
import type { NodeProviderConfig } from "@shashank519915/shared";
import { cropImageDefinition } from "@shashank519915/shared";
import { executeStubProvider } from "./executors";
import type { ProviderExecutorContext } from "./provider-chain";
import { runNodeTaskWithProviders } from "./task-coordination";

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

interface CropFfmpegInput {
  imageUrl: string;
  x: number;
  y: number;
  w: number;
  h: number;
  nodeRunId: string;
}

async function uploadBufferToTransloadit(buffer: Buffer, filename: string): Promise<string> {
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
    steps: { ":original": { robot: "/upload/handle" } },
  });

  const signature = createHmac("sha1", authSecret).update(params).digest("hex");

  const formData = new FormData();
  formData.append("params", params);
  formData.append("signature", `sha1:${signature}`);
  formData.append(
    "file",
    new Blob([new Uint8Array(buffer)], { type: "image/jpeg" }),
    filename
  );

  const response = await fetch("https://api2.transloadit.com/assemblies", {
    method: "POST",
    body: formData,
  });

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

  if (result.error) {
    throw new Error(`Transloadit error: ${result.error} - ${result.message ?? ""}`);
  }

  if (result.ok === "ASSEMBLY_COMPLETED") {
    const url = extractTransloaditUrl(result.uploads, result.results);
    if (url) return url;
  }

  if (result.assembly_ssl_url) {
    return pollTransloaditAssembly(result.assembly_ssl_url);
  }

  throw new Error(`Transloadit: no assembly URL to poll. Status: ${result.ok ?? "unknown"}`);
}

function extractTransloaditUrl(
  uploads?: Array<{ ssl_url?: string; url?: string }>,
  results?: Record<string, Array<{ ssl_url?: string; url?: string }>>
): string | null {
  if (uploads && uploads.length > 0) {
    return uploads[0].ssl_url ?? uploads[0].url ?? null;
  }
  const stepResults = results?.[":original"];
  if (stepResults && stepResults.length > 0) {
    return stepResults[0].ssl_url ?? stepResults[0].url ?? null;
  }
  return null;
}

async function pollTransloaditAssembly(assemblyUrl: string): Promise<string> {
  for (let i = 0; i < 30; i++) {
    await wait.for({ seconds: 2 });
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

function cleanupFile(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    // ignore cleanup errors
  }
}

async function executeCropFfmpegProvider(
  config: NodeProviderConfig,
  input: CropFfmpegInput,
  ctx: ProviderExecutorContext
): Promise<string> {
  ctx.appendLog(`[${config.id}] Attempting real FFmpeg crop...`);

  const { imageUrl, x, y, w, h, nodeRunId } = input;
  if (!imageUrl) throw new Error("No image URL provided for crop operation");

  const tmpDir = os.tmpdir();
  const inputPath = path.join(tmpDir, `input_${nodeRunId}.jpg`);
  const outputPath = path.join(tmpDir, `output_${nodeRunId}.jpg`);

  try {
    ctx.appendLog(`[${config.id}] Starting mandatory 30-second delay...`);
    await wait.for({ seconds: 30 });
    ctx.appendLog(`[${config.id}] 30-second delay complete`);

    let inputBuffer: Buffer;
    if (imageUrl.startsWith("data:")) {
      const base64Data = imageUrl.split(",")[1];
      if (!base64Data) throw new Error("Invalid base64 data URI");
      inputBuffer = Buffer.from(base64Data, "base64");
    } else {
      const dlResponse = await fetch(imageUrl);
      if (!dlResponse.ok) throw new Error(`Failed to download image: ${dlResponse.statusText}`);
      inputBuffer = Buffer.from(await dlResponse.arrayBuffer());
    }

    fs.writeFileSync(inputPath, inputBuffer);

    const Ffmpeg = (await import("fluent-ffmpeg")).default;
    await new Promise<void>((resolve, reject) => {
      Ffmpeg(inputPath)
        .outputOptions([`-vf crop=iw*${w / 100}:ih*${h / 100}:iw*${x / 100}:ih*${y / 100}`])
        .output(outputPath)
        .on("end", () => resolve())
        .on("error", (err) => reject(err))
        .run();
    });

    const croppedBuffer = fs.readFileSync(outputPath);
    const outputUrl = await uploadBufferToTransloadit(croppedBuffer, `cropped_${nodeRunId}.jpg`);
    ctx.appendLog(`[${config.id}] Success: Crop completed and uploaded to ${outputUrl}`);
    return outputUrl;
  } finally {
    cleanupFile(inputPath);
    cleanupFile(outputPath);
  }
}

export const cropImageTask = task({
  id: "crop-image",
  maxDuration: 360,
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

    console.log(`[CropImageTask] Starting crop-image (nodeRunId: ${nodeRunId})`);

    return runNodeTaskWithProviders({
      taskLabel: "CropImageTask",
      definition: cropImageDefinition,
      coordination: { runId, nodeRunId, orchestratorRunId, waitpointTokenId, workflowId },
      input: { imageUrl, x, y, w, h, nodeRunId },
      executors: {
        ffmpeg: executeCropFfmpegProvider,
        stub: executeStubProvider,
      },
      formatOutput: (outputUrl) => outputUrl,
      formatReturn: (outputUrl) => ({ outputUrl }),
    });
  },
});
