/**
 * Provider fallback configuration - single source of truth per node definition.
 * Work trial Req 7: provider order defined in config, not hardcoded in tasks.
 */

export type ProviderKind = "openrouter" | "webhook-sim" | "ffmpeg" | "stub";

export interface NodeProviderConfig {
  /** Stable identifier logged in providerAttempts (e.g. main-openrouter, backup-stub) */
  id: string;
  kind: ProviderKind;
  /** Per-provider timeout in seconds (API calls). Omitted for ffmpeg/webhook-sim/stub. */
  timeoutSeconds?: number;
  /** Retries for this provider before advancing to the next (default: definition.retryPerProvider or 1) */
  retryPerProvider?: number;

  /** openrouter: OpenRouter model slug */
  model?: string;

  /** webhook-sim: async callback simulation via wait.forToken */
  nodeType?: "gptImage2" | "klingV3";
  delaySeconds?: number;
  /** Trigger.dev wait.createToken timeout (e.g. "5m") */
  tokenTimeout?: string;

  /** stub: canned fallback output */
  stubDelaySeconds?: number;
  stubUrl?: string;
  /** Text stub; use {{prompt}} placeholder for prompt interpolation */
  stubTextTemplate?: string;
}
