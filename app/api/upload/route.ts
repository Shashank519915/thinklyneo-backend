/**
 * @fileoverview Authenticated file upload endpoint: persists uploads to cloud storage via Transloadit.
 * Uses memory-only REST API uploads to remain compatible with serverless environments.
 */

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { createHmac } from "crypto";
import sharp from "sharp";
import { maxUploadBytesForMime, PLATFORM_LIMITS } from "@galaxy/shared";

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

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const mime = file.type || "application/octet-stream";
    const maxBytes = maxUploadBytesForMime(mime);
    if (file.size > maxBytes) {
      const maxMb = Math.round(maxBytes / (1024 * 1024));
      return NextResponse.json(
        {
          error: `File exceeds maximum upload size of ${maxMb}MB for ${mime.split("/")[0] || "file"} uploads.`,
        },
        { status: 400 }
      );
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    if (mime.startsWith("image/")) {
      try {
        const meta = await sharp(buffer).metadata();
        const maxW = PLATFORM_LIMITS.image.maxWidth ?? 4096;
        const maxH = PLATFORM_LIMITS.image.maxHeight ?? 4096;
        if (meta.width && meta.width > maxW) {
          return NextResponse.json(
            { error: `Image width ${meta.width}px exceeds maximum ${maxW}px.` },
            { status: 400 }
          );
        }
        if (meta.height && meta.height > maxH) {
          return NextResponse.json(
            { error: `Image height ${meta.height}px exceeds maximum ${maxH}px.` },
            { status: 400 }
          );
        }
      } catch {
        return NextResponse.json({ error: "Invalid or unsupported image file." }, { status: 400 });
      }
    }

    const authKey = process.env.TRANSLOADIT_KEY;
    const authSecret = process.env.TRANSLOADIT_SECRET;

    if (!authKey || !authSecret) {
      console.error("[UploadAPI] Missing Transloadit credentials in env");
      return NextResponse.json(
        { error: "Transloadit credentials not configured" },
        { status: 500 }
      );
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

    const uploadFormData = new FormData();
    uploadFormData.append("params", params);
    uploadFormData.append("signature", `sha1:${signature}`);
    uploadFormData.append(
      "file",
      new Blob([new Uint8Array(buffer)], { type: file.type || "image/jpeg" }),
      file.name
    );

    console.log("[UploadAPI] 📤 Uploading to Transloadit REST API...");
    const response = await fetch("https://api2.transloadit.com/assemblies", {
      method: "POST",
      body: uploadFormData,
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
      throw new Error(`Transloadit error: ${result.error} — ${result.message ?? ""}`);
    }

    let url: string | null = null;

    // Check if already completed on initial response
    if (result.ok === "ASSEMBLY_COMPLETED") {
      url = extractTransloaditUrl(result.uploads, result.results);
    }

    // Poll if still executing
    if (!url && result.assembly_ssl_url) {
      console.log("[UploadAPI] Assembly still executing, polling...");
      url = await pollTransloaditAssembly(result.assembly_ssl_url);
    }

    if (!url) {
      throw new Error("Failed to extract uploaded file URL");
    }

    return NextResponse.json({ url, name: file.name });
  } catch (error) {
    console.error("[UploadAPI] Upload error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Upload service failed" },
      { status: 500 }
    );
  }
}
