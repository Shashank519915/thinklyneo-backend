/**
 * @fileoverview Trigger.dev `gemini-inference`: fetches inbound image URLs → base64 `inlineData`, then `generateContent` text response.
 */

import { task } from "@trigger.dev/sdk/v3";
import { GoogleGenerativeAI, type Part } from "@google/generative-ai";
import { notifyCoordinator } from "./utils";

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

/** Server-safe Gemini invocation used by `/api/execute/gemini` via `tasks.trigger`; failures on individual downloads are skipped silently. */
export const geminiTask = task({
  id: "gemini-inference",
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
    const startMs = Date.now();

    try {
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

      const geminiModel = genAI.getGenerativeModel({
        model: model ?? "gemini-2.5-flash",
        systemInstruction: systemPrompt ?? undefined,
        generationConfig: {
          temperature,
          maxOutputTokens: maxTokens,
          topP,
        },
      });

      const parts: Part[] = [];

      // Add images for vision if provided
      if (images.length > 0) {
        for (const imageUrl of images) {
          if (!imageUrl) continue;
          try {
            // Fetch image and convert to base64
            const response = await fetch(imageUrl);
            if (!response.ok) continue;
            const buffer = await response.arrayBuffer();
            const base64 = Buffer.from(buffer).toString("base64");
            const mimeType =
              response.headers.get("content-type") ?? "image/jpeg";
            parts.push({
              inlineData: {
                data: base64,
                mimeType,
              },
            });
          } catch {
            // Skip failed images
          }
        }
      }

      // Add text prompt
      parts.push({ text: prompt });

      const result = await geminiModel.generateContent(parts);
      const responseText = result.response.text();

      const durationMs = Date.now() - startMs;

      // Notify the coordinator if coordination fields are provided
      if (workflowId && orchestratorRunId && waitpointTokenId) {
        await notifyCoordinator({
          workflowId,
          runId,
          nodeId: nodeRunId,
          status: "success",
          output: responseText,
          durationMs,
          orchestratorRunId,
          waitpointTokenId,
        });
      }

      return {
        response: responseText,
        runId,
        nodeRunId,
      };
    } catch (err) {
      const durationMs = Date.now() - startMs;
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[GeminiTask] ❌ Task failed:`, errorMsg);

      if (workflowId && orchestratorRunId && waitpointTokenId) {
        await notifyCoordinator({
          workflowId,
          runId,
          nodeId: nodeRunId,
          status: "failed",
          error: errorMsg,
          durationMs,
          orchestratorRunId,
          waitpointTokenId,
        });
      }

      throw err;
    }
  },
});
