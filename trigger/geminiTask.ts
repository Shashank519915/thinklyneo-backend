/**
 * @fileoverview Trigger.dev `gemini-inference`: OpenRouter completions with config-driven fallback.
 *
 * Provider order: geminiDefinition.providers (main-openrouter -> backup-stub)
 */

import { task } from "@trigger.dev/sdk/v3";
import { geminiDefinition } from "@shashank519915/shared";
import {
  executeOpenRouterProvider,
  executeStubProvider,
} from "./executors";
import { runNodeTaskWithProviders } from "./task-coordination";

interface GeminiPayload {
  model: string;
  prompt: string;
  systemPrompt?: string;
  /** Legacy: single image list (pre-1.0.12) */
  images?: string[];
  /** New: image array field */
  image_urls?: string[];
  video_urls?: string[];
  audio_urls?: string[];
  temperature?: number;
  maxTokens?: number;
  reasoning?: boolean;
  topP?: number;
  topK?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  repetitionPenalty?: number;
  minP?: number;
  topA?: number;
  seed?: number;
  stop?: string;
  response_format?: boolean;
  runId: string;
  nodeRunId: string;
  orchestratorRunId?: string;
  waitpointTokenId?: string;
  workflowId?: string;
}

export const geminiTask = task({
  id: "gemini-inference",
  maxDuration: 120,
  run: async (payload: GeminiPayload) => {
    const {
      model,
      prompt,
      systemPrompt,
      images = [],
      image_urls = [],
      video_urls = [],
      audio_urls = [],
      temperature = 1.0,
      maxTokens = 2048,
      reasoning,
      topP = 0.95,
      topK,
      frequencyPenalty,
      presencePenalty,
      repetitionPenalty,
      minP,
      topA,
      seed,
      stop,
      response_format,
      runId,
      nodeRunId,
      orchestratorRunId,
      waitpointTokenId,
      workflowId,
    } = payload;

    // Merge legacy `images` with new `image_urls` (deduplicated)
    const mergedImages = [...new Set([...images, ...image_urls])];

    console.log(`[GeminiTask] Starting gemini-inference (nodeRunId: ${nodeRunId})`);

    return runNodeTaskWithProviders({
      taskLabel: "GeminiTask",
      definition: geminiDefinition,
      coordination: { runId, nodeRunId, orchestratorRunId, waitpointTokenId, workflowId },
      input: {
        model,
        prompt,
        systemPrompt,
        images: mergedImages,
        video_urls,
        audio_urls,
        temperature,
        maxTokens,
        reasoning,
        topP,
        topK,
        frequencyPenalty,
        presencePenalty,
        repetitionPenalty,
        minP,
        topA,
        seed,
        stop,
        response_format,
      },
      executors: {
        openrouter: executeOpenRouterProvider,
        stub: executeStubProvider,
      },
      formatOutput: (responseText) => ({ response: responseText }),
      formatReturn: (responseText) => ({ response: responseText }),
    });
  },
});
