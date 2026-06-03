/**
 * @fileoverview Trigger.dev `merge-video`: FFmpeg concat or xfade transitions with provider fallback.
 */

import { task, wait } from "@trigger.dev/sdk/v3";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { createHmac } from "crypto";
import type { NodeProviderConfig } from "@galaxy/shared";
import {
  isLikelyVideoUrl,
  mergeVideoDefinition,
  parseMergeVideoTransition,
  type MergeVideoTransition,
} from "@galaxy/shared";
import { executeStubProvider } from "./executors";
import type { ProviderExecutorContext } from "./provider-chain";
import { runNodeTaskWithProviders } from "./task-coordination";
import { buildXfadeFilterGraph } from "./merge-video-ffmpeg";

interface MergeVideoPayload {
  videoUrls: string[];
  transition?: MergeVideoTransition;
  runId: string;
  nodeRunId: string;
  orchestratorRunId?: string;
  waitpointTokenId?: string;
  workflowId?: string;
}

interface MergeVideoFfmpegInput {
  videoUrls: string[];
  transition: MergeVideoTransition;
  nodeRunId: string;
}

async function uploadFileToTransloadit(filePath: string, filename: string): Promise<string> {
  const buffer = fs.readFileSync(filePath);
  return uploadBufferToTransloadit(buffer, filename);
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

function probeMedia(filePath: string): Promise<{ durationSec: number; hasAudio: boolean }> {
  return new Promise((resolve, reject) => {
    import("fluent-ffmpeg")
      .then(({ default: ffmpeg }) => {
        ffmpeg.ffprobe(filePath, (err, data) => {
          if (err) reject(err);
          else {
            const hasAudio =
              data.streams?.some((s) => s.codec_type === "audio") ?? false;
            resolve({
              durationSec: data.format.duration ?? 0,
              hasAudio,
            });
          }
        });
      })
      .catch(reject);
  });
}

function runFfmpegConcat(concatTxtPath: string, outputPath: string): Promise<void> {
  return import("fluent-ffmpeg").then(({ default: Ffmpeg }) =>
    new Promise<void>((resolve, reject) => {
      Ffmpeg(concatTxtPath)
        .inputOptions(["-f concat", "-safe 0"])
        .outputOptions(["-c copy"])
        .output(outputPath)
        .on("end", () => resolve())
        .on("error", (err) => reject(err))
        .run();
    })
  );
}

function runFfmpegXfade(
  inputPaths: string[],
  outputPath: string,
  transition: "fade" | "dissolve"
): Promise<void> {
  return import("fluent-ffmpeg").then(async ({ default: ffmpeg }) => {
    const probes = await Promise.all(inputPaths.map(probeMedia));
    const durations = probes.map((p) => p.durationSec);
    const hasAudio = probes.map((p) => p.hasAudio);
    const { filterComplex, includeAudio } = buildXfadeFilterGraph(
      durations,
      hasAudio,
      transition
    );

    const outputOptions = [
      "-map",
      "[vout]",
      "-pix_fmt",
      "yuv420p",
      "-c:v",
      "libx264",
    ];
    if (includeAudio) {
      outputOptions.push("-map", "[aout]", "-c:a", "aac", "-b:a", "192k");
    } else {
      outputOptions.push("-an");
    }

    return new Promise<void>((resolve, reject) => {
      let cmd = ffmpeg();
      for (const p of inputPaths) {
        cmd = cmd.input(p);
      }
      cmd
        .complexFilter(filterComplex)
        .outputOptions(outputOptions)
        .output(outputPath)
        .on("end", () => resolve())
        .on("error", (err) => reject(err))
        .run();
    });
  });
}

async function executeMergeVideoFfmpegProvider(
  config: NodeProviderConfig,
  input: MergeVideoFfmpegInput,
  ctx: ProviderExecutorContext
): Promise<string> {
  ctx.appendLog(`[${config.id}] Starting video merge (${input.transition})...`);
  const { videoUrls, transition, nodeRunId } = input;
  const validUrls = videoUrls.filter(isLikelyVideoUrl);
  if (validUrls.length < 2) {
    const sample = videoUrls[0] ? String(videoUrls[0]).slice(0, 120) : "";
    throw new Error(
      `At least two valid video URLs (.mp4, .webm, .mov) are required. Got ${videoUrls.length} input(s)` +
        (sample ? ` (e.g. ${sample}…)` : "") +
        `. Images (.webp/.jpg) cannot be merged as video.`
    );
  }

  const tmpDir = os.tmpdir();
  const inputPaths: string[] = [];
  const concatTxtPath = path.join(tmpDir, `concat_${nodeRunId}.txt`);
  const outputPath = path.join(tmpDir, `merged_${nodeRunId}.mp4`);

  try {
    ctx.appendLog(`[${config.id}] Downloading ${validUrls.length} video(s)...`);
    for (let i = 0; i < validUrls.length; i++) {
      const p = path.join(tmpDir, `input_${nodeRunId}_${i}.mp4`);
      await downloadFile(validUrls[i]!, p);
      inputPaths.push(p);
    }

    if (transition === "none") {
      const concatContent = inputPaths
        .map((filePath) => `file '${filePath.replace(/\\/g, "/")}'`)
        .join("\n");
      fs.writeFileSync(concatTxtPath, concatContent);
      ctx.appendLog(`[${config.id}] Running ffmpeg concat (copy)...`);
      await runFfmpegConcat(concatTxtPath, outputPath);
    } else {
      ctx.appendLog(`[${config.id}] Running ffmpeg xfade (${transition}, audio crossfade when tracks exist)...`);
      await runFfmpegXfade(inputPaths, outputPath, transition);
    }

    const outputUrl = await uploadFileToTransloadit(outputPath, `merged_${nodeRunId}.mp4`);
    ctx.appendLog(`[${config.id}] Success: merged video at ${outputUrl}`);
    return outputUrl;
  } finally {
    for (const p of inputPaths) cleanupFile(p);
    cleanupFile(concatTxtPath);
    cleanupFile(outputPath);
  }
}

export const mergeVideoTask = task({
  id: "merge-video",
  maxDuration: 300,
  /** xfade + libx264 needs more RAM than concat copy on default small-1x (512MB). */
  machine: "medium-2x",
  retry: {
    outOfMemory: {
      machine: "large-1x",
    },
  },
  run: async (payload: MergeVideoPayload) => {
    const {
      videoUrls,
      transition: transitionRaw = "none",
      runId,
      nodeRunId,
      orchestratorRunId,
      waitpointTokenId,
      workflowId,
    } = payload;
    const transition = parseMergeVideoTransition(transitionRaw);

    console.log(
      `[MergeVideoTask] Starting merge-video (nodeRunId: ${nodeRunId}, videos: ${videoUrls.length}, transition: ${transition})`
    );

    return runNodeTaskWithProviders({
      taskLabel: "MergeVideoTask",
      definition: mergeVideoDefinition,
      coordination: { runId, nodeRunId, orchestratorRunId, waitpointTokenId, workflowId },
      input: { videoUrls, transition, nodeRunId },
      executors: {
        ffmpeg: executeMergeVideoFfmpegProvider,
        stub: executeStubProvider,
      },
      formatOutput: (outputUrl) => ({ outputVideo: outputUrl }),
      formatReturn: (outputUrl) => ({ outputVideo: outputUrl }),
    });
  },
});
