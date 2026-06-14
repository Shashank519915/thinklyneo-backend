import { describe, it, expect } from "vitest";
import type { UIMessage } from "ai";
import {
  getInboundUserMessages,
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
