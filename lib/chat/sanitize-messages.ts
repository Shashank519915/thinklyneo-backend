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

/** Limit message history sent to the LLM to prevent context pollution and repetition. */
export function truncateMessageHistory(messages: UIMessage[], maxMessages = 6): UIMessage[] {
  if (messages.length <= maxMessages) return messages;

  let sliced = messages.slice(-maxMessages);
  // Ensure the history starts with a user message for proper chat flow
  if (sliced.length > 0 && sliced[0].role === "assistant") {
    sliced = sliced.slice(1);
  }
  return sliced;
}

/**
 * For helper chats, sanitize past assistant messages in history to prevent the LLM
 * from repeating large tables or catalogs. Keeps only the introductory sentence
 * and drops heavy details/tables.
 */
export function sanitizeHelperHistory(messages: UIMessage[]): UIMessage[] {
  return messages.map((msg, index) => {
    // Only sanitize past assistant messages (not the latest message being generated or user messages)
    if (msg.role === "assistant" && index < messages.length - 1) {
      return {
        ...msg,
        parts: msg.parts.map((p) => {
          if (p.type === "text") {
            const originalText = p.text;
            
            // Split by double newline to get the first paragraph
            let summary = originalText.split(/\n\n+/)[0] || "";
            
            // If the summary contains markdown tables or is too long, extract first line
            if (summary.includes("|") || summary.length > 250) {
              const firstLine = summary.split("\n")[0] || "";
              summary = firstLine.slice(0, 150);
            }
            
            // Fallback for empty summaries
            if (!summary.trim()) {
              summary = "I have provided details for the requested node.";
            } else {
              summary = `${summary.trim()} [Details truncated for context history]`;
            }

            return {
              ...p,
              text: summary,
            };
          }
          return p;
        }),
      };
    }
    return msg;
  });
}

