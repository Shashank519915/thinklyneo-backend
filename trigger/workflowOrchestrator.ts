/**
 * @fileoverview Server-side DAG orchestrator: receives full workflow graph, topologically sorts nodes,
 * executes them via non-blocking trigger subtasks, and coordinates execution dynamically
 * using Trigger.dev Waitpoint Tokens. Live state is streamed via metadata for frontend SSE.
 */

import { task, metadata, logger, wait, tasks } from "@trigger.dev/sdk/v3";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { triggerOutboundWebhook } from "../lib/webhooks";
import {
  parseExtractAudioFormat,
  parseMergeVideoTransition,
  resolveActiveRunNodeIds,
  resolveMergeAVAudioUrl,
  resolveMergeAVAudioVolume,
  resolveMergeAVVideoUrl,
  resolveMergeVideoUrls,
} from "@shashank519915/shared";
import {
  topologicalSort,
  getNodeWithDeps,
  resolveInputsForNode,
  collectReadyPendingNodes,
  type SerializedNode,
  type SerializedEdge,
} from "./orchestrator-utils";
import { checkNextLayerWithinHold, reconcileWorkflowCredits, getRunHoldAmount } from "../lib/credits";

/** Returns the shared Prisma client singleton. */
function getPrisma() {
  return prisma;
}

/** Per-node state streamed to the frontend via metadata. */
interface NodeState {
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  output?: unknown;
  error?: string;
}

interface OrchestratorPayload {
  workflowId: string;
  runId: string;
  nodes: SerializedNode[];
  edges: SerializedEdge[];
  inputValues: Record<string, unknown>;
  scope?: "full" | "partial" | "single";
  targetNodeIds?: string[];
  existingOutputs?: Record<string, unknown>;

  // Coordination mode fields:
  nodeCompleted?: string;
  orchestratorRunId?: string;
  waitpointTokenId?: string;
}

/**
 * Executes an inline node synchronously (requestInputs and response).
 */
async function executeNodeServerInline(
  node: SerializedNode,
  resolvedInputs: Record<string, unknown>,
  runId: string
): Promise<{ output: unknown; error?: string }> {
  const type = node.type;

  if (type === "requestInputs") {
    const fields = (node.data["fields"] as Array<{ id: string; value: unknown }>) ?? [];
    const outputs: Record<string, unknown> = {};
    for (const f of fields) {
      outputs[f.id] = (resolvedInputs && resolvedInputs[f.id] !== undefined) ? resolvedInputs[f.id] : f.value;
    }
    return { output: outputs };
  }

  if (type === "response") {
    return { output: resolvedInputs };
  }

  return { output: null, error: `Unknown inline node type: ${type}` };
}

/**
 * Updates the root run's metadata directly using Trigger.dev's REST API.
 * This is used to bypass the limitation where context-based metadata.root.set()
 * fails to resolve the parent run ID in context-decoupled coordinator task runs.
 */
async function updateRootMetadata(
  orchestratorRunId: string,
  nodeStates: Record<string, NodeState>,
  finalStatus?: string
): Promise<void> {
  const apiUrl = process.env.TRIGGER_API_URL || "https://api.trigger.dev";
  const secretKey = process.env.TRIGGER_SECRET_KEY;
  if (!secretKey) {
    logger.error(`[Orchestrator] TRIGGER_SECRET_KEY not found in environment`);
    return;
  }

  const url = `${apiUrl}/api/v1/runs/${orchestratorRunId}/metadata`;
  try {
    const body: { metadata: { nodeStates: Record<string, NodeState>; finalStatus?: string } } = {
      metadata: {
        nodeStates,
      },
    };
    if (finalStatus) {
      body.metadata.finalStatus = finalStatus;
    }

    const response = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      logger.error(`[Orchestrator] Failed to update root metadata for run ${orchestratorRunId}: ${response.status} ${text}`);
    } else {
      logger.info(`[Orchestrator] Successfully updated root metadata via API for run ${orchestratorRunId}`);
    }
  } catch (err) {
    logger.error(`[Orchestrator] Error calling runs metadata API for run ${orchestratorRunId}: ${err}`);
  }
}


interface TriggerReadyNodesParams {
  workflowId: string;
  runId: string;
  nodes: SerializedNode[];
  edges: SerializedEdge[];
  sortedNodes: SerializedNode[];
  deps: Map<string, Set<string>>;
  nodeStates: Record<string, NodeState>;
  resolvedOutputs: Map<string, unknown>;
  inputValues: Record<string, unknown>;
  orchestratorRunId: string;
  waitpointTokenId: string;
}

/**
 * Skips pending nodes, reconciles credits, completes the waitpoint, and notifies the client.
 * Returns true when the run was aborted (caller must not dispatch further layers).
 */
async function finalizeRunCreditExhausted(params: {
  runId: string;
  workflowId: string;
  userId: string;
  orchestratorRunId: string;
  waitpointTokenId: string;
  nodeStates: Record<string, NodeState>;
  sortedNodes: SerializedNode[];
  message: string;
}): Promise<void> {
  const {
    runId,
    workflowId,
    userId,
    orchestratorRunId,
    waitpointTokenId,
    nodeStates,
    sortedNodes,
    message,
  } = params;

  const now = new Date();
  logger.warn(`[Orchestrator] Credit exhaustion abort for run ${runId}: ${message}`);

  for (const node of sortedNodes) {
    if (nodeStates[node.id]?.status !== "pending") continue;
    nodeStates[node.id] = { status: "skipped", error: message };
    await getPrisma().nodeRun.updateMany({
      where: { runId, nodeId: node.id, status: "pending" },
      data: {
        status: "skipped",
        finishedAt: now,
        durationMs: 0,
        error: message,
      },
    });
  }

  const nodeRuns = await getPrisma().nodeRun.findMany({ where: { runId } });
  const durationMs = nodeRuns.reduce((sum, r) => sum + (r.durationMs ?? 0), 0);
  const finalStatus = "failed";

  await getPrisma().workflowRun.update({
    where: { id: runId },
    data: { status: finalStatus, finishedAt: now, durationMs },
  });

  await getPrisma().workflow.update({
    where: { id: workflowId },
    data: { status: "idle" },
  });

  await triggerOutboundWebhook(
    runId,
    "run.failed",
    false,
    { status: finalStatus, durationMs, reason: "credit_exhaustion" },
    message
  );

  try {
    const holdAmount = await getRunHoldAmount(runId);
    const actualCost = nodeRuns.reduce((sum, r) => sum + (r.creditCost ?? 0), 0);
    await reconcileWorkflowCredits(userId, runId, actualCost, holdAmount);
    logger.info(
      `[Orchestrator] Credits reconciled after credit abort. Hold: ${holdAmount}, Actual: ${actualCost}`
    );
  } catch (creditErr) {
    logger.error(`[Orchestrator] Failed to reconcile after credit abort: ${creditErr}`);
  }

  await updateRootMetadata(orchestratorRunId, nodeStates, finalStatus);
  await wait.completeToken(waitpointTokenId, { finalStatus, reason: "credit_exhaustion" });
}

/**
 * Per-layer hold check before dispatching ready nodes. Aborts the run when the next layer
 * estimate exceeds remaining hold (hold minus successful node costs so far).
 */
async function ensureCreditBudgetBeforeLayer(params: {
  runId: string;
  workflowId: string;
  userId: string;
  sortedNodes: SerializedNode[];
  deps: Map<string, Set<string>>;
  nodeStates: Record<string, NodeState>;
  orchestratorRunId: string;
  waitpointTokenId: string;
}): Promise<boolean> {
  const ready = collectReadyPendingNodes(params.sortedNodes, params.deps, params.nodeStates);
  if (ready.length === 0) {
    return false;
  }

  const check = await checkNextLayerWithinHold(params.runId, ready);
  if (check.ok) {
    return false;
  }

  await finalizeRunCreditExhausted({
    runId: params.runId,
    workflowId: params.workflowId,
    userId: params.userId,
    orchestratorRunId: params.orchestratorRunId,
    waitpointTokenId: params.waitpointTokenId,
    nodeStates: params.nodeStates,
    sortedNodes: params.sortedNodes,
    message: check.message,
  });
  return true;
}

/**
 * Traverses the sorted nodes to find any pending node whose parent dependencies
 * are fully resolved, and triggers/executes them concurrently.
 */
async function triggerReadyNodes(params: TriggerReadyNodesParams) {
  const {
    workflowId,
    runId,
    nodes,
    edges,
    sortedNodes,
    deps,
    nodeStates,
    resolvedOutputs,
    inputValues,
    orchestratorRunId,
    waitpointTokenId,
  } = params;

  for (const node of sortedNodes) {
    const currentState = nodeStates[node.id];
    if (!currentState || currentState.status !== "pending") {
      continue;
    }

    // Check upstream dependencies in sortedNodes
    const upstreamDeps = deps.get(node.id) ?? new Set();
    let allParentsFinished = true;
    let hasFailedParent = false;

    for (const depId of upstreamDeps) {
      const depState = nodeStates[depId];
      if (!depState) {
        allParentsFinished = false;
        break;
      }
      if (depState.status === "pending" || depState.status === "running") {
        allParentsFinished = false;
        break;
      }
      if (depState.status === "failed" || depState.status === "skipped") {
        hasFailedParent = true;
      }
    }

    if (!allParentsFinished) {
      continue;
    }

    if (hasFailedParent) {
      logger.info(`[Orchestrator] Skipping node ${node.id} due to upstream failure/skip`);
      nodeStates[node.id] = { status: "skipped", error: "Skipped due to upstream failure" };

      const now = new Date();
      await getPrisma().nodeRun.update({
        where: { runId_nodeId: { runId, nodeId: node.id } },
        data: {
          status: "skipped",
          startedAt: now,
          finishedAt: now,
          durationMs: 0,
          error: "Skipped due to upstream failure",
        },
      });

      await updateRootMetadata(orchestratorRunId, nodeStates);

      // Trigger coordinator to evaluate downstream nodes of this skipped node
      await tasks.trigger("workflow-orchestrator", {
        workflowId,
        runId,
        nodeCompleted: node.id,
        orchestratorRunId,
        waitpointTokenId,
      });

      continue;
    }

    // Attempt atomic lock on node run record
    const updateResult = await getPrisma().nodeRun.updateMany({
      where: {
        runId,
        nodeId: node.id,
        status: "pending",
      },
      data: {
        status: "running",
        startedAt: new Date(),
      },
    });

    if (updateResult.count === 0) {
      logger.info(`[Orchestrator] Node ${node.id} lock acquisition skipped (already running/completed)`);
      continue;
    }

    logger.info(`[Orchestrator] Node ${node.id} locked successfully, preparing execution`);

    nodeStates[node.id] = { status: "running" };
    await updateRootMetadata(orchestratorRunId, nodeStates);

    // Resolve inputs
    const resolvedInputs = resolveInputsForNode(node, edges, resolvedOutputs, inputValues);

    // Save resolved inputs to DB NodeRun record
    await getPrisma().nodeRun.update({
      where: { runId_nodeId: { runId, nodeId: node.id } },
      data: {
        inputs: (resolvedInputs ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      },
    });

    // Execute inline or trigger background task
    if (node.type === "requestInputs" || node.type === "response") {
      logger.info(`[Orchestrator] Executing inline node ${node.id} (${node.type})`);
      const startMs = Date.now();
      try {
        const { output, error } = await executeNodeServerInline(node, resolvedInputs, runId);
        const durationMs = Date.now() - startMs;
        const terminalStatus = error ? "failed" : "success";

        logger.info(`[Orchestrator] Inline node ${node.id} finished with status ${terminalStatus} in ${durationMs}ms`);

        await getPrisma().nodeRun.update({
          where: { runId_nodeId: { runId, nodeId: node.id } },
          data: {
            status: terminalStatus,
            finishedAt: new Date(),
            durationMs,
            output: (output ?? Prisma.JsonNull) as Prisma.InputJsonValue,
            error: error ?? null,
          },
        });

        // Fire webhook notification for inline node completion
        await triggerOutboundWebhook(
          runId,
          "node.completed",
          terminalStatus === "success",
          {
            nodeId: node.id,
            status: terminalStatus,
            durationMs,
            output,
            creditCost: 0,
            providerUsed: "inline",
          },
          error ?? null
        );

        if (error) {
          nodeStates[node.id] = { status: "failed", error };
        } else {
          nodeStates[node.id] = { status: "completed", output };
          resolvedOutputs.set(node.id, output);
        }
        await updateRootMetadata(orchestratorRunId, nodeStates);

        // Self-trigger coordinator to continue DAG traversal
        await tasks.trigger("workflow-orchestrator", {
          workflowId,
          runId,
          nodeCompleted: node.id,
          orchestratorRunId,
          waitpointTokenId,
        });

      } catch (err) {
        const durationMs = Date.now() - startMs;
        const errorMsg = err instanceof Error ? err.message : String(err);
        logger.error(`[Orchestrator] Inline node ${node.id} crashed: ${errorMsg}`);

        await getPrisma().nodeRun.update({
          where: { runId_nodeId: { runId, nodeId: node.id } },
          data: {
            status: "failed",
            finishedAt: new Date(),
            durationMs,
            error: errorMsg,
          },
        });

        // Fire webhook notification for inline node crash
        await triggerOutboundWebhook(
          runId,
          "node.completed",
          false,
          {
            nodeId: node.id,
            status: "failed",
            durationMs,
            output: null,
            creditCost: 0,
            providerUsed: "inline",
          },
          errorMsg
        );

        nodeStates[node.id] = { status: "failed", error: errorMsg };
        await updateRootMetadata(orchestratorRunId, nodeStates);

        await tasks.trigger("workflow-orchestrator", {
          workflowId,
          runId,
          nodeCompleted: node.id,
          orchestratorRunId,
          waitpointTokenId,
        });
      }
    } else {
      // Trigger background task asynchronously
      logger.info(`[Orchestrator] Triggering background task for node ${node.id} (${node.type})`);

      if (node.type === "cropImage") {
        let imageUrl = (resolvedInputs["inputImage"] as string) || "";
        if (imageUrl) {
          const split = imageUrl.split(",").map((s) => s.trim()).filter(Boolean);
          imageUrl = split[0] || "";
        }

        await tasks.trigger("crop-image", {
          imageUrl,
          x: (resolvedInputs["x"] as number) ?? 0,
          y: (resolvedInputs["y"] as number) ?? 0,
          w: (resolvedInputs["w"] as number) ?? 100,
          h: (resolvedInputs["h"] as number) ?? 100,
          runId,
          nodeRunId: node.id,
          orchestratorRunId,
          waitpointTokenId,
          workflowId,
        });
      } else if (node.type === "gemini") {
        const collectGeminiUrls = (key: string, legacyKey?: string): string[] => {
          const raw =
            (resolvedInputs[key] as unknown) ??
            (legacyKey ? (resolvedInputs[legacyKey] as unknown) : undefined) ??
            (node.data as any).inputs?.[key] ??
            (legacyKey ? (node.data as any).inputs?.[legacyKey] : undefined);
          const out: string[] = [];
          const items = Array.isArray(raw) ? raw : raw ? [raw] : [];
          for (const item of items) {
            if (typeof item === "string" && item.length > 0) {
              out.push(...item.split(",").map((s: string) => s.trim()).filter(Boolean));
            }
          }
          return out;
        };

        const geminiInputs = (node.data as any).inputs ?? {};
        await tasks.trigger("gemini-inference", {
          model: (node.data as any).model ?? "gemini-2.5-flash",
          prompt: resolvedInputs["prompt"] ?? null,
          systemPrompt:
            (resolvedInputs["systemPrompt"] as string) ??
            geminiInputs.systemPrompt ??
            undefined,
          image_urls: collectGeminiUrls("image_urls", "images"),
          video_urls: collectGeminiUrls("video_urls", "video"),
          audio_urls: collectGeminiUrls("audio_urls", "audio"),
          temperature: geminiInputs.temperature ?? 1.0,
          maxTokens: geminiInputs.maxTokens ?? 2048,
          reasoning: geminiInputs.reasoning,
          topP: geminiInputs.topP ?? 0.95,
          topK: geminiInputs.topK,
          frequencyPenalty: geminiInputs.frequencyPenalty,
          presencePenalty: geminiInputs.presencePenalty,
          repetitionPenalty: geminiInputs.repetitionPenalty,
          minP: geminiInputs.minP,
          topA: geminiInputs.topA,
          seed: geminiInputs.seed,
          stop: geminiInputs.stop,
          response_format: geminiInputs.response_format,
          runId,
          nodeRunId: node.id,
          orchestratorRunId,
          waitpointTokenId,
          workflowId,
        });
      } else if (node.type === "openRouter") {
        const collectUrls = (key: string, legacyKey?: string): string[] => {
          const raw =
            (resolvedInputs[key] as unknown) ??
            (legacyKey ? (resolvedInputs[legacyKey] as unknown) : undefined) ??
            (node.data as any).inputs?.[key] ??
            (legacyKey ? (node.data as any).inputs?.[legacyKey] : undefined);
          const out: string[] = [];
          const items = Array.isArray(raw) ? raw : raw ? [raw] : [];
          for (const item of items) {
            if (typeof item === "string" && item.length > 0) {
              out.push(
                ...item.split(",").map((s) => s.trim()).filter(Boolean),
              );
            }
          }
          return out;
        };

        const inputs = (node.data as any).inputs ?? {};
        await tasks.trigger("openrouter-inference", {
          prompt: resolvedInputs["prompt"] ?? null,
          systemPrompt:
            (resolvedInputs["systemPrompt"] as string) ??
            inputs.systemPrompt ??
            undefined,
          images: collectUrls("image_urls", "images"),
          video_urls: collectUrls("video_urls", "video"),
          audio_urls: collectUrls("audio_urls", "audio"),
          temperature: inputs.temperature ?? 0.5,
          maxTokens: inputs.maxTokens ?? 1024,
          topP: inputs.topP ?? 1,
          topK: inputs.topK,
          frequencyPenalty: inputs.frequencyPenalty,
          presencePenalty: inputs.presencePenalty,
          repetitionPenalty: inputs.repetitionPenalty,
          minP: inputs.minP,
          topA: inputs.topA,
          seed: inputs.seed,
          reasoning: inputs.reasoning,
          stop: inputs.stop,
          response_format: inputs.response_format,
          runId,
          nodeRunId: node.id,
          orchestratorRunId,
          waitpointTokenId,
          workflowId,
        });
      } else if (node.type === "gptImage2") {
        await tasks.trigger("gpt-image-2", {
          prompt: (resolvedInputs["prompt"] as string) ?? "",
          uploadedImages: Array.isArray(resolvedInputs["uploadedImages"]) ? resolvedInputs["uploadedImages"] as string[] : undefined,
          size: (resolvedInputs["size"] as string) || undefined,
          quality: (resolvedInputs["quality"] as string) || undefined,
          n: (resolvedInputs["n"] as string) || undefined,
          background: (resolvedInputs["background"] as string) || undefined,
          output_format: (resolvedInputs["output_format"] as string) || undefined,
          runId,
          nodeRunId: node.id,
          orchestratorRunId,
          waitpointTokenId,
          workflowId,
        });
      } else if (node.type === "klingV3") {
        await tasks.trigger("kling-v3", {
          // Text-to-video
          prompt: (resolvedInputs["prompt"] as string) || undefined,
          aspect_ratio: (resolvedInputs["aspect_ratio"] as any) ?? "16:9",
          // Image-to-video
          start_image_url: (resolvedInputs["start_image_url"] as string) || undefined,
          description: (resolvedInputs["description"] as string) || undefined,
          end_image_url: (resolvedInputs["end_image_url"] as string) || undefined,
          elements: (resolvedInputs["elements"] as any) || undefined,
          // Shared
          duration: (resolvedInputs["duration"] as string) ?? "5",
          negative_prompt: (resolvedInputs["negative_prompt"] as string) || undefined,
          // Settings
          cfg_scale: resolvedInputs["cfg_scale"] != null ? Number(resolvedInputs["cfg_scale"]) : undefined,
          generate_audio: resolvedInputs["generate_audio"] != null ? Boolean(resolvedInputs["generate_audio"]) : undefined,
          runId,
          nodeRunId: node.id,
          orchestratorRunId,
          waitpointTokenId,
          workflowId,
        });
      } else if (node.type === "mergeVideo") {
        const videoUrls = resolveMergeVideoUrls(resolvedInputs);
        const transition = parseMergeVideoTransition(resolvedInputs["transition"]);
        await tasks.trigger("merge-video", {
          videoUrls,
          transition,
          runId,
          nodeRunId: node.id,
          orchestratorRunId,
          waitpointTokenId,
          workflowId,
        });
      } else if (node.type === "mergeAV") {
        await tasks.trigger("merge-av", {
          videoUrl: resolveMergeAVVideoUrl(resolvedInputs),
          audioUrl: resolveMergeAVAudioUrl(resolvedInputs),
          audioVolume: resolveMergeAVAudioVolume(resolvedInputs),
          runId,
          nodeRunId: node.id,
          orchestratorRunId,
          waitpointTokenId,
          workflowId,
        });
      } else if (node.type === "extractAudio") {
        await tasks.trigger("extract-audio", {
          videoUrl: (resolvedInputs["videoUrl"] as string) ?? "",
          format: parseExtractAudioFormat(resolvedInputs["format"]),
          runId,
          nodeRunId: node.id,
          orchestratorRunId,
          waitpointTokenId,
          workflowId,
        });
      } else {
        logger.error(`[Orchestrator] Unknown node type: ${node.type}`);
        await getPrisma().nodeRun.update({
          where: { runId_nodeId: { runId, nodeId: node.id } },
          data: {
            status: "failed",
            finishedAt: new Date(),
            durationMs: 0,
            error: `Unknown node type: ${node.type}`,
          },
        });
        nodeStates[node.id] = { status: "failed", error: `Unknown node type: ${node.type}` };
        await updateRootMetadata(orchestratorRunId, nodeStates);

        await tasks.trigger("workflow-orchestrator", {
          workflowId,
          runId,
          nodeCompleted: node.id,
          orchestratorRunId,
          waitpointTokenId,
        });
      }
    }
  }
}

/**
 * The main workflow orchestrator task. Under the new waitpoint architecture, this operates
 * in two modes:
 *
 * 1. Initial Mode (nodeCompleted is omitted): Sets up all NodeRun DB records as pending,
 *    mints a waitpoint token, triggers Level 0 task nodes, and suspends itself via waitpoint.
 * 2. Coordination Mode (nodeCompleted is present): Re-evaluates DAG state from DB records,
 *    triggers ready downstream tasks, and finishes by wake-up signal on waitpoint completion.
 */
export const workflowOrchestratorTask = task({
  id: "workflow-orchestrator",
  maxDuration: 600, // 10 minutes
  run: async (payload: OrchestratorPayload, { ctx }) => {
    const {
      workflowId,
      runId,
      nodes,
      edges,
      inputValues,
      scope,
      targetNodeIds,
      existingOutputs,
      nodeCompleted,
      orchestratorRunId,
      waitpointTokenId,
    } = payload;

    const currentRunId = ctx.run.id;
    const isCoordinatorMode = !!nodeCompleted;

    logger.info(`[Orchestrator] Run ID: ${currentRunId}. Mode: ${isCoordinatorMode ? "Coordinator" : "Initial"}`);

    if (!isCoordinatorMode) {
      // ───────────────────────────────────────────────────────────────────────
      // Mode 1: Initial Execution Mode
      // ───────────────────────────────────────────────────────────────────────
      logger.info(`[Orchestrator] Starting initial DAG execution for workflow ${workflowId}, run ${runId}`);
      
      let sortedNodes: SerializedNode[];
      const existingOutputsKeys = new Set(Object.keys(existingOutputs ?? {}));

      if (scope === "single" && targetNodeIds?.length) {
        sortedNodes = getNodeWithDeps(nodes, edges, targetNodeIds, existingOutputsKeys);
      } else if (scope === "partial" && targetNodeIds?.length) {
        sortedNodes = getNodeWithDeps(nodes, edges, targetNodeIds, existingOutputsKeys);
      } else {
        const runnableIds = resolveActiveRunNodeIds(nodes, edges, "full");
        sortedNodes = topologicalSort(
          nodes.filter((n) => runnableIds.has(n.id)),
          edges
        );
      }

      logger.info(`[Orchestrator] sortedNodes to execute: ${sortedNodes.map((n) => n.id).join(", ")}`);

      // We need to build dependency maps for sortedNodes
      const sortedNodeIds = new Set(sortedNodes.map((n) => n.id));
      const deps = new Map<string, Set<string>>();
      for (const n of sortedNodes) {
        deps.set(n.id, new Set());
      }
      for (const edge of edges) {
        if (sortedNodeIds.has(edge.source) && sortedNodeIds.has(edge.target)) {
          deps.get(edge.target)?.add(edge.source);
        }
      }

      // Initialize all nodes' states
      const nodeStates: Record<string, NodeState> = {};
      const resolvedOutputs = new Map<string, unknown>();

      // Populate already existing outputs (cache recovery)
      if (existingOutputs) {
        for (const [k, v] of Object.entries(existingOutputs)) {
          resolvedOutputs.set(k, v);
          nodeStates[k] = { status: "completed", output: v };
        }
      }

      // Check DB and setup pending states for non-completed nodes
      for (const node of sortedNodes) {
        if (nodeStates[node.id]) continue; // Already set by existingOutputs

        const existing = await getPrisma().nodeRun.findUnique({
          where: { runId_nodeId: { runId, nodeId: node.id } },
        });

        if (existing && (existing.status === "success" || existing.status === "failed")) {
          logger.info(`[Orchestrator] Node ${node.id} already completed in DB (crash recovery)`);
          if (existing.status === "success") {
            resolvedOutputs.set(node.id, existing.output);
            nodeStates[node.id] = { status: "completed", output: existing.output };
          } else {
            nodeStates[node.id] = { status: "failed", error: existing.error ?? "Failed" };
          }
        } else {
          // Initialize/upsert NodeRun to pending
          nodeStates[node.id] = { status: "pending" };
          await getPrisma().nodeRun.upsert({
            where: { runId_nodeId: { runId, nodeId: node.id } },
            create: {
              runId,
              nodeId: node.id,
              nodeName: (node.data["label"] as string) ?? node.id,
              status: "pending",
              startedAt: new Date(),
            },
            update: {
              status: "pending",
              startedAt: new Date(),
            },
          });
        }
      }

      // Mark all nodes in workflow graph NOT in sortedNodes as skipped
      const allNodeIds = new Set(nodes.map((n) => n.id));
      for (const nodeId of allNodeIds) {
        if (!sortedNodeIds.has(nodeId)) {
          nodeStates[nodeId] = { status: "skipped", error: "Not selected in this run scope" };
          await getPrisma().nodeRun.upsert({
            where: { runId_nodeId: { runId, nodeId } },
            create: {
              runId,
              nodeId,
              nodeName: (nodes.find((n) => n.id === nodeId)?.data["label"] as string) ?? nodeId,
              status: "skipped",
              startedAt: new Date(),
              finishedAt: new Date(),
              durationMs: 0,
              error: "Not selected in this run scope",
            },
            update: {
              status: "skipped",
              startedAt: new Date(),
              finishedAt: new Date(),
              durationMs: 0,
              error: "Not selected in this run scope",
            },
          });
        }
      }

      // Set initial metadata
      await metadata.set("nodeStates", nodeStates as any);

      // Create waitpoint token
      const token = await wait.createToken({ timeout: "1h" });
      const targetWaitpointTokenId = token.id;
      logger.info(`[Orchestrator] Created waitpoint token: ${targetWaitpointTokenId}`);

      const workflowRun = await getPrisma().workflowRun.findUnique({
        where: { id: runId },
        select: { userId: true },
      });
      if (!workflowRun) {
        throw new Error(`WorkflowRun ${runId} not found`);
      }

      const creditAborted = await ensureCreditBudgetBeforeLayer({
        runId,
        workflowId,
        userId: workflowRun.userId,
        sortedNodes,
        deps,
        nodeStates,
        orchestratorRunId: currentRunId,
        waitpointTokenId: targetWaitpointTokenId,
      });
      if (creditAborted) {
        await metadata.set("finalStatus", "failed");
        return { finalStatus: "failed" };
      }

      // Evaluate and trigger ready nodes
      await triggerReadyNodes({
        workflowId,
        runId,
        nodes,
        edges,
        sortedNodes,
        deps,
        nodeStates,
        resolvedOutputs,
        inputValues,
        orchestratorRunId: currentRunId,
        waitpointTokenId: targetWaitpointTokenId,
      });

      // Suspend parent container on waitpoint
      logger.info(`[Orchestrator] Suspending parent run ${currentRunId} on token ${targetWaitpointTokenId}`);
      const waitResult = await wait.forToken(targetWaitpointTokenId);
      logger.info(`[Orchestrator] Resumed parent run. Result:`, waitResult);

      // Read final status from metadata (set by coordinator mode)
      const finalStatus = await metadata.get("finalStatus") || "success";
      return { finalStatus };

    } else {
      // ───────────────────────────────────────────────────────────────────────
      // Mode 2: Coordinator Mode (triggered on node completion)
      // ───────────────────────────────────────────────────────────────────────
      const targetOrchestratorRunId = orchestratorRunId!;
      const targetWaitpointTokenId = waitpointTokenId!;

      logger.info(`[Coordinator] Processing completion of node ${nodeCompleted} for run ${runId}`);

      // Fetch the WorkflowRun and its Workflow
      const run = await getPrisma().workflowRun.findUnique({
        where: { id: runId },
        include: { workflow: true },
      });

      if (!run) {
        logger.error(`[Coordinator] Run ${runId} not found in DB`);
        return;
      }

      if (run.status !== "running") {
        logger.warn(`[Coordinator] Run ${runId} is already in terminal state: ${run.status}`);
        return;
      }

      const dbNodes = (run.workflow.nodes as unknown[] as SerializedNode[]) ?? [];
      const dbEdges = (run.workflow.edges as unknown[] as SerializedEdge[]) ?? [];

      // Load all NodeRuns for this run
      const nodeRuns = await getPrisma().nodeRun.findMany({
        where: { runId },
      });

      // Identify active node IDs
      const activeNodeIds = new Set(
        nodeRuns
          .filter((nr) => nr.error !== "Not selected in this run scope")
          .map((nr) => nr.nodeId)
      );

      const sortedNodes = topologicalSort(
        dbNodes.filter((n) => activeNodeIds.has(n.id)),
        dbEdges
      );

      const sortedNodeIds = new Set(sortedNodes.map((n) => n.id));
      const deps = new Map<string, Set<string>>();
      for (const n of sortedNodes) {
        deps.set(n.id, new Set());
      }
      for (const edge of dbEdges) {
        if (sortedNodeIds.has(edge.source) && sortedNodeIds.has(edge.target)) {
          deps.get(edge.target)?.add(edge.source);
        }
      }

      // Reconstruct resolved outputs and node states from DB
      const resolvedOutputs = new Map<string, unknown>();
      const nodeStates: Record<string, NodeState> = {};

      const statusMap: Record<string, NodeState["status"]> = {
        success: "completed",
        failed: "failed",
        skipped: "skipped",
        running: "running",
        pending: "pending"
      };

      for (const nr of nodeRuns) {
        nodeStates[nr.nodeId] = {
          status: statusMap[nr.status] || "pending",
          output: nr.output ?? undefined,
          error: nr.error ?? undefined,
        };
        if (nr.status === "success") {
          resolvedOutputs.set(nr.nodeId, nr.output);
        }
      }

      // Update the root run's metadata so the frontend gets the latest node run status immediately
      await updateRootMetadata(targetOrchestratorRunId, nodeStates);

      const creditAborted = await ensureCreditBudgetBeforeLayer({
        runId,
        workflowId: run.workflowId,
        userId: run.userId,
        sortedNodes,
        deps,
        nodeStates,
        orchestratorRunId: targetOrchestratorRunId,
        waitpointTokenId: targetWaitpointTokenId,
      });
      if (creditAborted) {
        return;
      }

      // Evaluate and trigger ready downstream nodes
      await triggerReadyNodes({
        workflowId: run.workflowId,
        runId,
        nodes: dbNodes,
        edges: dbEdges,
        sortedNodes,
        deps,
        nodeStates,
        resolvedOutputs,
        inputValues: (run.inputValues as Record<string, unknown>) ?? {},
        orchestratorRunId: targetOrchestratorRunId,
        waitpointTokenId: targetWaitpointTokenId,
      });

      // Check if all active sorted nodes are completed (DAG execution is done)
      const allCompleted = sortedNodes.every((node) => {
        const state = nodeStates[node.id];
        return state && (state.status === "completed" || state.status === "failed" || state.status === "skipped");
      });

      if (allCompleted) {
        // Reload all NodeRuns to get the absolute latest status (including inline nodes executed during triggerReadyNodes)
        const updatedNodeRuns = await getPrisma().nodeRun.findMany({
          where: { runId },
        });

        // Calculate final status using updatedNodeRuns
        const terminalRuns = updatedNodeRuns.filter((nr) => activeNodeIds.has(nr.nodeId));
        const allSuccess = terminalRuns.every((r) => r.status === "success" || r.status === "skipped");
        const allFailed = terminalRuns.every((r) => r.status === "failed" || r.status === "skipped");
        const finalStatus = allSuccess ? "success" : allFailed ? "failed" : "partial";

        logger.info(`[Coordinator] DAG execution complete. Final status: ${finalStatus}`);

        // Update WorkflowRun status
        const now = new Date();
        const durationMs = terminalRuns.reduce((sum, r) => sum + (r.durationMs ?? 0), 0);
        await getPrisma().workflowRun.update({
          where: { id: runId },
          data: {
            status: finalStatus,
            finishedAt: now,
            durationMs,
          },
        });

        // Trigger webhook delivery for run completion
        await triggerOutboundWebhook(
          runId,
          finalStatus === "success" ? "run.completed" : "run.failed",
          finalStatus === "success",
          {
            status: finalStatus,
            durationMs,
            outputs: Object.fromEntries(resolvedOutputs),
          },
          finalStatus === "failed" ? "Execution failed" : null
        );

        // Set workflow status back to idle
        await getPrisma().workflow.update({
          where: { id: run.workflowId },
          data: { status: "idle" },
        });

        // Reconcile credits
        try {
          const holdAmount = await getRunHoldAmount(runId);
          const actualCost = terminalRuns.reduce((sum, r) => sum + (r.creditCost ?? 0), 0);
          await reconcileWorkflowCredits(run.userId, runId, actualCost, holdAmount);
          logger.info(`[Coordinator] Credits reconciled for run ${runId}. Hold: ${holdAmount}, Actual: ${actualCost}`);
        } catch (creditErr) {
          logger.error(`[Coordinator] Failed to reconcile credits for run ${runId}: ${creditErr}`);
        }

        // Set finalStatus and finalized nodeStates on root run metadata
        await updateRootMetadata(targetOrchestratorRunId, nodeStates, finalStatus);

        // Wake up parent orchestrator task
        logger.info(`[Coordinator] Completing waitpoint token ${targetWaitpointTokenId} with status ${finalStatus}`);
        await wait.completeToken(targetWaitpointTokenId, { finalStatus });
      }
    }
  },
});
