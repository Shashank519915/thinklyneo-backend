/**
 * @fileoverview Trigger.dev `gemini-inference`: Paired to OpenRouter completions.
 */

import { task } from "@trigger.dev/sdk/v3";
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

async function callOpenRouter(payload: {
  model: string;
  prompt: string;
  systemPrompt?: string | null;
  images?: string[];
  temperature?: number;
  maxTokens?: number;
  topP?: number;
}): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY environment variable is not configured on backend");
  }

  // Use free Llama-3.1-8b by default if model is unset or gemini-2.5-flash fallback is active
  const targetModel = payload.model && payload.model !== "gemini-2.5-flash"
    ? payload.model
    : "meta-llama/llama-3.1-8b-instruct:free";

  const messages: any[] = [];

  if (payload.systemPrompt && payload.systemPrompt.trim()) {
    messages.push({
      role: "system",
      content: payload.systemPrompt,
    });
  }

  const userContent: any[] = [{ type: "text", text: payload.prompt }];

  if (payload.images && payload.images.length > 0) {
    for (const imgUrl of payload.images) {
      if (imgUrl) {
        userContent.push({
          type: "image_url",
          image_url: {
            url: imgUrl,
          },
        });
      }
    }
  }

  messages.push({
    role: "user",
    content: userContent,
  });

  console.log(`[OpenRouter Task] Invoking model: ${targetModel}`);
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
      temperature: payload.temperature ?? 1.0,
      max_tokens: payload.maxTokens ?? 2048,
      top_p: payload.topP ?? 0.95,
    }),
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
      const responseText = await callOpenRouter({
        model,
        prompt,
        systemPrompt,
        images,
        temperature,
        maxTokens,
        topP,
      });

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
      console.error(`[GeminiTask] ❌ OpenRouter Task failed:`, errorMsg);

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
