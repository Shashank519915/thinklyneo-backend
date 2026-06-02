/**
 * Generic provider fallback chain - reads provider order from NodeDefinition config.
 */

import type { NodeDefinition, NodeProviderConfig, ProviderKind } from "@galaxy/shared";
import { callWithDurableTimeout } from "./utils";

export interface ProviderAttempt {
  providerId: string;
  status: "success" | "failed";
  error?: string;
  durationMs: number;
}

export interface ProviderChainResult<TOutput> {
  output: TOutput;
  providerUsed: string;
  providerAttempts: ProviderAttempt[];
  logs: string;
}

export interface ProviderExecutorContext {
  appendLog: (line: string) => void;
  signal?: AbortSignal;
}

export type ProviderExecutor<TInput, TOutput> = (
  config: NodeProviderConfig,
  input: TInput,
  ctx: ProviderExecutorContext
) => Promise<TOutput>;

export interface RunProviderChainParams<TInput, TOutput> {
  definition: NodeDefinition;
  input: TInput;
  executors: Partial<Record<ProviderKind, ProviderExecutor<TInput, TOutput>>>;
}

function formatTimeoutError(seconds: number): string {
  return `Request timed out after ${seconds} seconds`;
}

function normalizeError(err: unknown, timeoutSeconds: number): string {
  if (err instanceof Error && err.name === "AbortError") {
    return formatTimeoutError(timeoutSeconds);
  }
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

/** Kinds that manage their own timing (no callWithDurableTimeout wrapper). */
const SELF_TIMED_KINDS = new Set<ProviderKind>(["webhook-sim", "ffmpeg", "stub"]);

/**
 * Iterates definition.providers in order. On failure, advances to the next provider.
 * Logs every attempt for history / diagnosability (Req 7 + Req 11).
 */
export async function runProviderChain<TInput, TOutput>(
  params: RunProviderChainParams<TInput, TOutput>
): Promise<ProviderChainResult<TOutput>> {
  const { definition, input, executors } = params;
  const providers = definition.providers;

  if (!providers || providers.length === 0) {
    throw new Error(`Node type "${definition.type}" has no providers configured`);
  }

  const attempts: ProviderAttempt[] = [];
  let logs = "";
  const appendLog = (line: string) => {
    logs += line.endsWith("\n") ? line : `${line}\n`;
  };

  const definitionDefaultTimeout = definition.defaultTimeoutSeconds ?? 15;
  const definitionRetries = definition.retryPerProvider ?? 1;

  const errors: string[] = [];

  for (const providerConfig of providers) {
    const executor = executors[providerConfig.kind];
    if (!executor) {
      throw new Error(
        `No executor registered for provider "${providerConfig.id}" (kind: ${providerConfig.kind}) on node "${definition.type}"`
      );
    }

    const retries = providerConfig.retryPerProvider ?? definitionRetries;
    const timeoutSeconds = providerConfig.timeoutSeconds ?? definitionDefaultTimeout;

    for (let retryIndex = 0; retryIndex < retries; retryIndex++) {
      const startedAt = Date.now();
      appendLog(
        `[${providerConfig.id}] Attempting provider${retries > 1 ? ` (try ${retryIndex + 1}/${retries})` : ""}...`
      );

      try {
        let output: TOutput;

        if (SELF_TIMED_KINDS.has(providerConfig.kind)) {
          output = await executor(providerConfig, input, { appendLog });
        } else {
          output = await callWithDurableTimeout(timeoutSeconds, (signal) =>
            executor(providerConfig, input, { appendLog, signal })
          );
        }

        const durationMs = Date.now() - startedAt;
        attempts.push({
          providerId: providerConfig.id,
          status: "success",
          durationMs,
        });
        appendLog(`[${providerConfig.id}] Success after ${durationMs}ms.`);

        return {
          output,
          providerUsed: providerConfig.id,
          providerAttempts: attempts,
          logs,
        };
      } catch (err: unknown) {
        const durationMs = Date.now() - startedAt;
        const errorMsg = normalizeError(err, timeoutSeconds);
        appendLog(`[${providerConfig.id}] Failure after ${durationMs}ms: ${errorMsg}`);
        attempts.push({
          providerId: providerConfig.id,
          status: "failed",
          error: errorMsg,
          durationMs,
        });
        errors.push(`${providerConfig.id}: ${errorMsg}`);

        if (retryIndex + 1 < retries) {
          appendLog(`[${providerConfig.id}] Retrying (${retryIndex + 2}/${retries})...`);
          continue;
        }
        break;
      }
    }
  }

  throw new ProviderChainExhaustedError(
    `All providers failed: ${errors.join(" -> ")}`,
    attempts,
    logs
  );
}

export class ProviderChainExhaustedError extends Error {
  readonly providerAttempts: ProviderAttempt[];
  readonly logs: string;

  constructor(message: string, providerAttempts: ProviderAttempt[], logs: string) {
    super(message);
    this.name = "ProviderChainExhaustedError";
    this.providerAttempts = providerAttempts;
    this.logs = logs;
  }
}
