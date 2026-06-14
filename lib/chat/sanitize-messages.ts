import type { UIMessage } from "ai";

const DROP_PART_TYPES = new Set(["step-start"]);

/** Strip UI-only parts before OpenRouter / convertToModelMessages. */
export function sanitizeUiMessagesForConversion(messages: UIMessage[]): UIMessage[] {
  return messages
    .map((msg) => ({
      id: msg.id,
      role: msg.role,
      parts: msg.parts.filter((p) => !DROP_PART_TYPES.has(p.type)),
    }))
    .filter((msg) => msg.parts.length > 0);
}

/** Persist only the latest user turn before streaming (avoids re-writing full history). */
export function getInboundUserMessages(messages: UIMessage[]): UIMessage[] {
  const last = messages.at(-1);
  if (last?.role === "user") return [last];
  return [];
}
