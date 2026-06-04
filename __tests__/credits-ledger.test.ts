/**
 * Unit tests for transactional credit hold + reconcile in lib/credits.ts.
 * Uses an in-memory Prisma mock — no real DB, no production code changes.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type LedgerEntry = {
  userId: string;
  amount: number;
  type: string;
  runId?: string;
  balanceAfter?: number;
  description?: string;
};

function createInMemoryCreditsMock() {
  const balances = new Map<string, number>();
  const ledger: LedgerEntry[] = [];

  const client = {
    creditBalance: {
      findUnique: vi.fn(async ({ where: { userId } }: { where: { userId: string } }) => {
        if (!balances.has(userId)) return null;
        return { userId, balance: balances.get(userId)! };
      }),
      create: vi.fn(async ({ data }: { data: { userId: string; balance: number } }) => {
        balances.set(data.userId, data.balance);
        return data;
      }),
      update: vi.fn(
        async ({
          where: { userId },
          data,
        }: {
          where: { userId: string };
          data: { balance: number };
        }) => {
          balances.set(userId, data.balance);
          return { userId, balance: data.balance };
        }
      ),
    },
    creditLedger: {
      create: vi.fn(async ({ data }: { data: LedgerEntry }) => {
        ledger.push(data);
        return data;
      }),
    },
  };

  const prisma = {
    ...client,
    $transaction: vi.fn(async (cb: (tx: typeof client) => Promise<unknown>) => cb(client)),
  };

  return {
    prisma,
    balances,
    ledger,
    seedBalance(userId: string, amount: number) {
      balances.set(userId, amount);
    },
  };
}

const { store } = vi.hoisted(() => ({
  store: createInMemoryCreditsMock(),
}));

vi.mock("../lib/prisma", () => ({
  prisma: store.prisma,
}));

import {
  getOrCreateBalance,
  placeCreditHold,
  reconcileWorkflowCredits,
  estimateWorkflowCost,
} from "../lib/credits";
import { gptImage2Definition, klingV3Definition } from "@shashank519915/shared";

beforeEach(() => {
  store.balances.clear();
  store.ledger.length = 0;
  vi.clearAllMocks();
});

describe("getOrCreateBalance", () => {
  it("returns existing balance without creating ledger entries", async () => {
    store.seedBalance("user_1", 50_000_000);
    const balance = await getOrCreateBalance("user_1");
    expect(balance).toBe(50_000_000);
    expect(store.ledger).toHaveLength(0);
  });

  it("creates initial grant when user has no balance row", async () => {
    const balance = await getOrCreateBalance("new_user");
    expect(balance).toBe(100_000_000);
    expect(store.ledger.some((e) => e.type === "initial_grant")).toBe(true);
    expect(store.balances.get("new_user")).toBe(100_000_000);
  });
});

describe("placeCreditHold", () => {
  it("deducts hold amount and writes hold ledger entry", async () => {
    store.seedBalance("user_1", 100_000_000);
    await placeCreditHold("user_1", 10_000_000, "run_abc");

    expect(store.balances.get("user_1")).toBe(90_000_000);
    const hold = store.ledger.find((e) => e.type === "hold");
    expect(hold).toMatchObject({
      userId: "user_1",
      amount: -10_000_000,
      runId: "run_abc",
      balanceAfter: 90_000_000,
    });
  });

  it("throws when balance is insufficient", async () => {
    store.seedBalance("user_1", 5_000_000);
    await expect(placeCreditHold("user_1", 10_000_000, "run_abc")).rejects.toThrow(
      /Insufficient credit balance/
    );
    expect(store.balances.get("user_1")).toBe(5_000_000);
    expect(store.ledger.some((e) => e.type === "hold")).toBe(false);
  });

  it("no-ops when hold amount is zero or negative", async () => {
    store.seedBalance("user_1", 100_000_000);
    await placeCreditHold("user_1", 0, "run_abc");
    await placeCreditHold("user_1", -1, "run_abc");
    expect(store.balances.get("user_1")).toBe(100_000_000);
    expect(store.ledger).toHaveLength(0);
  });
});

describe("reconcileWorkflowCredits", () => {
  it("releases hold and refunds difference when actual cost is less than hold", async () => {
    store.seedBalance("user_1", 100_000_000);
    await placeCreditHold("user_1", 10_000_000, "run_1");

    await reconcileWorkflowCredits("user_1", "run_1", 6_000_000, 10_000_000);

    // Started 100M, held 10M (90M), reconcile actual 6M -> 94M final
    expect(store.balances.get("user_1")).toBe(94_000_000);
    expect(store.ledger.some((e) => e.type === "deduction")).toBe(true);
    expect(store.ledger.some((e) => e.type === "refund")).toBe(true);
    const refund = store.ledger.find((e) => e.type === "refund");
    expect(refund?.amount).toBe(4_000_000);
  });

  it("reconciles without refund when actual equals hold", async () => {
    store.seedBalance("user_1", 100_000_000);
    await placeCreditHold("user_1", 10_000_000, "run_2");

    await reconcileWorkflowCredits("user_1", "run_2", 10_000_000, 10_000_000);

    expect(store.balances.get("user_1")).toBe(90_000_000);
    expect(store.ledger.some((e) => e.type === "refund")).toBe(false);
  });

  it("logs extra deduction when actual cost exceeds hold", async () => {
    store.seedBalance("user_1", 100_000_000);
    await placeCreditHold("user_1", 5_000_000, "run_3");

    await reconcileWorkflowCredits("user_1", "run_3", 8_000_000, 5_000_000);

    // 100M - 5M hold = 95M; release 5M -> 100M; deduct 8M -> 92M
    expect(store.balances.get("user_1")).toBe(92_000_000);
    const adjustments = store.ledger.filter(
      (e) => e.type === "deduction" && e.description?.includes("Additional deduction")
    );
    expect(adjustments.length).toBeGreaterThanOrEqual(1);
  });

  it("direct-charges when no hold was placed", async () => {
    store.seedBalance("user_1", 100_000_000);

    await reconcileWorkflowCredits("user_1", "run_4", 3_000_000, 0);

    expect(store.balances.get("user_1")).toBe(97_000_000);
    const direct = store.ledger.find((e) => e.type === "deduction" && e.runId === "run_4");
    expect(direct?.amount).toBe(-3_000_000);
  });

  it("no-ops direct charge when actual and hold are both zero", async () => {
    store.seedBalance("user_1", 100_000_000);
    await reconcileWorkflowCredits("user_1", "run_5", 0, 0);
    expect(store.balances.get("user_1")).toBe(100_000_000);
    expect(store.ledger).toHaveLength(0);
  });
});

describe("estimateWorkflowCost (from lib/credits.ts)", () => {
  it("sums known node types from shared definitions", () => {
    const total = estimateWorkflowCost([{ type: "gptImage2" }, { type: "klingV3" }]);
    expect(total).toBeGreaterThan(0);
    expect(total).toBe(
      (gptImage2Definition.credits?.base ?? 0) + (klingV3Definition.credits?.base ?? 0)
    );
  });
});
