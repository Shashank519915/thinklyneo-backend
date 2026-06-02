/**
 * @fileoverview Trigger.dev `merge-av`: FFmpeg A/V mux with config-driven provider fallback.
 */

import { task, wait } from "@trigger.dev/sdk/v3";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { createHmac } from "crypto";
import type { NodeProviderConfig } from "@galaxy/shared";
import { mergeAVDefinition } from "@galaxy/shared";
import { executeStubProvider } from "./executors";
import type { ProviderExecutorContext } from "./provider-chain";
import { runNodeTaskWithProviders } from "./task-coordination";

interface MergeAVPayload {
  videoUrl: string;
  audioUrl: string;
  runId: string;
  nodeRunId: string;
  orchestratorRunId?: string;
  waitpointTokenId?: string;
  workflowId?: string;
}

interface MergeAVFfmpegInput {
  videoUrl: string;
  audioUrl: string;
  nodeRunId: string;
}

async function uploadBufferToTransloadit(buffer: Buffer, filename: string): Promise<string> {
  const authKey = process.env.TRANSLOADIT_KEY!;
  const authSecret = process.env.TRANSLOADIT_SECRET!;
  if (!authKey || !authSecret) throw new Error("Transloadit credentials not configured");

  const expires = new Date(Date.now() + 10 * 60 * 1000)
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
  formData.append("file", new Blob([new Uint8Array(buffer)], { type: "video/mp4" }), filename);

  const response = await fetch("https://api2.transloadit.com/assemblies", { method: "POST", body: formData });
  if (!response.ok) throw new Error(`Transloadit API error ${response.status}: ${await response.text()}`);

  const result = (await response.json()) as {
    ok?: string;
    error?: string;
    message?: string;
    assembly_ssl_url?: string;
    uploads?: Array<{ ssl_url?: string; url?: string }>;
    results?: Record<string, Array<{ ssl_url?: string; url?: string }>>;
  };
  if (result.error) throw new Error(`Transloadit error: ${result.error} - ${result.message ?? ""}`);
  if (result.ok === "ASSEMBLY_COMPLETED") {
    const url = extractTransloaditUrl(result.uploads, result.results);
    if (url) return url;
  }
  if (result.assembly_ssl_url) return pollTransloaditAssembly(result.assembly_ssl_url);
  throw new Error(`Transloadit: no assembly URL to poll. Status: ${result.ok ?? "unknown"}`);
}

function extractTransloaditUrl(
  uploads?: Array<{ ssl_url?: string; url?: string }>,
  results?: Record<string, Array<{ ssl_url?: string; url?: string }>>
): string | null {
  if (uploads?.length) return uploads[0].ssl_url ?? uploads[0].url ?? null;
  const step = results?.[":original"];
  if (step?.length) return step[0].ssl_url ?? step[0].url ?? null;
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

async function downloadFile(url: string, destPath: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to download ${url}: ${response.statusText}`);
  fs.writeFileSync(destPath, Buffer.from(await response.arrayBuffer()));
}

function cleanupFile(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    // ignore
  }
}

async function executeMergeAVFfmpegProvider(
  config: NodeProviderConfig,
  input: MergeAVFfmpegInput,
  ctx: ProviderExecutorContext
): Promise<string> {
  ctx.appendLog(`[${config.id}] Starting video and audio combination...`);
  const { videoUrl, audioUrl, nodeRunId } = input;
  const tmpDir = os.tmpdir();
  const videoPath = path.join(tmpDir, `video_${nodeRunId}.mp4`);
  const audioPath = path.join(tmpDir, `audio_${nodeRunId}.mp3`);
  const outputPath = path.join(tmpDir, `combined_${nodeRunId}.mp4`);

  try {
    ctx.appendLog(`[${config.id}] Downloading video and audio sources...`);
    await downloadFile(videoUrl, videoPath);
    await downloadFile(audioUrl, audioPath);

    ctx.appendLog(`[${config.id}] Running ffmpeg to merge video and audio...`);
    const Ffmpeg = (await import("fluent-ffmpeg")).default;
    await new Promise<void>((resolve, reject) => {
      Ffmpeg()
        .input(videoPath)
        .input(audioPath)
        .outputOptions(["-c:v copy", "-c:a aac", "-map 0:v:0", "-map 1:a:0"])
        .output(outputPath)
        .on("end", () => resolve())
        .on("error", (err) => reject(err))
        .run();
    });

    const outputBuffer = fs.readFileSync(outputPath);
    const outputUrl = await uploadBufferToTransloadit(outputBuffer, `combined_${nodeRunId}.mp4`);
    ctx.appendLog(`[${config.id}] Success: Combined video uploaded to ${outputUrl}`);
    return outputUrl;
  } finally {
    cleanupFile(videoPath);
    cleanupFile(audioPath);
    cleanupFile(outputPath);
  }
}

export const mergeAVTask = task({
  id: "merge-av",
  maxDuration: 300,
  run: async (payload: MergeAVPayload) => {
    const { videoUrl, audioUrl, runId, nodeRunId, orchestratorRunId, waitpointTokenId, workflowId } = payload;

    console.log(`[MergeAVTask] Starting merge-av (nodeRunId: ${nodeRunId})`);

    return runNodeTaskWithProviders({
      taskLabel: "MergeAVTask",
      definition: mergeAVDefinition,
      coordination: { runId, nodeRunId, orchestratorRunId, waitpointTokenId, workflowId },
      input: { videoUrl, audioUrl, nodeRunId },
      executors: {
        ffmpeg: executeMergeAVFfmpegProvider,
        stub: executeStubProvider,
      },
      formatOutput: (outputUrl) => ({ outputVideo: outputUrl }),
      formatReturn: (outputUrl) => ({ outputVideo: outputUrl }),
    });
  },
});
