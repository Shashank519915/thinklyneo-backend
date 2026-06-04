/**
 * @fileoverview Trigger.dev `gpt-image-2`: async image generation with config-driven webhook fallback.
 *
 * Provider order: gptImage2Definition.providers (gpt-image-webhook -> backup-stub)
 */

import { task } from "@trigger.dev/sdk/v3";
import { gptImage2Definition } from "@shashank519915/shared";
import {
  executeStubProvider,
  executeWebhookSimProvider,
} from "./executors";
import { runNodeTaskWithProviders } from "./task-coordination";

interface GptImage2Payload {
  prompt: string;
  uploadedImages?: string[];
  size?: string;
  quality?: "high" | "medium" | "low";
  n?: string;
  background?: string;
  output_format?: string;
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
      uploadedImages,
      size,
      quality,
      n,
      background,
      output_format,
      runId,
      nodeRunId,
      orchestratorRunId,
      waitpointTokenId,
      workflowId,
    } = payload;

    const mode = uploadedImages && uploadedImages.length > 0 ? "image-to-image" : "text-to-image";

    console.log(
      `[GptImage2Task] Starting gpt-image-2 (nodeRunId: ${nodeRunId}, mode: ${mode}, ` +
      `size: ${size ?? "auto"}, quality: ${quality ?? "high"}, n: ${n ?? "1"}, ` +
      `images: ${uploadedImages?.length ?? 0})`
    );

    return runNodeTaskWithProviders({
      taskLabel: "GptImage2Task",
      definition: gptImage2Definition,
      coordination: { runId, nodeRunId, orchestratorRunId, waitpointTokenId, workflowId },
      input: { prompt, uploadedImages, size, quality, n, background, output_format },
      executors: {
        "webhook-sim": executeWebhookSimProvider,
        stub: executeStubProvider,
      },
      formatOutput: (outputUrl) => ({ result: outputUrl }),
      formatReturn: (outputUrl) => ({ result: outputUrl }),
    });
  },
});
