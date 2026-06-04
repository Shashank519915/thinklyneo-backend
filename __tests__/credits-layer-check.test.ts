/**
 * Per-layer credit hold checks (mid-run exhaustion guard).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const holdByRun = new Map<string, number>();
const nodeRunCosts = new Map<string, Array<{ status: string; creditCost: number | null }>>();

vi.mock("../lib/prisma", () => ({
  prisma: {
    creditLedger: {
      findFirst: vi.fn(async ({ where }: { where: { runId: string; type: string } }) => {
        const amount = holdByRun.get(where.runId);
        if (amount == null) return null;
        return { amount: -amount };
      }),
    },
    nodeRun: {
      findMany: vi.fn(async ({ where }: { where: { runId: string; status?: string } }) => {
        const rows = nodeRunCosts.get(where.runId) ?? [];
        if (where.status === "success") {
          return rows.filter((r) => r.status === "success");
        }
        return rows;
      }),
    },
  },
}));

import { checkNextLayerWithinHold } from "../lib/credits";
import { gptImage2Definition, klingV3Definition } from "@shashank519915/shared";

describe("checkNextLayerWithinHold", () => {
  beforeEach(() => {
    holdByRun.clear();
    nodeRunCosts.clear();
  });

  it("allows layer when hold covers spent plus next layer estimate", async () => {
    holdByRun.set("run_1", 10_000_000);
    nodeRunCosts.set("run_1", [{ status: "success", creditCost: 2_000_000 }]);

    const result = await checkNextLayerWithinHold("run_1", [
      { type: gptImage2Definition.type },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.remainingHold).toBe(8_000_000);
      expect(result.layerCost).toBe(gptImage2Definition.credits.base);
    }
  });

  it("rejects layer when next estimate exceeds remaining hold", async () => {
    holdByRun.set("run_1", 5_000_000);
    nodeRunCosts.set("run_1", [{ status: "success", creditCost: 4_500_000 }]);

    const result = await checkNextLayerWithinHold("run_1", [
      { type: klingV3Definition.type },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("Run stopped");
      expect(result.layerCost).toBe(klingV3Definition.credits.base);
    }
  });

  it("no-ops when no hold was placed", async () => {
    const result = await checkNextLayerWithinHold("run_none", [
      { type: klingV3Definition.type },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.holdAmount).toBe(0);
    }
  });
});
