/**
 * @fileoverview Trigger.dev `openrouter-inference`: OpenRouter completions with config-driven fallback.
 *
 * Provider order: openrouterLlmDefinition.providers (main-openrouter -> backup-stub)
 */

import { task } from "@trigger.dev/sdk/v3";
import { openrouterLlmDefinition } from "@shashank519915/shared";
import {
  executeOpenRouterProvider,
  executeStubProvider,
} from "./executors";
import { runNodeTaskWithProviders } from "./task-coordination";

interface OpenRouterPayload {
  model?: string;
  prompt: string;
  systemPrompt?: string;
  images?: string[];
  video_urls?: string[];
  audio_urls?: string[];
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  topK?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  repetitionPenalty?: number;
  minP?: number;
  topA?: number;
  seed?: number;
  reasoning?: boolean;
  stop?: string;
  response_format?: boolean;
  runId: string;
  nodeRunId: string;
  orchestratorRunId?: string;
  waitpointTokenId?: string;
  workflowId?: string;
}

export const openrouterTask = task({
  id: "openrouter-inference",
  maxDuration: 120,
  run: async (payload: OpenRouterPayload) => {
    const {
      prompt,
      systemPrompt,
      images = [],
      video_urls = [],
      audio_urls = [],
      temperature = 0.5,
      maxTokens = 1024,
      topP = 1,
      topK,
      frequencyPenalty,
      presencePenalty,
      repetitionPenalty,
      minP,
      topA,
      seed,
      reasoning,
      stop,
      response_format,
      runId,
      nodeRunId,
      orchestratorRunId,
      waitpointTokenId,
      workflowId,
    } = payload;

    console.log(`[OpenRouterTask] Starting openrouter-inference (nodeRunId: ${nodeRunId})`);

    return runNodeTaskWithProviders({
      taskLabel: "OpenRouterTask",
      definition: openrouterLlmDefinition,
      coordination: { runId, nodeRunId, orchestratorRunId, waitpointTokenId, workflowId },
      input: {
        prompt,
        systemPrompt,
        images,
        video_urls,
        audio_urls,
        temperature,
        maxTokens,
        topP,
        topK,
        frequencyPenalty,
        presencePenalty,
        repetitionPenalty,
        minP,
        topA,
        seed,
        reasoning,
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
