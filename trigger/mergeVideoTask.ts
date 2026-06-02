/**
 * @fileoverview Trigger.dev `merge-video`: FFmpeg concat with config-driven provider fallback.
 */

import { task, wait } from "@trigger.dev/sdk/v3";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { createHmac } from "crypto";
import type { NodeProviderConfig } from "@galaxy/shared";
import { mergeVideoDefinition } from "@galaxy/shared";
import { executeStubProvider } from "./executors";
import type { ProviderExecutorContext } from "./provider-chain";
import { runNodeTaskWithProviders } from "./task-coordination";

interface MergeVideoPayload {
  videoUrl1: string;
  videoUrl2: string;
  videoUrl3?: string | null;
  runId: string;
  nodeRunId: string;
  orchestratorRunId?: string;
  waitpointTokenId?: string;
  workflowId?: string;
}

interface MergeVideoFfmpegInput {
  videoUrl1: string;
  videoUrl2: string;
  videoUrl3?: string | null;
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

async function executeMergeVideoFfmpegProvider(
  config: NodeProviderConfig,
  input: MergeVideoFfmpegInput,
  ctx: ProviderExecutorContext
): Promise<string> {
  ctx.appendLog(`[${config.id}] Starting video concatenation...`);
  const { videoUrl1, videoUrl2, videoUrl3, nodeRunId } = input;
  const tmpDir = os.tmpdir();
  const inputPath1 = path.join(tmpDir, `input1_${nodeRunId}.mp4`);
  const inputPath2 = path.join(tmpDir, `input2_${nodeRunId}.mp4`);
  const inputPath3 = path.join(tmpDir, `input3_${nodeRunId}.mp4`);
  const concatTxtPath = path.join(tmpDir, `concat_${nodeRunId}.txt`);
  const outputPath = path.join(tmpDir, `merged_${nodeRunId}.mp4`);

  try {
    ctx.appendLog(`[${config.id}] Downloading video inputs...`);
    await downloadFile(videoUrl1, inputPath1);
    await downloadFile(videoUrl2, inputPath2);
    const filesToConcat = [inputPath1, inputPath2];
    if (videoUrl3) {
      await downloadFile(videoUrl3, inputPath3);
      filesToConcat.push(inputPath3);
    }

    const concatContent = filesToConcat
      .map((filePath) => `file '${filePath.replace(/\\/g, "/")}'`)
      .join("\n");
    fs.writeFileSync(concatTxtPath, concatContent);
    ctx.appendLog(`[${config.id}] Running ffmpeg concat...`);

    const Ffmpeg = (await import("fluent-ffmpeg")).default;
    await new Promise<void>((resolve, reject) => {
      Ffmpeg(concatTxtPath)
        .inputOptions(["-f concat", "-safe 0"])
        .outputOptions(["-c copy"])
        .output(outputPath)
        .on("end", () => resolve())
        .on("error", (err) => reject(err))
        .run();
    });

    const mergedBuffer = fs.readFileSync(outputPath);
    const outputUrl = await uploadBufferToTransloadit(mergedBuffer, `merged_${nodeRunId}.mp4`);
    ctx.appendLog(`[${config.id}] Success: Merged video uploaded to ${outputUrl}`);
    return outputUrl;
  } finally {
    cleanupFile(inputPath1);
    cleanupFile(inputPath2);
    if (videoUrl3) cleanupFile(inputPath3);
    cleanupFile(concatTxtPath);
    cleanupFile(outputPath);
  }
}

export const mergeVideoTask = task({
  id: "merge-video",
  maxDuration: 300,
  run: async (payload: MergeVideoPayload) => {
    const { videoUrl1, videoUrl2, videoUrl3, runId, nodeRunId, orchestratorRunId, waitpointTokenId, workflowId } =
      payload;

    console.log(`[MergeVideoTask] Starting merge-video (nodeRunId: ${nodeRunId})`);

    return runNodeTaskWithProviders({
      taskLabel: "MergeVideoTask",
      definition: mergeVideoDefinition,
      coordination: { runId, nodeRunId, orchestratorRunId, waitpointTokenId, workflowId },
      input: { videoUrl1, videoUrl2, videoUrl3, nodeRunId },
      executors: {
        ffmpeg: executeMergeVideoFfmpegProvider,
        stub: executeStubProvider,
      },
      formatOutput: (outputUrl) => ({ outputVideo: outputUrl }),
      formatReturn: (outputUrl) => ({ outputVideo: outputUrl }),
    });
  },
});
