import { NextResponse } from "next/server";
import sharp from "sharp";
import { maxUploadBytesForMime, PLATFORM_LIMITS } from "@shashank519915/shared";
import { verifyApiRequest } from "@/lib/api-auth";
import { transloaditConfigured, uploadBufferToTransloadit } from "@/lib/transloadit";

/**
 * POST /api/v1/uploads
 *
 * API-key authenticated file upload to permanent Transloadit storage. Accepts (JSON):
 *   { url } | { data_uri } | { base64, mime, filename } ,
 * or a multipart form with field "file". Returns a stable URL + metadata. Read/ingest only —
 * unrelated to workflow execution.
 */

interface Ingested {
  buffer: Buffer;
  mime: string;
  filename: string;
}

async function ingestFromUrl(url: string): Promise<Ingested> {
  const resp = await fetch(url, { redirect: "follow" });
  if (!resp.ok) throw new Error(`Failed to fetch url (HTTP ${resp.status}).`);
  const mime = resp.headers.get("content-type")?.split(";")[0]?.trim() || "application/octet-stream";
  const buffer = Buffer.from(await resp.arrayBuffer());
  const name = url.split("/").pop()?.split("?")[0] || "upload";
  return { buffer, mime, filename: name };
}

function ingestFromDataUri(dataUri: string): Ingested {
  const match = /^data:([^;]+);base64,(.+)$/i.exec(dataUri.trim());
  if (!match) throw new Error("Invalid data_uri (expected data:<mime>;base64,<data>).");
  const mime = match[1];
  const buffer = Buffer.from(match[2], "base64");
  const ext = mime.split("/")[1] ?? "bin";
  return { buffer, mime, filename: `upload.${ext}` };
}

export async function POST(request: Request) {
  const authResult = await verifyApiRequest(request);
  if ("error" in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }
  const { rateLimitHeaders } = authResult;

  if (!transloaditConfigured()) {
    return NextResponse.json(
      { error: "Upload service not configured (TRANSLOADIT_KEY / TRANSLOADIT_SECRET)." },
      { status: 500, headers: rateLimitHeaders }
    );
  }

  try {
    let ingested: Ingested;
    const contentType = request.headers.get("content-type") ?? "";

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file") as File | null;
      if (!file) {
        return NextResponse.json({ error: "No file provided." }, { status: 400, headers: rateLimitHeaders });
      }
      ingested = {
        buffer: Buffer.from(await file.arrayBuffer()),
        mime: file.type || "application/octet-stream",
        filename: file.name || "upload",
      };
    } else {
      const body = (await request.json().catch(() => ({}))) as {
        url?: string;
        data_uri?: string;
        base64?: string;
        mime?: string;
        filename?: string;
      };
      if (body.url) {
        ingested = await ingestFromUrl(body.url);
      } else if (body.data_uri) {
        ingested = ingestFromDataUri(body.data_uri);
      } else if (body.base64) {
        const mime = body.mime || "application/octet-stream";
        ingested = {
          buffer: Buffer.from(body.base64, "base64"),
          mime,
          filename: body.filename || `upload.${mime.split("/")[1] ?? "bin"}`,
        };
      } else {
        return NextResponse.json(
          { error: "Provide one of: url, data_uri, base64 (with mime), or a multipart file." },
          { status: 400, headers: rateLimitHeaders }
        );
      }
      if (body.filename) ingested.filename = body.filename;
    }

    // Size + (for images) dimension validation, matching platform limits.
    const maxBytes = maxUploadBytesForMime(ingested.mime);
    if (ingested.buffer.byteLength > maxBytes) {
      const maxMb = Math.round(maxBytes / (1024 * 1024));
      return NextResponse.json(
        { error: `File exceeds maximum upload size of ${maxMb}MB for ${ingested.mime.split("/")[0] || "file"} uploads.` },
        { status: 400, headers: rateLimitHeaders }
      );
    }
    if (ingested.mime.startsWith("image/")) {
      try {
        const meta = await sharp(ingested.buffer).metadata();
        const maxW = PLATFORM_LIMITS.image.maxWidth ?? 4096;
        const maxH = PLATFORM_LIMITS.image.maxHeight ?? 4096;
        if (meta.width && meta.width > maxW) {
          return NextResponse.json({ error: `Image width ${meta.width}px exceeds maximum ${maxW}px.` }, { status: 400, headers: rateLimitHeaders });
        }
        if (meta.height && meta.height > maxH) {
          return NextResponse.json({ error: `Image height ${meta.height}px exceeds maximum ${maxH}px.` }, { status: 400, headers: rateLimitHeaders });
        }
      } catch {
        return NextResponse.json({ error: "Invalid or unsupported image file." }, { status: 400, headers: rateLimitHeaders });
      }
    }

    const url = await uploadBufferToTransloadit(ingested.buffer, ingested.filename, ingested.mime);
    return NextResponse.json(
      { data: { url, name: ingested.filename, mime: ingested.mime, sizeBytes: ingested.buffer.byteLength } },
      { status: 201, headers: rateLimitHeaders }
    );
  } catch (error) {
    console.error("POST /api/v1/uploads error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Upload failed" },
      { status: 500, headers: rateLimitHeaders }
    );
  }
}
