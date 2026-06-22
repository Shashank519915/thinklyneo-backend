import { describe, it, expect } from "vitest";
import type { UIMessage } from "ai";
import {
  getInboundUserMessages,
  sanitizeHelperHistory,
  sanitizeUiMessagesForConversion,
} from "@/lib/chat/sanitize-messages";

describe("sanitizeUiMessagesForConversion", () => {
  it("removes step-start parts", () => {
    const messages: UIMessage[] = [
      {
        id: "a1",
        role: "assistant",
        parts: [
          { type: "step-start" },
          { type: "text", text: "hello", state: "done" },
        ],
      },
    ];
    const out = sanitizeUiMessagesForConversion(messages);
    expect(out[0].parts).toEqual([{ type: "text", text: "hello", state: "done" }]);
  });
});

describe("getInboundUserMessages", () => {
  it("returns only the last user message", () => {
    const messages: UIMessage[] = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "first" }] },
      { id: "a1", role: "assistant", parts: [{ type: "text", text: "ok" }] },
      { id: "u2", role: "user", parts: [{ type: "text", text: "second" }] },
    ];
    const inbound = getInboundUserMessages(messages);
    expect(inbound).toHaveLength(1);
    expect(inbound[0].id).toBe("u2");
  });
});

describe("sanitizeHelperHistory", () => {
  it("sanitizes past assistant messages but leaves user and latest message intact", () => {
    const messages: UIMessage[] = [
      {
        id: "u1",
        role: "user",
        parts: [{ type: "text", text: "tell me about klingv3" }],
      },
      {
        id: "a1",
        role: "assistant",
        parts: [
          {
            type: "text",
            text: "The KlingV3 node generates high quality videos.\n\nHere are details:\n| Key | Value |\n|---|---|\n| Credits | 1M |",
          },
        ],
      },
      {
        id: "u2",
        role: "user",
        parts: [{ type: "text", text: "how does crop work?" }],
      },
      {
        id: "a2",
        role: "assistant",
        parts: [{ type: "text", text: "Latest assistant message should remain fully intact.\n\nTable here too." }],
      },
    ];

    const out = sanitizeHelperHistory(messages);

    // User message is unchanged
    expect(out[0].parts[0].text).toBe("tell me about klingv3");

    // Past assistant message is sanitized (split at double newline, suffix appended)
    expect(out[1].parts[0].text).toBe("The KlingV3 node generates high quality videos. [Details truncated for context history]");

    // User message is unchanged
    expect(out[2].parts[0].text).toBe("how does crop work?");

    // Latest assistant message (last item in array) is unchanged
    expect(out[3].parts[0].text).toBe("Latest assistant message should remain fully intact.\n\nTable here too.");
  });

  it("extracts the first line if first paragraph contains a markdown table", () => {
    const messages: UIMessage[] = [
      {
        id: "a1",
        role: "assistant",
        parts: [
          {
            type: "text",
            text: "| Param | Type |\n|---|---|\n| in:prompt | text |",
          },
        ],
      },
      {
        id: "u1",
        role: "user",
        parts: [{ type: "text", text: "done" }],
      },
    ];

    const out = sanitizeHelperHistory(messages);
    expect(out[0].parts[0].text).toBe("| Param | Type | [Details truncated for context history]");
  });
});

