import { NextResponse } from "next/server";

const MAX_BODY_BYTES = Number(process.env.CHAT_MAX_BODY_BYTES ?? 512_000);
const MAX_MESSAGES = Number(process.env.CHAT_MAX_MESSAGES ?? 120);

export type ParseBodyResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; response: NextResponse };

/** Parse JSON body with size guard and consistent 400 responses. */
export async function parseChatJsonBody(request: Request): Promise<ParseBodyResult> {
  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_BODY_BYTES) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Request body too large" }, { status: 413 }),
    };
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Request body too large" }, { status: 413 }),
    };
  }

  if (!raw.trim()) {
    return { ok: true, body: {} };
  }

  try {
    const body = JSON.parse(raw) as Record<string, unknown>;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return {
        ok: false,
        response: NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }),
      };
    }
    return { ok: true, body };
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }),
    };
  }
}

export function validateMessagesArray(
  messages: unknown,
): { ok: true; count: number } | { ok: false; response: NextResponse } {
  if (!Array.isArray(messages)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "messages required" }, { status: 400 }),
    };
  }
  if (messages.length === 0) {
    return {
      ok: false,
      response: NextResponse.json({ error: "messages required" }, { status: 400 }),
    };
  }
  if (messages.length > MAX_MESSAGES) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Too many messages in request" }, { status: 400 }),
    };
  }
  return { ok: true, count: messages.length };
}
