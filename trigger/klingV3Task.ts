/**
 * @fileoverview Trigger.dev `kling-v3`: async video generation with config-driven webhook fallback.
 *
 * Provider order: klingV3Definition.providers (kling-webhook -> backup-stub)
 */

import { task } from "@trigger.dev/sdk/v3";
import { klingV3Definition } from "@shashank519915/shared";
import {
  executeStubProvider,
  executeWebhookSimProvider,
} from "./executors";
import { runNodeTaskWithProviders } from "./task-coordination";

interface KlingV3Element {
  frontal_image_url: string;
  reference_image_urls?: string[];
  video_url?: string;
}

interface KlingV3Payload {
  // Text-to-video fields
  prompt?: string;
  aspect_ratio?: "16:9" | "9:16" | "1:1";
  // Image-to-video fields
  start_image_url?: string;
  description?: string;
  end_image_url?: string;
  elements?: KlingV3Element[];
  // Shared fields
  duration?: string;
  duration_text?: string;
  negative_prompt?: string;
  negative_prompt_text?: string;
  // Settings
  cfg_scale?: number;
  generate_audio?: boolean;
  // Coordination
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
      aspect_ratio = "16:9",
      start_image_url,
      description,
      end_image_url,
      elements,
      duration,
      duration_text,
      negative_prompt,
      negative_prompt_text,
      cfg_scale,
      generate_audio,
      runId,
      nodeRunId,
      orchestratorRunId,
      waitpointTokenId,
      workflowId,
    } = payload;

    // Determine effective prompt: image tab uses "description", text tab uses "prompt"
    const effectivePrompt = description || prompt || "";
    const isImageToVideo = !!(start_image_url || description);
    const finalDuration = duration || duration_text || "5";
    const finalNegativePrompt = negative_prompt || negative_prompt_text || undefined;

    console.log(
      `[KlingV3Task] Starting kling-v3 (nodeRunId: ${nodeRunId}, mode: ${isImageToVideo ? "image-to-video" : "text-to-video"}, ` +
      `aspect_ratio: ${aspect_ratio}, duration: ${finalDuration}s, ` +
      `start_image_url: "${start_image_url ?? ""}", elements: ${elements?.length ?? 0})`
    );

    return runNodeTaskWithProviders({
      taskLabel: "KlingV3Task",
      definition: klingV3Definition,
      coordination: { runId, nodeRunId, orchestratorRunId, waitpointTokenId, workflowId },
      input: {
        prompt: effectivePrompt,
        aspect_ratio,
        start_image_url,
        end_image_url,
        elements,
        duration: finalDuration,
        negative_prompt: finalNegativePrompt,
        cfg_scale,
        generate_audio,
      },
      executors: {
        "webhook-sim": executeWebhookSimProvider,
        stub: executeStubProvider,
      },
      // Output key matches klingV3Definition output key "result"
      formatOutput: (outputUrl) => ({ result: outputUrl }),
      formatReturn: (outputUrl) => ({ result: outputUrl }),
    });
  },
});
