/**
 * @fileoverview Trigger.dev `gemini-inference`: OpenRouter completions with config-driven fallback.
 *
 * Provider order: geminiDefinition.providers (main-openrouter -> backup-stub)
 */

import { task } from "@trigger.dev/sdk/v3";
import { geminiDefinition } from "@galaxy/shared";
import {
  executeOpenRouterProvider,
  executeStubProvider,
} from "./executors";
import { runNodeTaskWithProviders } from "./task-coordination";

interface GeminiPayload {
  model: string;
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

export const geminiTask = task({
  id: "gemini-inference",
  maxDuration: 120,
  run: async (payload: GeminiPayload) => {
    const {
      model,
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

    console.log(`[GeminiTask] Starting gemini-inference (nodeRunId: ${nodeRunId})`);

    return runNodeTaskWithProviders({
      taskLabel: "GeminiTask",
      definition: geminiDefinition,
      coordination: { runId, nodeRunId, orchestratorRunId, waitpointTokenId, workflowId },
      input: { model, prompt, systemPrompt, images, temperature, maxTokens, topP },
      executors: {
        openrouter: executeOpenRouterProvider,
        stub: executeStubProvider,
      },
      formatOutput: (responseText) => ({ response: responseText }),
      formatReturn: (responseText) => ({ response: responseText }),
    });
  },
});
