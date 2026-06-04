import { describe, expect, it } from "vitest";
import {
  buildGeminiInferencePayload,
  buildOpenRouterInferencePayload,
  GEMINI_LLM_MODEL,
} from "@/trigger/llm-payloads";
import type { SerializedNode } from "@/trigger/orchestrator-utils";

const coordination = {
  runId: "run-1",
  nodeRunId: "node-1",
  orchestratorRunId: "orch-1",
  waitpointTokenId: "tok-1",
  workflowId: "wf-1",
};

function node(type: string, inputs: Record<string, unknown> = {}): SerializedNode {
  return { id: "node-1", type, data: { inputs } };
}

describe("llm-payloads", () => {
  it("buildGeminiInferencePayload uses LLM model slug, not node type", () => {
    const payload = buildGeminiInferencePayload(
      node("gemini", { temperature: 0.7, reasoning: "true" }),
      { prompt: "hello" },
      coordination
    );
    expect(payload.model).toBe(GEMINI_LLM_MODEL);
    expect(payload.prompt).toBe("hello");
    expect(payload.temperature).toBe(0.7);
    expect(payload.reasoning).toBe(true);
  });

  it("buildOpenRouterInferencePayload maps image_urls to images for the task", () => {
    const payload = buildOpenRouterInferencePayload(
      node("openRouter", { maxTokens: 512 }),
      {
        prompt: "hi",
        image_urls: ["https://example.com/a.png"],
      },
      coordination
    );
    expect(payload.images).toEqual(["https://example.com/a.png"]);
    expect(payload.maxTokens).toBe(512);
    expect(payload.model).toContain("gemini");
  });

  it("throws when prompt is missing", () => {
    expect(() =>
      buildGeminiInferencePayload(node("gemini"), {}, coordination)
    ).toThrow(/prompt/i);
  });
});
