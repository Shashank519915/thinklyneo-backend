/**
 * Unit tests for webhook simulation: executeWebhookSimProvider + simulate-callback task.
 * Mocks @trigger.dev/sdk/v3 — no Trigger cloud, no production code changes.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  STUB_DEMO_IMAGE_URL,
  STUB_DEMO_VIDEO_MP4_URL,
  type NodeProviderConfig,
} from "@galaxy/shared";

const mockTasksTrigger = vi.fn();
const mockCreateToken = vi.fn();
const mockForToken = vi.fn();
const mockWaitFor = vi.fn();
const mockCompleteToken = vi.fn();

vi.mock("@trigger.dev/sdk/v3", () => ({
  task: <T extends { run: unknown }>(def: T) => def,
  wait: {
    createToken: (...args: unknown[]) => mockCreateToken(...args),
    forToken: (...args: unknown[]) => mockForToken(...args),
    for: (...args: unknown[]) => mockWaitFor(...args),
    completeToken: (...args: unknown[]) => mockCompleteToken(...args),
  },
  tasks: {
    trigger: (...args: unknown[]) => mockTasksTrigger(...args),
  },
}));

import { executeWebhookSimProvider } from "../trigger/executors";
import { simulateCallbackTask } from "../trigger/simulateCallbackTask";

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateToken.mockResolvedValue({ id: "token_test_123" });
  mockTasksTrigger.mockResolvedValue(undefined);
  mockWaitFor.mockResolvedValue(undefined);
  mockCompleteToken.mockResolvedValue(undefined);
});

describe("executeWebhookSimProvider", () => {
  const baseConfig: NodeProviderConfig = {
    id: "gpt-image-webhook",
    kind: "webhook-sim",
    nodeType: "gptImage2",
    delaySeconds: 10,
    tokenTimeout: "5m",
  };

  it("creates token, triggers simulate-callback, and returns output URL on success", async () => {
    mockForToken.mockResolvedValue({
      ok: true,
      output: { output: "https://example.com/image.jpg" },
    });

    const logs: string[] = [];
    const url = await executeWebhookSimProvider(
      baseConfig,
      { prompt: "a cat" },
      { appendLog: (line) => logs.push(line) }
    );

    expect(url).toBe("https://example.com/image.jpg");
    expect(mockCreateToken).toHaveBeenCalledWith({ timeout: "5m" });
    expect(mockTasksTrigger).toHaveBeenCalledWith("simulate-callback", {
      tokenId: "token_test_123",
      nodeType: "gptImage2",
      prompt: "a cat",
      delaySeconds: 10,
    });
    expect(mockForToken).toHaveBeenCalledWith("token_test_123");
    expect(logs.some((l) => l.includes("Success"))).toBe(true);
  });

  it("throws when nodeType is missing from provider config", async () => {
    await expect(
      executeWebhookSimProvider(
        { id: "bad", kind: "webhook-sim" },
        {},
        { appendLog: () => {} }
      )
    ).rejects.toThrow(/missing nodeType/);
  });

  it("throws when wait.forToken fails (simulates webhook timeout)", async () => {
    mockForToken.mockResolvedValue({
      ok: false,
      error: new Error("Waitpoint token timed out"),
    });

    await expect(
      executeWebhookSimProvider(baseConfig, {}, { appendLog: () => {} })
    ).rejects.toThrow(/timed out/);
  });

  it("throws when callback returns empty output URL", async () => {
    mockForToken.mockResolvedValue({
      ok: true,
      output: { output: "" },
    });

    await expect(
      executeWebhookSimProvider(baseConfig, {}, { appendLog: () => {} })
    ).rejects.toThrow(/did not return an output URL/);
  });
});

describe("simulateCallbackTask.run", () => {
  it("waits then completes token with demo image URL for gptImage2", async () => {
    const result = await simulateCallbackTask.run({
      tokenId: "tok_gpt",
      nodeType: "gptImage2",
      prompt: "test",
      delaySeconds: 1,
    });

    expect(mockWaitFor).toHaveBeenCalledWith({ seconds: 1 });
    expect(mockCompleteToken).toHaveBeenCalledWith("tok_gpt", {
      output: STUB_DEMO_IMAGE_URL,
    });
    expect(result).toEqual({
      success: true,
      output: STUB_DEMO_IMAGE_URL,
    });
  });

  it("waits then completes token with demo surf mp4 for klingV3", async () => {
    const result = await simulateCallbackTask.run({
      tokenId: "tok_kling",
      nodeType: "klingV3",
      prompt: "test",
      delaySeconds: 12,
    });

    expect(mockWaitFor).toHaveBeenCalledWith({ seconds: 12 });
    expect(mockCompleteToken).toHaveBeenCalledWith("tok_kling", {
      output: STUB_DEMO_VIDEO_MP4_URL,
    });
    expect(result.output).toContain(".mp4");
  });
});
