/**
 * Shared coordination helpers for node Trigger tasks.
 */

import type { NodeDefinition, ProviderKind } from "@galaxy/shared";
import { notifyCoordinator } from "./utils";
import {
  ProviderChainExhaustedError,
  runProviderChain,
  type ProviderAttempt,
  type ProviderChainResult,
  type ProviderExecutor,
} from "./provider-chain";

export interface NodeTaskCoordination {
  runId: string;
  nodeRunId: string;
  orchestratorRunId?: string;
  waitpointTokenId?: string;
  workflowId?: string;
}

export function hasCoordination(ctx: NodeTaskCoordination): ctx is NodeTaskCoordination & {
  workflowId: string;
  orchestratorRunId: string;
  waitpointTokenId: string;
} {
  return Boolean(ctx.workflowId && ctx.orchestratorRunId && ctx.waitpointTokenId);
}

export async function notifyCoordinatorSuccess(
  ctx: NodeTaskCoordination,
  definition: NodeDefinition,
  chain: ProviderChainResult<unknown>,
  output: unknown,
  startedAtMs: number
): Promise<void> {
  if (!hasCoordination(ctx)) return;

  await notifyCoordinator({
    workflowId: ctx.workflowId,
    runId: ctx.runId,
    nodeId: ctx.nodeRunId,
    status: "success",
    output,
    durationMs: Date.now() - startedAtMs,
    orchestratorRunId: ctx.orchestratorRunId,
    waitpointTokenId: ctx.waitpointTokenId,
    providerUsed: chain.providerUsed,
    providerAttempts: chain.providerAttempts,
    logs: chain.logs,
    creditCost: definition.credits.base,
  });
}

export async function notifyCoordinatorFailure(
  ctx: NodeTaskCoordination,
  error: string,
  startedAtMs: number,
  providerAttempts: ProviderAttempt[],
  logs: string
): Promise<void> {
  if (!hasCoordination(ctx)) return;

  await notifyCoordinator({
    workflowId: ctx.workflowId,
    runId: ctx.runId,
    nodeId: ctx.nodeRunId,
    status: "failed",
    error,
    durationMs: Date.now() - startedAtMs,
    orchestratorRunId: ctx.orchestratorRunId,
    waitpointTokenId: ctx.waitpointTokenId,
    providerUsed: null,
    providerAttempts,
    logs,
    creditCost: 0,
  });
}

export async function runNodeTaskWithProviders<TInput, TOutput>(params: {
  taskLabel: string;
  definition: NodeDefinition;
  coordination: NodeTaskCoordination;
  input: TInput;
  executors: Partial<Record<ProviderKind, ProviderExecutor<TInput, TOutput>>>;
  formatOutput: (output: TOutput) => unknown;
  formatReturn: (output: TOutput) => Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const { taskLabel, definition, coordination, input, executors, formatOutput, formatReturn } =
    params;
  const startedAtMs = Date.now();

  try {
    const chain = await runProviderChain<TInput, TOutput>({
      definition,
      input,
      executors,
    });

    const formatted = formatOutput(chain.output);
    await notifyCoordinatorSuccess(coordination, definition, chain, formatted, startedAtMs);

    return {
      ...formatReturn(chain.output),
      runId: coordination.runId,
      nodeRunId: coordination.nodeRunId,
    };
  } catch (err: unknown) {
    const fatalMsg = err instanceof Error ? err.message : String(err);
    console.error(`[${taskLabel}] Fatal error: ${fatalMsg}`);

    const attempts =
      err instanceof ProviderChainExhaustedError ? err.providerAttempts : [];
    const logs =
      err instanceof ProviderChainExhaustedError
        ? err.logs
        : `[FATAL] ${fatalMsg}`;

    try {
      await notifyCoordinatorFailure(coordination, fatalMsg, startedAtMs, attempts, logs);
    } catch (notifyErr) {
      console.error(`[${taskLabel}] Failed to notify coordinator after error:`, notifyErr);
    }

    throw err;
  }
}
