/**
 * @fileoverview Trigger.dev `gpt-image-2`: async image generation with config-driven webhook fallback.
 *
 * Provider order: gptImage2Definition.providers (gpt-image-webhook -> backup-stub)
 */

import { task } from "@trigger.dev/sdk/v3";
import { gptImage2Definition } from "@galaxy/shared";
import {
  executeStubProvider,
  executeWebhookSimProvider,
} from "./executors";
import { runNodeTaskWithProviders } from "./task-coordination";

interface GptImage2Payload {
  prompt: string;
  negativePrompt?: string;
  aspectRatio?: "1:1" | "16:9" | "9:16";
  runId: string;
  nodeRunId: string;
  orchestratorRunId?: string;
  waitpointTokenId?: string;
  workflowId?: string;
}

export const gptImage2Task = task({
  id: "gpt-image-2",
  maxDuration: 120,
  run: async (payload: GptImage2Payload) => {
    const {
      prompt,
      negativePrompt,
      aspectRatio = "1:1",
      runId,
      nodeRunId,
      orchestratorRunId,
      waitpointTokenId,
      workflowId,
    } = payload;

    console.log(
      `[GptImage2Task] Starting gpt-image-2 (nodeRunId: ${nodeRunId}, aspectRatio: ${aspectRatio}, negativePrompt: "${negativePrompt ?? ""}")`
    );

    return runNodeTaskWithProviders({
      taskLabel: "GptImage2Task",
      definition: gptImage2Definition,
      coordination: { runId, nodeRunId, orchestratorRunId, waitpointTokenId, workflowId },
      input: { prompt },
      executors: {
        "webhook-sim": executeWebhookSimProvider,
        stub: executeStubProvider,
      },
      formatOutput: (outputUrl) => ({ result: outputUrl }),
      formatReturn: (outputUrl) => ({ result: outputUrl }),
    });
  },
});
