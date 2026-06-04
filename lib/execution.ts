/**
 * @fileoverview Client-side DAG runner: validates edges, topo-sorts workloads, merges upstream outputs into
 * per-handle inputs (with Gemini vision fan-in), orchestrates sequential waves via memoised `scheduleNode`,
 * and fans out Trigger-backed HTTP calls (`/api/execute/crop-image`, `/api/execute/gemini`).
 */

import { type Node, type Edge } from "@xyflow/react";
import { getRunnableNodeIds } from "@shashank519915/shared";

/** Single node outcome appended to workflow history + surfaced in nested UI rows. */
export interface NodeRunResult {
  nodeId: string;
  nodeName: string;
  status: "success" | "failed" | "skipped";
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  inputs?: Record<string, unknown>;
  output?: unknown;
  error?: string;
}

/** Options bag passed into `executeDAG` from `/workflow/[id]` after run creation. */
export interface ExecutionContext {
  nodes: Node[];
  edges: Edge[];
  inputValues: Record<string, unknown>;
  scope: "full" | "partial" | "single";
  targetNodeIds?: string[];
  existingOutputs?: Record<string, unknown>;
  onNodeStart: (nodeId: string) => void;
  onNodeComplete: (nodeId: string, output: unknown) => void;
  onNodeError: (nodeId: string, error: string) => void;
  onComplete: (results: NodeRunResult[]) => void;
  executeTriggerNode?: (args: {
    task: "crop-image" | "gemini-inference" | "openrouter-inference";
    body: Record<string, unknown>;
  }) => Promise<{ output: unknown; error?: string }>;
}

/**
 * DFS cycle detection treating the workflow graph as directed from source → target.
 *
 * @param newEdge — When provided, probes whether adding this edge introduces a cycle.
 */
export function hasCycle(
  nodes: Node[],
  edges: Edge[],
  newEdge?: { source: string; target: string }
): boolean {
  const allEdges = newEdge ? [...edges, newEdge] : edges;
  const adjacency = new Map<string, string[]>();

  for (const n of nodes) {
    adjacency.set(n.id, []);
  }
  for (const e of allEdges) {
    const arr = adjacency.get(e.source) ?? [];
    arr.push(e.target);
    adjacency.set(e.source, arr);
  }

  const visited = new Set<string>();
  const inStack = new Set<string>();

  /** Recursive Tarjan-ish colouring: `inStack` tracks active recursion spine to spot back-edges. */
  function dfs(nodeId: string): boolean {
    if (inStack.has(nodeId)) return true;
    if (visited.has(nodeId)) return false;
    visited.add(nodeId);
    inStack.add(nodeId);
    for (const neighbor of adjacency.get(nodeId) ?? []) {
      if (dfs(neighbor)) return true;
    }
    inStack.delete(nodeId);
    return false;
  }

  for (const n of nodes) {
    if (!visited.has(n.id)) {
      if (dfs(n.id)) return true;
    }
  }
  return false;
}

/**
 * Public hook for `Canvas` `onConnect` — rejects cyclic graphs before committing an edge client-side.
 */
export function validateNewEdge(
  nodes: Node[],
  edges: Edge[],
  newEdge: { source: string; target: string }
): { valid: boolean; error?: string } {
  if (hasCycle(nodes, edges, newEdge)) {
    return { valid: false, error: "This connection would create a cycle." };
  }
  return { valid: true };
}

/**
 * Coarse datatype tag used for Palette validation / React Flow rejection UX.
 *
 * NOTE: Gemini vision uses `image` upstream into `in:images` regardless of MIME subtype.
 *
 * @param handleId — React Flow handle id (may encode field type prefixes).
 * @param nodeType — React Flow registered node discriminator.
 */
function getHandleDataType(
  handleId: string | null | undefined,
  nodeType: string | undefined
): string {
  if (!handleId) return "generic";

  // Response node result handle
  if (handleId === "result") return "response";

  // Request-Inputs fields
  if (handleId.startsWith("field_")) {
    if (handleId.includes("image")) return "image";
    if (handleId.includes("video")) return "video";
    if (handleId.includes("audio")) return "audio";
    if (handleId.includes("media")) return "media";
    if (handleId.includes("file")) return "file";
    if (handleId.includes("number")) return "number";
    if (handleId.includes("boolean")) return "boolean";
    if (handleId.includes("text")) return "text";
    return "generic";
  }

  // Standard handle IDs
  if (
    handleId.includes("Image") ||
    handleId.includes("image") ||
    handleId === "in:inputImage" ||
    handleId === "out:outputImage" ||
    (handleId === "out:result" && nodeType === "gptImage2")
  )
    return "image";
  if (handleId === "in:images") return "image"; // gemini vision multi-input
  if (handleId === "in:video_urls") return "video"; // merge videos multi-input
  if (handleId === "in:audio_volume") return "number";
  if (handleId === "in:format") return "text";
  if (handleId.includes("Video") || handleId.includes("video")) return "video";
  if (handleId.includes("Audio") || handleId.includes("audio")) return "audio";
  if (handleId.includes("media") || handleId.includes("Media")) return "media";
  if (handleId.includes("file") || handleId.includes("File") || handleId === "in:file") return "file";
  if (handleId.includes("prompt") || handleId === "in:prompt" || handleId === "in:systemPrompt") return "text";
  if (handleId === "out:response") return "text";
  if (handleId.includes("x") || handleId.includes("y") || handleId.includes(":w") || handleId.includes(":h")) return "number";

  // Node type based fallback
  if (nodeType === "cropImage") return "image";
  if (nodeType === "gemini") return "text";
  if (nodeType === "openRouter") return "text";

  return "generic";
}

/**
 * Determines whether dropping a purple edge between two handles should succeed.
 *
 * @param sourceHandle — Upstream emitter id (`field_*`, `out:*`).
 * @param targetHandle — Downstream receptor id (`in:*`).
 */
export function isValidConnection(
  sourceHandle: string | null | undefined,
  targetHandle: string | null | undefined,
  sourceNodeType: string | undefined,
  targetNodeType: string | undefined
): boolean {
  const sourceType = getHandleDataType(sourceHandle, sourceNodeType);
  const targetType = getHandleDataType(targetHandle, targetNodeType);

  // Generic can connect to anything
  if (sourceType === "generic" || targetType === "generic") return true;

  // Response handle is special
  if (targetType === "response") return true;

  // Image fan-in for Gemini Vision
  if (targetHandle === "in:images" && sourceType === "image") return true;

  // Video fan-in for Merge Videos
  if (targetHandle === "in:video_urls" && sourceType === "video") return true;

  return sourceType === targetType;
}

/**
 * Kahn-style topological ordering for deterministic full-workflow execution sequencing.
 *
 * NOTE: Scheduling still parallelises via memoised promises per sibling wave.
 *
 * @param nodes — Candidate execution nodes.
 * @param edges — Edges restricting both nodes.
 */
function topologicalSort(nodes: Node[], edges: Edge[]): Node[] {
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  const nodeMap = new Map<string, Node>();

  for (const n of nodes) {
    inDegree.set(n.id, 0);
    adjacency.set(n.id, []);
    nodeMap.set(n.id, n);
  }

  for (const e of edges) {
    const arr = adjacency.get(e.source) ?? [];
    arr.push(e.target);
    adjacency.set(e.source, arr);
    inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const [id, degree] of inDegree.entries()) {
    if (degree === 0) queue.push(id);
  }

  const sorted: Node[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const node = nodeMap.get(id);
    if (node) sorted.push(node);
    for (const neighbor of adjacency.get(id) ?? []) {
      const newDegree = (inDegree.get(neighbor) ?? 0) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) queue.push(neighbor);
    }
  }

  return sorted;
}

/**
 * Serialises runtime behaviour for recognised node discriminators (`requestInputs`, `cropImage`, `gemini`, `response`).
 *
 * Each branch ultimately fans into Next route handlers responsible for Trigger orchestration/polling.
 *
 * @param node — Concrete React Flow record with `type` discriminator.
 * @param resolvedInputs — Output of `getResolvedInputsForNode` (includes wired + manual payloads).
 * @param runId — WorkflowRun id echoed into Trigger payloads for auditing.
 */
async function executeNode(
  node: Node,
  resolvedInputs: Record<string, unknown>,
  runId: string,
  ctx?: ExecutionContext
): Promise<{ output: unknown; error?: string }> {
  const type = node.type;

  if (type === "requestInputs") {
    // Just return the field values
    const data = node.data as { fields?: Array<{ id: string; value: unknown }> };
    const outputs: Record<string, unknown> = {};
    for (const f of data.fields ?? []) {
      outputs[f.id] = f.value;
    }
    return { output: outputs };
  }

  if (type === "response") {
    // Capture all incoming values. Since handles are dynamically generated (e.g., res_1234),
    // they exist in resolvedInputs as their direct IDs, or prefixed with 'in:' depending on getResolvedInputsForNode behavior.
    // getResolvedInputsForNode strips 'in:' for inputs, but since they are dynamically named, they might just be exactly the handle ID.
    // We will just return the whole resolvedInputs object (excluding anything not meant for it, but Response has no other inputs).
    return { output: resolvedInputs };
  }

  if (type === "cropImage") {
    let imageUrl = resolvedInputs["inputImage"] ?? null;
    if (typeof imageUrl === "string" && imageUrl.length > 0) {
      const split = imageUrl.split(",").map((s) => s.trim()).filter(Boolean);
      imageUrl = split[0] || null;
    }
    if (!imageUrl || typeof imageUrl !== "string") {
      return { output: null, error: "No image connected to Input Image handle" };
    }
    const body = {
      imageUrl,
      x: resolvedInputs["x"] ?? 0,
      y: resolvedInputs["y"] ?? 0,
      w: resolvedInputs["w"] ?? 100,
      h: resolvedInputs["h"] ?? 100,
      runId,
      nodeRunId: node.id,
    };
    if (ctx?.executeTriggerNode) {
      return ctx.executeTriggerNode({ task: "crop-image", body });
    }
    const resp = await fetch("/api/execute/crop-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: "Execution failed" }));
      return { output: null, error: err.error ?? "Crop image failed" };
    }
    const result = await resp.json();
    return { output: result.data?.outputUrl ?? null };
  }

  if (type === "gemini") {
    const data = node.data as {
      model?: string;
      inputs?: Record<string, unknown>;
    };
    const prompt = resolvedInputs["prompt"] ?? null;
    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
      return { output: null, error: "No prompt connected or prompt is empty" };
    }
    const collectGeminiUrls = (key: string, legacyKey?: string): string[] => {
      const raw =
        resolvedInputs[key] ??
        (legacyKey ? resolvedInputs[legacyKey] : undefined) ??
        data.inputs?.[key] ??
        (legacyKey ? data.inputs?.[legacyKey] : undefined);
      const out: string[] = [];
      const items = Array.isArray(raw) ? raw : raw ? [raw] : [];
      for (const item of items) {
        if (typeof item === "string" && item.length > 0) {
          out.push(...item.split(",").map((s) => s.trim()).filter(Boolean));
        }
      }
      return out;
    };
    const geminiInputs = data.inputs ?? {};
    const body = {
      model: data.model ?? "gemini-2.5-flash",
      prompt,
      systemPrompt: resolvedInputs["systemPrompt"] ?? geminiInputs.systemPrompt ?? null,
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
    };
    if (ctx?.executeTriggerNode) {
      return ctx.executeTriggerNode({ task: "gemini-inference", body });
    }
    const resp = await fetch("/api/execute/gemini", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: "Execution failed" }));
      return { output: null, error: err.error ?? "Gemini execution failed" };
    }
    const result = await resp.json();
    return { output: result.data?.response ?? null };
  }

  if (type === "openRouter") {
    const data = node.data as {
      inputs?: {
        systemPrompt?: string | null;
        temperature?: number;
        maxTokens?: number;
        topP?: number;
      };
    };
    const prompt = resolvedInputs["prompt"] ?? null;
    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
      return { output: null, error: "No prompt connected or prompt is empty" };
    }
    const collectUrls = (key: string, legacyKey?: string): string[] => {
      const raw =
        resolvedInputs[key] ??
        (legacyKey ? resolvedInputs[legacyKey] : undefined) ??
        data.inputs?.[key as keyof typeof data.inputs] ??
        (legacyKey ? data.inputs?.[legacyKey as keyof typeof data.inputs] : undefined);
      const out: string[] = [];
      const items = Array.isArray(raw) ? raw : raw ? [raw] : [];
      for (const item of items) {
        if (typeof item === "string" && item.length > 0) {
          out.push(...item.split(",").map((s) => s.trim()).filter(Boolean));
        }
      }
      return out;
    };
    const body = {
      prompt,
      systemPrompt: resolvedInputs["systemPrompt"] ?? data.inputs?.systemPrompt ?? null,
      images: collectUrls("image_urls", "images"),
      video_urls: collectUrls("video_urls", "video"),
      audio_urls: collectUrls("audio_urls", "audio"),
      temperature: data.inputs?.temperature ?? 0.5,
      maxTokens: data.inputs?.maxTokens ?? 1024,
      topP: data.inputs?.topP ?? 1,
      runId,
      nodeRunId: node.id,
    };
    if (ctx?.executeTriggerNode) {
      return ctx.executeTriggerNode({ task: "openrouter-inference", body });
    }
    const resp = await fetch("/api/execute/openrouter", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: "Execution failed" }));
      return { output: null, error: err.error ?? "OpenRouter execution failed" };
    }
    const result = await resp.json();
    return { output: result.data?.response ?? null };
  }

  return { output: null, error: `Unknown node type: ${type}` };
}

/**
 * Executes a (possibly scoped) subgraph, honouring parallelism between independent branches.
 *
 * Implementation detail: sibling nodes share `scheduleNode` promises so `Promise.all` fans out waves;
 * dependents await upstream completion implicitly via `deps` memoisation.
 *
 * @param ctx — Populated execution context (`inputValues.__runId` injects Postgres run key).
 */
export async function executeDAG(ctx: ExecutionContext): Promise<void> {
  const { nodes, edges, inputValues, scope, targetNodeIds, existingOutputs } = ctx;

  // Determine which nodes to execute
  let targetNodes: Node[];

  if (scope === "full") {
    const runnableIds = getRunnableNodeIds(
      nodes.map((n) => ({ id: n.id, type: n.type ?? "" })),
      edges.map((e) => ({ source: e.source, target: e.target }))
    );
    targetNodes = topologicalSort(
      nodes.filter((n) => runnableIds.has(n.id)),
      edges
    );
  } else if (scope === "single" && targetNodeIds?.length) {
    // Only the target node + its transitive deps not yet computed
    targetNodes = getNodeWithDeps(nodes, edges, targetNodeIds, existingOutputs ?? {});
  } else if (scope === "partial" && targetNodeIds?.length) {
    targetNodes = getNodeWithDeps(nodes, edges, targetNodeIds, existingOutputs ?? {});
  } else {
    targetNodes = topologicalSort(nodes, edges);
  }

  // Build adjacency and dependency count maps for execution
  const targetNodeIds_ = new Set(targetNodes.map((n) => n.id));
  const deps = new Map<string, Set<string>>(); // nodeId -> set of dependency nodeIds
  const dependents = new Map<string, Set<string>>(); // nodeId -> set of dependent nodeIds

  for (const n of targetNodes) {
    deps.set(n.id, new Set());
    dependents.set(n.id, new Set());
  }

  for (const edge of edges) {
    if (targetNodeIds_.has(edge.source) && targetNodeIds_.has(edge.target)) {
      deps.get(edge.target)?.add(edge.source);
      dependents.get(edge.source)?.add(edge.target);
    }
  }

  // Resolved outputs keyed by nodeId
  const resolvedOutputs: Map<string, unknown> = new Map();

  // Pre-populate with existing outputs and inputValues
  for (const [k, v] of Object.entries(existingOutputs ?? {})) {
    resolvedOutputs.set(k, v);
  }

  // Promise map: nodeId -> Promise<void>
  const nodePromises = new Map<string, Promise<void>>();

  const runId = ctx.inputValues["__runId"] as string ?? "local";
  const results: NodeRunResult[] = [];

  /** Merges static `node.data.inputs`, Request-Inputs overlays, edge fan-in, and Gemini vision arrays. */
  function getResolvedInputsForNode(node: Node): Record<string, unknown> {
    const inputs: Record<string, unknown> = {};

    // Copy manual values from node data (user-typed fields, default values)
    const data = node.data as Record<string, unknown>;
    if (data["inputs"] && typeof data["inputs"] === "object") {
      Object.assign(inputs, data["inputs"] as Record<string, unknown>);
    }
    if (data["fields"] && Array.isArray(data["fields"])) {
      for (const f of data["fields"] as Array<{ id: string; value: unknown }>) {
        inputs[f.id] = f.value;
      }
    }

    // For Request-Inputs: inject the run's inputValues (user-provided field values)
    if (node.type === "requestInputs") {
      for (const [k, v] of Object.entries(inputValues)) {
        if (k !== "__runId") inputs[k] = v;
      }
      return inputs;
    }

    // For all other nodes: resolve values only from connected upstream edges
    // Do NOT inject raw inputValues — that belongs only to Request-Inputs
    const incomingEdges = edges.filter((e) => e.target === node.id);
    for (const edge of incomingEdges) {
      const sourceOutput = resolvedOutputs.get(edge.source);
      if (sourceOutput === undefined) continue;

      const targetHandle = edge.targetHandle ?? "input";
      const sourceHandle = edge.sourceHandle ?? "";

      // The upstream node's output may be a plain value or an object of named outputs
      // For Request-Inputs, output is { field_text_1: "...", field_image_1: null }
      // We need to extract the specific field that this edge carries (by sourceHandle)
      let valueToPass: unknown = sourceOutput;
      if (
        sourceOutput !== null &&
        typeof sourceOutput === "object" &&
        !Array.isArray(sourceOutput) &&
        sourceHandle
      ) {
        // Extract the specific named output field (e.g. field_text_1, field_image_1)
        const obj = sourceOutput as Record<string, unknown>;
        const cleanHandle = sourceHandle.replace(/^out:/, "");
        if (cleanHandle in obj) {
          valueToPass = obj[cleanHandle];
        } else if (sourceHandle in obj) {
          valueToPass = obj[sourceHandle];
        }
      }

      // Handle multi-image fan-in for Gemini Vision
      if (targetHandle === "in:images") {
        const existingImages = (inputs["images"] as unknown[]) ?? [];
        // Only add non-null image values
        if (valueToPass !== null && valueToPass !== undefined) {
          inputs["images"] = [...existingImages, valueToPass];
        } else {
          inputs["images"] = existingImages;
        }
      } else if (targetHandle === "in:video_urls") {
        const existingVideos = (inputs["video_urls"] as unknown[]) ?? [];
        if (valueToPass !== null && valueToPass !== undefined) {
          inputs["video_urls"] = [...existingVideos, valueToPass];
        } else {
          inputs["video_urls"] = existingVideos;
        }
      } else {
        // Map handle ID to clean input key (strip "in:" prefix)
        const key = targetHandle.startsWith("in:") ? targetHandle.slice(3) : targetHandle;
        inputs[key] = valueToPass;
      }
    }

    return inputs;
  }

  /**
   * Memoised async runner per node id ensuring each dependency finishes before dependents start.
   * Failure paths still enqueue `NodeRunResult` rows with `failed` statuses for downstream history accuracy.
   */
  function scheduleNode(node: Node): Promise<void> {
    if (nodePromises.has(node.id)) return nodePromises.get(node.id)!;

    const depPromises = Array.from(deps.get(node.id) ?? []).map((depId) => {
      const depNode = targetNodes.find((n) => n.id === depId);
      if (!depNode) return Promise.resolve();
      return scheduleNode(depNode);
    });

    const promise = Promise.all(depPromises).then(async () => {
      // If output already exists (e.g. hydrated from database in a resumed run), skip executing
      if (resolvedOutputs.has(node.id)) {
        const cachedOutput = resolvedOutputs.get(node.id);
        const resolvedInputs = getResolvedInputsForNode(node);
        ctx.onNodeComplete(node.id, cachedOutput);
        results.push({
          nodeId: node.id,
          nodeName: (node.data as { label?: string }).label ?? node.id,
          status: "success",
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          durationMs: 0,
          inputs: resolvedInputs as Record<string, unknown>,
          output: cachedOutput,
        });
        return;
      }

      // Check if any upstream dependency failed or was skipped
      const upstreamDeps = Array.from(deps.get(node.id) ?? []);
      const hasFailedDep = upstreamDeps.some((depId) => {
        const depResult = results.find((r) => r.nodeId === depId);
        return depResult && (depResult.status === "failed" || depResult.status === "skipped");
      });

      if (hasFailedDep) {
        resolvedOutputs.set(node.id, null);
        ctx.onNodeComplete(node.id, null); // Or onNodeError? Complete with null allows UI to just stay dimmed
        results.push({
          nodeId: node.id,
          nodeName: (node.data as { label?: string }).label ?? node.id,
          status: "skipped",
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          durationMs: 0,
          inputs: getResolvedInputsForNode(node) as Record<string, unknown>,
          output: null,
          error: "Skipped due to upstream failure",
        });
        return;
      }

      const startedAt = new Date().toISOString();
      const startMs = Date.now();
      ctx.onNodeStart(node.id);

      const resolvedInputs = getResolvedInputsForNode(node);

      try {
        const { output, error } = await executeNode(node, resolvedInputs, runId, ctx);

        const finishedAt = new Date().toISOString();
        const durationMs = Date.now() - startMs;

        if (error) {
          ctx.onNodeError(node.id, error);
          resolvedOutputs.set(node.id, null);
          results.push({
            nodeId: node.id,
            nodeName: (node.data as { label?: string }).label ?? node.id,
            status: "failed",
            startedAt,
            finishedAt,
            durationMs,
            inputs: resolvedInputs as Record<string, unknown>,
            output: null,
            error,
          });
        } else {
          resolvedOutputs.set(node.id, output);
          ctx.onNodeComplete(node.id, output);
          results.push({
            nodeId: node.id,
            nodeName: (node.data as { label?: string }).label ?? node.id,
            status: "success",
            startedAt,
            finishedAt,
            durationMs,
            inputs: resolvedInputs as Record<string, unknown>,
            output,
          });
        }
      } catch (err) {
        const finishedAt = new Date().toISOString();
        const durationMs = Date.now() - startMs;
        const errorMsg = err instanceof Error ? err.message : String(err);
        ctx.onNodeError(node.id, errorMsg);
        resolvedOutputs.set(node.id, null);
        results.push({
          nodeId: node.id,
          nodeName: (node.data as { label?: string }).label ?? node.id,
          status: "failed",
          startedAt,
          finishedAt,
          durationMs,
          inputs: resolvedInputs as Record<string, unknown>,
          output: null,
          error: errorMsg,
        });
      }
    });

    nodePromises.set(node.id, promise);
    return promise;
  }

  // Schedule all target nodes (they will self-order via dependency chain)
  const allPromises = targetNodes.map((n) => scheduleNode(n));
  await Promise.allSettled(allPromises);

  ctx.onComplete(results);
}

/**
 * Builds execution frontier for selective runs — union of explicitly targeted ids plus any uncached transitive deps.
 * Cached outputs prune upstream work unless they're part of `forceRun` targets (assignment selective behaviour).
 *
 * @param nodes — Entire workflow graph snapshot.
 * @param edges — Full connectivity (filtering handled caller-side).
 * @param targetIds — Node ids clicked in marquee / contextual run UX.
 * @param existingOutputs — Prior `nodeOutputs` map from client store hydration.
 */
function getNodeWithDeps(
  nodes: Node[],
  edges: Edge[],
  targetIds: string[],
  existingOutputs: Record<string, unknown>
): Node[] {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const toExecute = new Set<string>();
  // Explicitly targeted nodes — always run regardless of cached output
  const forceRun = new Set(targetIds);

  /** Walks upstream recursively; honours cache short-circuit for non-target ancestry. */
  function collectDeps(id: string, isTarget: boolean) {
    if (toExecute.has(id)) return;
    // For deps (not targets): skip if already cached
    if (!isTarget && existingOutputs[id] !== undefined) return;
    toExecute.add(id);
    // Recurse into upstream dependencies
    for (const edge of edges) {
      if (edge.target === id) {
        collectDeps(edge.source, false);
      }
    }
  }

  for (const id of targetIds) {
    collectDeps(id, forceRun.has(id));
  }

  const selectedNodes = Array.from(toExecute)
    .map((id) => nodeMap.get(id))
    .filter((n): n is Node => n !== undefined);

  return topologicalSort(selectedNodes, edges);
}
