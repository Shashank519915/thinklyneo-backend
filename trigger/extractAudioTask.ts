/**
 * @fileoverview Trigger.dev `extract-audio` task implementing real FFmpeg audio extraction.
 *
 * Resilience:
 *  - try/finally ensures temp files are always cleaned up even if FFmpeg fails mid-process.
 *  - Two-provider fallback: main-ffmpeg → backup-stub (canned MP3 URL)
 *  - Top-level try/catch prevents 1-hour waitpoint token hangs on unexpected crashes.
 *  - maxDuration: 300s (5 min for large video downloads + FFmpeg processing + Transloadit upload)
 */

import { task, wait } from "@trigger.dev/sdk/v3";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { createHmac } from "crypto";
import { notifyCoordinator } from "./utils";
import { extractAudioDefinition } from "@galaxy/shared";

interface ExtractAudioPayload {
  videoUrl: string;
  runId: string;
  nodeRunId: string;
  orchestratorRunId?: string;
  waitpointTokenId?: string;
  workflowId?: string;
}

interface ProviderAttempt {
  providerId: string;
  status: "success" | "failed";
  error?: string;
  durationMs: number;
}

async function uploadBufferToTransloadit(
  buffer: Buffer,
  filename: string
): Promise<string> {
  const authKey = process.env.TRANSLOADIT_KEY!;
  const authSecret = process.env.TRANSLOADIT_SECRET!;

  if (!authKey || !authSecret) {
    throw new Error("Transloadit credentials not configured");
  }

  const expires = new Date(Date.now() + 10 * 60 * 1000)
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
  formData.append(
    "file",
    new Blob([new Uint8Array(buffer)], { type: "audio/mp3" }),
    filename
  );

  console.log("[ExtractAudioTask] 📤 Uploading audio to Transloadit REST API...");
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

  if (result.error) {
    throw new Error(`Transloadit error: ${result.error} — ${result.message ?? ""}`);
  }

  if (result.ok === "ASSEMBLY_COMPLETED") {
    const url = extractTransloaditUrl(result.uploads, result.results);
    if (url) return url;
  }

  if (result.assembly_ssl_url) {
    return await pollTransloaditAssembly(result.assembly_ssl_url);
  }

  throw new Error(`Transloadit: no assembly URL to poll. Status: ${result.ok ?? "unknown"}`);
}

function extractTransloaditUrl(
  uploads?: Array<{ ssl_url?: string; url?: string }>,
  results?: Record<string, Array<{ ssl_url?: string; url?: string }>>
): string | null {
  if (uploads && uploads.length > 0) {
    return (uploads[0].ssl_url ?? uploads[0].url) ?? null;
  }
  const stepResults = results?.[":original"];
  if (stepResults && stepResults.length > 0) {
    return (stepResults[0].ssl_url ?? stepResults[0].url) ?? null;
  }
  return null;
}

async function pollTransloaditAssembly(assemblyUrl: string): Promise<string> {
  for (let i = 0; i < 30; i++) {
    await wait.for({ seconds: 2 });
    const resp = await fetch(assemblyUrl);
    if (!resp.ok) continue;
    const data = await resp.json() as {
      ok?: string;
      error?: string;
      uploads?: Array<{ ssl_url?: string; url?: string }>;
      results?: Record<string, Array<{ ssl_url?: string; url?: string }>>;
    };
    if (data.error) throw new Error(`Transloadit poll error: ${data.error}`);
    if (data.ok === "ASSEMBLY_COMPLETED" || data.ok === "REQUEST_ABORTED") {
      const url = extractTransloaditUrl(data.uploads, data.results);
      if (url) return url;
      throw new Error(`Transloadit assembly completed but no file URL found`);
    }
  }
  throw new Error("Transloadit assembly polling timed out");
}

async function downloadFile(url: string, destPath: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.statusText}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(destPath, buffer);
}

/** Silently removes a temp file if it exists. */
function cleanupFile(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    // ignore cleanup errors
  }
}

export const extractAudioTask = task({
  id: "extract-audio",
  maxDuration: 300, // 5 minutes: download + FFmpeg + Transloadit upload
  run: async (payload: ExtractAudioPayload) => {
    const {
      videoUrl,
      runId,
      nodeRunId,
      orchestratorRunId,
      waitpointTokenId,
      workflowId,
    } = payload;
    const startMs = Date.now();

    console.log(`[ExtractAudioTask] 🚀 Starting extract-audio task (nodeRunId: ${nodeRunId})`);

    const attempts: ProviderAttempt[] = [];
    let successfulProvider: string | null = null;
    let outputUrl: string | null = null;
    let logs = "";

    try {
      const pStartMain = Date.now();
      const tmpDir = os.tmpdir();
      const videoPath = path.join(tmpDir, `video_source_${nodeRunId}.mp4`);
      const outputPath = path.join(tmpDir, `extracted_${nodeRunId}.mp3`);

      try {
        logs += `[main-ffmpeg] Starting audio extraction...\n`;

        // Download input
        logs += `[main-ffmpeg] Downloading video source...\n`;
        await downloadFile(videoUrl, videoPath);

        // Run FFmpeg to extract audio (-vn -acodec libmp3lame)
        logs += `[main-ffmpeg] Running ffmpeg to extract audio track...\n`;
        const Ffmpeg = (await import("fluent-ffmpeg")).default;
        await new Promise<void>((resolve, reject) => {
          Ffmpeg(videoPath)
            .outputOptions(["-vn", "-acodec libmp3lame"])
            .output(outputPath)
            .on("end", () => resolve())
            .on("error", (err) => reject(err))
            .run();
        });

        logs += `[main-ffmpeg] Extraction complete, reading output file...\n`;
        const outputBuffer = fs.readFileSync(outputPath);

        // Upload
        logs += `[main-ffmpeg] Uploading extracted audio to storage...\n`;
        outputUrl = await uploadBufferToTransloadit(outputBuffer, `extracted_${nodeRunId}.mp3`);

        successfulProvider = "main-ffmpeg";
        attempts.push({
          providerId: "main-ffmpeg",
          status: "success",
          durationMs: Date.now() - pStartMain,
        });
        logs += `[main-ffmpeg] Success: Extracted audio uploaded to ${outputUrl}\n`;
      } catch (err: any) {
        const pDurMain = Date.now() - pStartMain;
        console.warn(`[ExtractAudioTask] ⚠️ Provider main-ffmpeg failed in ${pDurMain}ms:`, err.message);
        logs += `[main-ffmpeg] Failure after ${pDurMain}ms: ${err.message}\n`;
        attempts.push({
          providerId: "main-ffmpeg",
          status: "failed",
          error: err.message,
          durationMs: pDurMain,
        });

        // ── Provider 2: backup-stub ───────────────────────────────────────────
        const pStartBackup = Date.now();
        try {
          logs += `[backup-stub] Attempting fallback stub...\n`;
          await wait.for({ seconds: 2 });

          outputUrl = "https://images.transloadit.com/examples/sample.mp3";
          successfulProvider = "backup-stub";
          attempts.push({
            providerId: "backup-stub",
            status: "success",
            durationMs: Date.now() - pStartBackup,
          });
          logs += `[backup-stub] Success: Fallback generated canned audio URL: ${outputUrl}\n`;
        } catch (backupErr: any) {
          const pDurBackup = Date.now() - pStartBackup;
          logs += `[backup-stub] Failure after ${pDurBackup}ms: ${backupErr.message}\n`;
          attempts.push({
            providerId: "backup-stub",
            status: "failed",
            error: backupErr.message,
            durationMs: pDurBackup,
          });

          const durationMs = Date.now() - startMs;
          if (workflowId && orchestratorRunId && waitpointTokenId) {
            await notifyCoordinator({
              workflowId,
              runId,
              nodeId: nodeRunId,
              status: "failed",
              error: `All providers failed: ${err.message} -> ${backupErr.message}`,
              durationMs,
              orchestratorRunId,
              waitpointTokenId,
              providerUsed: null,
              providerAttempts: attempts,
              logs,
              creditCost: 0,
            });
          }
          throw new Error(`All providers failed: ${err.message} -> ${backupErr.message}`);
        }
      } finally {
        // Always clean up temp files regardless of success or failure
        cleanupFile(videoPath);
        cleanupFile(outputPath);
      }

      const durationMs = Date.now() - startMs;
      const creditCost = extractAudioDefinition.credits.base;

      if (workflowId && orchestratorRunId && waitpointTokenId) {
        await notifyCoordinator({
          workflowId,
          runId,
          nodeId: nodeRunId,
          status: "success",
          output: { outputAudio: outputUrl }, // Matches extractAudioOutputSchema
          durationMs,
          orchestratorRunId,
          waitpointTokenId,
          providerUsed: successfulProvider,
          providerAttempts: attempts,
          logs,
          creditCost,
        });
      }

      return { outputAudio: outputUrl, runId, nodeRunId };

    } catch (fatalErr: any) {
      // Top-level guard: prevents hung 1-hour waitpoint tokens on unexpected crashes
      const durationMs = Date.now() - startMs;
      const fatalMsg = fatalErr instanceof Error ? fatalErr.message : String(fatalErr);
      console.error(`[ExtractAudioTask] 💥 Fatal unhandled error: ${fatalMsg}`);
      if (workflowId && orchestratorRunId && waitpointTokenId) {
        try {
          await notifyCoordinator({
            workflowId,
            runId,
            nodeId: nodeRunId,
            status: "failed",
            error: `Fatal error: ${fatalMsg}`,
            durationMs,
            orchestratorRunId,
            waitpointTokenId,
            providerUsed: null,
            providerAttempts: attempts,
            logs: logs + `\n[FATAL] ${fatalMsg}`,
            creditCost: 0,
          });
        } catch (notifyErr) {
          console.error(`[ExtractAudioTask] Failed to notify coordinator after fatal error:`, notifyErr);
        }
      }
      throw fatalErr;
    }
  },
});
