/**
 * Shared executors for config-driven provider kinds.
 */

import { wait, tasks } from "@trigger.dev/sdk/v3";
import type { NodeProviderConfig } from "@shashank519915/shared";
import type { ProviderExecutorContext } from "../provider-chain";

export interface OpenRouterExecutorInput {
  prompt: string;
  model?: string;
  systemPrompt?: string | null;
  images?: string[];
  temperature?: number;
  maxTokens?: number;
  topP?: number;
}

function resolveOpenRouterModel(config: NodeProviderConfig, input: OpenRouterExecutorInput): string {
  if (config.model) {
    return config.model;
  }
  if (input.model === "gemini-2.5-flash") {
    return "google/gemini-2.5-flash";
  }
  if (input.model) {
    return input.model;
  }
  return "meta-llama/llama-3.3-70b-instruct:free";
}

export async function executeOpenRouterProvider(
  config: NodeProviderConfig,
  input: OpenRouterExecutorInput,
  ctx: ProviderExecutorContext
): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY environment variable is not configured on backend");
  }

  const targetModel = resolveOpenRouterModel(config, input);
  ctx.appendLog(`[${config.id}] Invoking OpenRouter model: ${targetModel}`);

  const messages: Array<Record<string, unknown>> = [];

  if (input.systemPrompt && input.systemPrompt.trim()) {
    messages.push({ role: "system", content: input.systemPrompt });
  }

  const userContent: Array<Record<string, unknown>> = [{ type: "text", text: input.prompt }];

  if (input.images && input.images.length > 0) {
    for (const imgUrl of input.images) {
      if (imgUrl) {
        userContent.push({
          type: "image_url",
          image_url: { url: imgUrl },
        });
      }
    }
  }

  messages.push({ role: "user", content: userContent });

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://nextflow-workflow.vercel.app",
      "X-Title": "NextFlow Workflow Builder",
    },
    body: JSON.stringify({
      model: targetModel,
      messages,
      temperature: input.temperature ?? 1.0,
      max_tokens: input.maxTokens ?? 2048,
      top_p: input.topP ?? 0.95,
    }),
    signal: ctx.signal,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenRouter API error ${response.status}: ${errorText}`);
  }

  const result = await response.json();
  const choice = result.choices?.[0];
  if (!choice?.message?.content) {
    throw new Error("Empty response or unexpected format from OpenRouter API");
  }

  return choice.message.content;
}

export async function executeStubProvider(
  config: NodeProviderConfig,
  input: unknown,
  ctx: ProviderExecutorContext
): Promise<string> {
  ctx.appendLog(`[${config.id}] Attempting fallback stub...`);

  if (config.stubDelaySeconds && config.stubDelaySeconds > 0) {
    await wait.for({ seconds: config.stubDelaySeconds });
  }

  if (config.stubUrl) {
    ctx.appendLog(`[${config.id}] Success: Fallback generated canned URL: ${config.stubUrl}`);
    return config.stubUrl;
  }

  if (config.stubTextTemplate) {
    const prompt =
      typeof input === "object" && input !== null && "prompt" in input
        ? String((input as { prompt?: unknown }).prompt ?? "")
        : "";
    const text = config.stubTextTemplate.replace(/\{\{prompt\}\}/g, prompt);
    ctx.appendLog(`[${config.id}] Success: Fallback generated canned response.`);
    return text;
  }

  throw new Error(`Stub provider "${config.id}" missing stubUrl or stubTextTemplate`);
}

export async function executeWebhookSimProvider(
  config: NodeProviderConfig,
  input: { prompt?: string },
  ctx: ProviderExecutorContext
): Promise<string> {
  const nodeType = config.nodeType;
  if (!nodeType) {
    throw new Error(`Webhook-sim provider "${config.id}" missing nodeType`);
  }

  const delaySeconds = config.delaySeconds ?? 10;
  const tokenTimeout = config.tokenTimeout ?? "5m";

  ctx.appendLog(`[${config.id}] Creating waitpoint token for callback...`);
  const token = await wait.createToken({ timeout: tokenTimeout });
  ctx.appendLog(`[${config.id}] Token created: ${token.id}. Triggering callback simulation...`);

  await tasks.trigger("simulate-callback", {
    tokenId: token.id,
    nodeType,
    prompt: input.prompt ?? "",
    delaySeconds,
  });

  ctx.appendLog(`[${config.id}] Task suspended. Waiting for webhook callback simulation...`);
  const result = await wait.forToken<{ output: string }>(token.id);

  if (!result.ok) {
    throw result.error instanceof Error
      ? result.error
      : new Error(String(result.error ?? "Waitpoint token timed out or failed"));
  }

  const outputUrl = result.output.output;
  if (!outputUrl) {
    throw new Error("Callback simulation did not return an output URL");
  }

  ctx.appendLog(`[${config.id}] Success: Callback resumed task. Output URL: ${outputUrl}`);
  return outputUrl;
}
