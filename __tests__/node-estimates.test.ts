import { describe, expect, it } from "vitest";
import {
  estimateOpenRouterCostMicrocredits,
  estimateWorkflowCostMicrocredits,
  formatNodeEstimateMillions,
} from "@shashank519915/shared";

describe("estimateOpenRouterCostMicrocredits", () => {
  it("returns base ~0.0001M when empty", () => {
    expect(estimateOpenRouterCostMicrocredits({})).toBe(100);
    expect(formatNodeEstimateMillions(100)).toBe("~0.0001M");
  });

  it("adds ~0.0003M per image", () => {
    expect(
      estimateOpenRouterCostMicrocredits({ image_urls: ["https://a.jpg"] }),
    ).toBe(100 + 300);
    expect(formatNodeEstimateMillions(400)).toBe("~0.0004M");
  });

  it("adds ~0.0001M per 200 prompt characters", () => {
    const prompt = "x".repeat(200);
    expect(estimateOpenRouterCostMicrocredits({ prompt })).toBe(100 + 100);
  });

  it("adds ~0.0007M per video and ~0.0005M per audio", () => {
    expect(
      estimateOpenRouterCostMicrocredits({
        video_urls: ["https://v.mp4"],
        audio_urls: ["https://a.mp3"],
      }),
    ).toBe(100 + 700 + 500);
  });

  it("workflow total uses dynamic openRouter inputs when provided", () => {
    expect(
      estimateWorkflowCostMicrocredits([
        { type: "gptImage2" },
        {
          type: "openRouter",
          inputs: { image_urls: ["https://a.jpg"] },
        },
      ]),
    ).toBe(210_000 + 400);
  });
});
