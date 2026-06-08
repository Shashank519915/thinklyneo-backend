/**
 * @fileoverview Agent-facing node catalog for the Thinkly MCP server.
 *
 * This module is READ-ONLY over the shared package (`@shashank519915/shared`). It never
 * mutates definitions and is deliberately kept out of the `shared` dist so that changing
 * how the MCP describes nodes can NEVER affect the Trigger.dev orchestrator or any live
 * workflow run (which import the built `shared` package directly).
 *
 * It turns each {@link NodeDefinition} into a JSON-serializable description the LLM can
 * reason about: exact port handle IDs, multi-tab grouping, defaults / ranges / options,
 * the precise output object shape, and the stub/fallback behavior of each node.
 *
 * Handle ID conventions (must match the orchestrator's `resolveInputsForNode`):
 *   - executable input port  → `in:<inputKey>`        (e.g. `in:prompt`)
 *   - executable output port → `out:<outputKey>`      (e.g. `out:response`)
 *   - Request-Inputs source  → raw field id           (e.g. `field_image_1`, no prefix)
 *   - Response target slot   → raw slot id            (e.g. `result`, no `in:` prefix)
 */

import { EXECUTABLE_NODE_DEFINITIONS } from "@shashank519915/shared";
import type {
  NodeDefinition,
  NodeParameter,
  NodeProviderConfig,
} from "@shashank519915/shared";
import { WORKFLOW_TEMPLATES, resolveWorkflowGraph } from "@/lib/workflow-templates";

/** Microcredits → human "0.21M" style string. */
function toMillions(microcredits: number): string {
  return `${(microcredits / 1_000_000).toFixed(2)}M`;
}

/**
 * The exact object shape stored in `NodeRun.output` for each node type, so the agent
 * wires downstream edges to the right key. Mirrors the orchestrator's `formatOutput`.
 * NOTE: `cropImage` stores a BARE STRING URL (not an object) — call it out explicitly.
 */
const OUTPUT_SHAPE_BY_TYPE: Record<string, string> = {
  cropImage: 'bare string URL (NOT wrapped in an object) — e.g. "https://.../crop.png"',
  gemini: "{ response: string }",
  openRouter: "{ response: string }",
  gptImage2: "{ result: string (image url) }",
  klingV3: "{ result: string (video url) }",
  mergeVideo: "{ outputVideo: string (video url) }",
  mergeAV: "{ video_url: string, outputVideo: string }",
  extractAudio: "{ outputAudio: string (audio url) }",
};

/**
 * Friendly labels for the `group` field, which the canvas renders as TABS / sections.
 * `image-mode` is the "image-to-X" tab (only relevant when you provide input images).
 */
const GROUP_LABELS: Record<string, string> = {
  primary: "Primary",
  "image-mode": "Image mode (image-to-image / image-to-video tab)",
  advanced: "Advanced",
  settings: "Settings",
};

const GROUP_ORDER: Record<string, number> = {
  primary: 0,
  "image-mode": 1,
  advanced: 2,
  settings: 3,
};

/** Target handles that AGGREGATE (array append) instead of last-write-wins on fan-in. */
const FAN_IN_HANDLES = new Set(["in:image_urls", "in:video_urls", "in:audio_urls"]);

/**
 * Human description of a node's execution / fallback behavior, derived from its provider
 * chain. Kling v3 and GPT Image 2 have no live provider in this environment and therefore
 * ALWAYS return canned demo media; FFmpeg/OpenRouter nodes run for real but fall back to a
 * stub asset/text if the primary provider fails or times out.
 */
function describeStubBehavior(def: NodeDefinition): string {
  const kinds = new Set(def.providers.map((p: NodeProviderConfig) => p.kind));
  const hasReal = kinds.has("openrouter") || kinds.has("ffmpeg");
  if (!hasReal) {
    return "STUB-ONLY: no live model in this environment — always returns a canned demo asset (webhook-sim then stub).";
  }
  if (kinds.has("openrouter")) {
    return "LIVE OpenRouter call when configured; falls back to a stub text response on failure/timeout.";
  }
  return "Runs real FFmpeg; falls back to a stub demo asset on failure/timeout.";
}

/** One input parameter → agent-facing port + control metadata. */
function describeInput(param: NodeParameter) {
  const handle = `in:${param.key}`;
  return {
    key: param.key,
    inputHandle: handle,
    label: param.label,
    control: param.type,
    tab: GROUP_LABELS[param.group] ?? param.group,
    group: param.group,
    required: param.required ?? false,
    default: param.defaultValue ?? null,
    ...(param.min !== undefined ? { min: param.min } : {}),
    ...(param.max !== undefined ? { max: param.max } : {}),
    ...(param.step !== undefined ? { step: param.step } : {}),
    ...(param.options ? { options: param.options.map((o) => o.value) } : {}),
    ...(param.placeholder ? { placeholder: param.placeholder } : {}),
    ...(param.tooltip ? { tooltip: param.tooltip } : {}),
    ...(param.uiVariant ? { uiVariant: param.uiVariant } : {}),
    ...(param.elementFields
      ? {
          elementFields: param.elementFields.map((f) => ({
            key: f.key,
            label: f.label,
            type: f.type,
            accept: f.accept,
            required: f.required ?? false,
            ...(f.maxCount ? { maxCount: f.maxCount } : {}),
          })),
        }
      : {}),
    ...(FAN_IN_HANDLES.has(handle)
      ? {
          fanIn:
            "AGGREGATES: multiple incoming edges to this handle are appended into an array. (All other handles are last-write-wins.)",
        }
      : {}),
  };
}

/** One output → agent-facing port metadata. */
function describeOutput(out: NodeDefinition["outputs"][number]) {
  return {
    key: out.key,
    outputHandle: `out:${out.key}`,
    label: out.label,
    type: out.type,
  };
}

/** Distinct tabs (groups) present on a node, ordered, for quick agent orientation. */
function describeTabs(def: NodeDefinition) {
  const groups = Array.from(new Set(def.inputs.map((i) => i.group)));
  groups.sort((a, b) => (GROUP_ORDER[a] ?? 99) - (GROUP_ORDER[b] ?? 99));
  return groups.map((g) => GROUP_LABELS[g] ?? g);
}

/**
 * Compact per-node summary for `list_node_types` — enough to pick a node and see its ports
 * without the full parameter schema. Call `get_model_schema(type)` for full input detail.
 */
export function buildNodeTypeSummary(def: NodeDefinition) {
  return {
    type: def.type,
    name: def.name,
    category: def.category,
    description: def.description ?? "",
    creditsBase: toMillions(def.credits.base),
    tabs: describeTabs(def),
    inputPorts: def.inputs.map((i) => ({
      handle: `in:${i.key}`,
      type: i.handle?.type ?? "text",
      label: i.label,
      required: i.required ?? false,
    })),
    outputPorts: def.outputs.map((o) => ({
      handle: `out:${o.key}`,
      type: o.type,
      label: o.label,
    })),
    outputShape: OUTPUT_SHAPE_BY_TYPE[def.type] ?? "(see get_model_schema)",
    behavior: describeStubBehavior(def),
  };
}

/** Full schema for one executable node — types, defaults, ranges, options, tabs, ports. */
export function buildModelSchema(type: string) {
  const def = EXECUTABLE_NODE_DEFINITIONS[type];
  if (!def) return null;
  return {
    type: def.type,
    name: def.name,
    category: def.category,
    description: def.description ?? "",
    credits: { base: def.credits.base, displayMillions: toMillions(def.credits.base) },
    tabs: describeTabs(def),
    inputs: def.inputs.map(describeInput),
    outputs: def.outputs.map(describeOutput),
    outputShape: OUTPUT_SHAPE_BY_TYPE[def.type] ?? "(unknown)",
    limits: def.limits ?? {},
    behavior: describeStubBehavior(def),
    requiredInputs: def.inputs.filter((i) => i.required).map((i) => i.key),
  };
}

/**
 * The two scaffold node types every workflow must keep. These are NOT in
 * EXECUTABLE_NODE_DEFINITIONS — they are described here so the agent understands the
 * graph endpoints and how their handles work.
 */
export function buildScaffoldNodeSummaries() {
  return [
    {
      type: "requestInputs",
      name: "Request-Inputs",
      category: "scaffold",
      description:
        "Entry node. Holds user-supplied run inputs as `fields`. Each field's SOURCE handle is its raw id (e.g. `field_image_1`) with NO `in:`/`out:` prefix. Run values are supplied at start_run time.",
      fieldTypes: [
        "text_field",
        "select_field",
        "number_field",
        "boolean_field",
        "image_field",
        "audio_field",
        "video_field",
        "media_field",
        "file_field",
      ],
      rules: "Exactly one per workflow. Cannot be deleted. Leave media field values null — the user uploads media later via upload_file, then update_node.",
    },
    {
      type: "response",
      name: "Response / Output",
      category: "scaffold",
      description:
        "Exit node. Collects final results into named slots. The default slot target handle is the raw slot id `result` (NO `in:` prefix). The run's primary result is read from here.",
      rules: "Exactly one per workflow. Cannot be deleted. Multiple edges into the same slot are last-write-wins (no aggregation).",
    },
  ];
}

/** All executable node summaries, optionally filtered by category. */
export function listNodeTypes(category?: string) {
  const executables = Object.values(EXECUTABLE_NODE_DEFINITIONS)
    .filter((def) => !category || def.category === category)
    .map(buildNodeTypeSummary);
  return {
    scaffoldNodes: buildScaffoldNodeSummaries(),
    executableNodes: executables,
    handleConventions: {
      executableInput: "in:<inputKey>",
      executableOutput: "out:<outputKey>",
      requestInputsSource: "<fieldId> (raw, e.g. field_image_1)",
      responseTarget: "result (raw, no in: prefix)",
      fanIn: "Only in:image_urls / in:video_urls / in:audio_urls aggregate multiple edges into an array; everything else is last-write-wins.",
    },
  };
}

/** Pre-built system workflow templates the agent can scaffold from (read-only). */
export function listSystemWorkflows() {
  return WORKFLOW_TEMPLATES.map((template) => {
    const graph = resolveWorkflowGraph({ template });
    const nodeTypes = (graph.nodes as Array<{ type: string }>).map((n) => n.type);
    return {
      template,
      nodeCount: graph.nodes.length,
      edgeCount: graph.edges.length,
      nodeTypes,
      description:
        template === "advertisement"
          ? "Marketing pipeline: crop product images + LLM copywriting → hook → final social post. Pass productBrief when creating."
          : "Blank canvas: Request-Inputs + Response only.",
    };
  });
}
