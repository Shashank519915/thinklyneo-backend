/**
 * @fileoverview Trigger.dev `kling-v3`: async video generation with config-driven webhook fallback.
 *
 * Provider order: klingV3Definition.providers (kling-webhook -> backup-stub)
 */

import { task } from "@trigger.dev/sdk/v3";
import { klingV3Definition } from "@galaxy/shared";
import {
  executeStubProvider,
  executeWebhookSimProvider,
} from "./executors";
import { runNodeTaskWithProviders } from "./task-coordination";

interface KlingV3Payload {
  prompt: string;
  inputImage?: string;
  aspectRatio?: "16:9" | "9:16" | "1:1";
  duration?: "5s" | "10s";
  runId: string;
  nodeRunId: string;
  orchestratorRunId?: string;
  waitpointTokenId?: string;
  workflowId?: string;
}

export const klingV3Task = task({
  id: "kling-v3",
  maxDuration: 120,
  run: async (payload: KlingV3Payload) => {
    const {
      prompt,
      inputImage,
      aspectRatio = "16:9",
      duration = "5s",
      runId,
      nodeRunId,
      orchestratorRunId,
      waitpointTokenId,
      workflowId,
    } = payload;

    console.log(
      `[KlingV3Task] Starting kling-v3 (nodeRunId: ${nodeRunId}, aspectRatio: ${aspectRatio}, duration: ${duration}, inputImage: "${inputImage ?? ""}")`
    );

    return runNodeTaskWithProviders({
      taskLabel: "KlingV3Task",
      definition: klingV3Definition,
      coordination: { runId, nodeRunId, orchestratorRunId, waitpointTokenId, workflowId },
      input: { prompt },
      executors: {
        "webhook-sim": executeWebhookSimProvider,
        stub: executeStubProvider,
      },
      formatOutput: (outputUrl) => ({ outputVideo: outputUrl }),
      formatReturn: (outputUrl) => ({ outputVideo: outputUrl }),
    });
  },
});
