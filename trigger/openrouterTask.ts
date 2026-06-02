/**
 * @fileoverview Trigger.dev `openrouter-inference`: OpenRouter completions with config-driven fallback.
 *
 * Provider order: openrouterLlmDefinition.providers (main-openrouter -> backup-stub)
 */

import { task } from "@trigger.dev/sdk/v3";
import { openrouterLlmDefinition } from "@galaxy/shared";
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
  temperature?: number;
  maxTokens?: number;
  topP?: number;
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
      temperature = 1.0,
      maxTokens = 2048,
      topP = 0.95,
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
      input: { prompt, systemPrompt, images, temperature, maxTokens, topP },
      executors: {
        openrouter: executeOpenRouterProvider,
        stub: executeStubProvider,
      },
      formatOutput: (responseText) => ({ response: responseText }),
      formatReturn: (responseText) => ({ response: responseText }),
    });
  },
});
