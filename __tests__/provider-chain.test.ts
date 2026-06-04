import { describe, it, expect, vi } from "vitest";
import type { NodeDefinition } from "@shashank519915/shared";

vi.mock("../trigger/utils", () => ({
  callWithDurableTimeout: async <T>(
    _seconds: number,
    fn: (signal: AbortSignal) => Promise<T>
  ) => fn(new AbortController().signal),
}));

import {
  ProviderChainExhaustedError,
  runProviderChain,
  type ProviderExecutor,
} from "../trigger/provider-chain";

const testDefinition: NodeDefinition = {
  type: "testNode",
  name: "Test",
  category: "text",
  icon: "Sparkles",
  color: "blue",
  credits: { base: 100 },
  inputs: [],
  outputs: [],
  inputSchema: {} as NodeDefinition["inputSchema"],
  outputSchema: {} as NodeDefinition["outputSchema"],
  defaultTimeoutSeconds: 5,
  retryPerProvider: 1,
  providers: [
    { id: "primary", kind: "openrouter", timeoutSeconds: 5 },
    { id: "backup-stub", kind: "stub", stubDelaySeconds: 0, stubTextTemplate: "ok" },
  ],
};

describe("runProviderChain", () => {
  it("returns first successful provider output", async () => {
    const primary: ProviderExecutor<{ prompt: string }, string> = vi.fn(async () => "primary-result");
    const stub: ProviderExecutor<{ prompt: string }, string> = vi.fn(async () => "stub-result");

    const result = await runProviderChain({
      definition: testDefinition,
      input: { prompt: "hello" },
      executors: { openrouter: primary, stub },
    });

    expect(result.output).toBe("primary-result");
    expect(result.providerUsed).toBe("primary");
    expect(result.providerAttempts).toHaveLength(1);
    expect(result.providerAttempts[0].status).toBe("success");
    expect(stub).not.toHaveBeenCalled();
  });

  it("falls back to second provider when first fails", async () => {
    const primary: ProviderExecutor<{ prompt: string }, string> = vi.fn(async () => {
      throw new Error("API down");
    });
    const stub: ProviderExecutor<{ prompt: string }, string> = vi.fn(async () => "stub-result");

    const result = await runProviderChain({
      definition: testDefinition,
      input: { prompt: "hello" },
      executors: { openrouter: primary, stub },
    });

    expect(result.output).toBe("stub-result");
    expect(result.providerUsed).toBe("backup-stub");
    expect(result.providerAttempts).toHaveLength(2);
    expect(result.providerAttempts[0].status).toBe("failed");
    expect(result.providerAttempts[1].status).toBe("success");
  });

  it("throws ProviderChainExhaustedError when all providers fail", async () => {
    const primary: ProviderExecutor<{ prompt: string }, string> = vi.fn(async () => {
      throw new Error("primary fail");
    });
    const stub: ProviderExecutor<{ prompt: string }, string> = vi.fn(async () => {
      throw new Error("stub fail");
    });

    await expect(
      runProviderChain({
        definition: testDefinition,
        input: { prompt: "hello" },
        executors: { openrouter: primary, stub },
      })
    ).rejects.toBeInstanceOf(ProviderChainExhaustedError);

    try {
      await runProviderChain({
        definition: testDefinition,
        input: { prompt: "hello" },
        executors: { openrouter: primary, stub },
      });
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderChainExhaustedError);
      const chainErr = err as ProviderChainExhaustedError;
      expect(chainErr.providerAttempts).toHaveLength(2);
      expect(chainErr.logs).toContain("[primary]");
      expect(chainErr.logs).toContain("[backup-stub]");
    }
  });

  it("reads provider order from definition config", async () => {
    const order: string[] = [];
    const def: NodeDefinition = {
      ...testDefinition,
      providers: [
        { id: "first", kind: "stub", stubTextTemplate: "a" },
        { id: "second", kind: "stub", stubTextTemplate: "b" },
      ],
    };

    const stub: ProviderExecutor<Record<string, never>, string> = async (config) => {
      order.push(config.id);
      if (config.id === "first") throw new Error("skip");
      return "second-win";
    };

    const result = await runProviderChain({
      definition: def,
      input: {},
      executors: { stub },
    });

    expect(order).toEqual(["first", "second"]);
    expect(result.providerUsed).toBe("second");
  });
});
