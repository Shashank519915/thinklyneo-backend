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

/** Agent-facing notes when the same run-time concept maps to different input keys per node. */
const NODE_WIRING_NOTES: Record<string, string[]> = {
  klingV3: [
    "Aspect ratio input key is `aspect_ratio` (label: Aspect Ratio) — NOT `size`. Allowed values exactly: 16:9, 9:16, 1:1.",
    "Image-to-video workflows: wire run-time clip length to `in:duration` (image tab). Avoid also wiring `in:duration_text` (text tab duplicate).",
    "When start_image_url is wired the canvas shows the image tab; `in:aspect_ratio` still resolves at run time even though the control is on the text tab.",
  ],
  gptImage2: [
    "Output dimensions use input key `size` (label: Size) — NOT `aspect_ratio`. Copy exact `value` strings from this schema's size options.",
    "To drive size from Request-Inputs: create a select_field whose selectOptions use the same value strings as `size` (e.g. 3840x2160), then wire to `in:size`.",
    "Never wire 16:9 / 9:16 / 1:1 strings to `in:size` — they are invalid for this node.",
  ],
};

/** Suggested cross-node mapping when the user picks an aspect ratio at run time. */
export const ASPECT_TO_GPT_SIZE_MAPPING = [
  { aspectRatio: "16:9", gptSize: "3840x2160", gptSizeAlternatives: ["2048x1152", "1536x1024"] },
  { aspectRatio: "9:16", gptSize: "2160x3840", gptSizeAlternatives: ["1024x1536"] },
  { aspectRatio: "1:1", gptSize: "2048x2048", gptSizeAlternatives: ["1024x1024"] },
] as const;

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
    ...(param.options ? { options: param.options.map((o) => ({ label: o.label, value: o.value })) } : {}),
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
      description: i.tooltip ?? i.label,
    })),
    outputPorts: def.outputs.map((o) => ({
      handle: `out:${o.key}`,
      type: o.type,
      label: o.label,
      description: o.label,
    })),
    outputShape: OUTPUT_SHAPE_BY_TYPE[def.type] ?? "(see get_model_schema)",
    behavior: describeStubBehavior(def),
  };
}

/** Full schema for one executable node — types, defaults, ranges, options, tabs, ports. */
export function buildModelSchema(type: string) {
  const def = EXECUTABLE_NODE_DEFINITIONS[type];
  if (!def) return null;

  const selectInputs = def.inputs
    .filter((i) => i.options?.length)
    .map((i) => ({
      inputKey: i.key,
      inputHandle: `in:${i.key}`,
      label: i.label,
      options: i.options!.map((o) => ({ label: o.label, value: o.value })),
    }));

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
    ...(selectInputs.length > 0 ? { selectInputsExactValues: selectInputs } : {}),
    ...(NODE_WIRING_NOTES[type] ? { wiringNotes: NODE_WIRING_NOTES[type] } : {}),
    ...(type === "gptImage2"
      ? {
          aspectRatioCrosswalk: {
            note: "Kling uses aspect_ratio (16:9|9:16|1:1). GPT Image 2 uses size (pixel dimensions). Use separate request fields or map values.",
            suggestedMapping: ASPECT_TO_GPT_SIZE_MAPPING,
          },
        }
      : {}),
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
      selectFieldRules:
        "select_field REQUIRES selectOptions: [{ label, value }] copied EXACTLY from get_model_schema (selectInputsExactValues / inputs[].options). Values must match the target node's input key — e.g. gptImage2 `in:size` wants 3840x2160, NOT 16:9. Prefer update_node defaults for node params the user does not need at run time. Wire fields you create to in:<key> handles, OR leave unwired as optional run-time context (harmless).",
      fieldIdNamingRule:
        "CRITICAL: Field IDs are parsed by splitting on '_' — the segment immediately after 'field_' MUST be the exact field type keyword (image|video|audio|media|file|number|boolean|select|text). Examples: field_image_photo ✓, field_image_ref ✓, field_video_clip ✓, field_text_prompt ✓. NEVER use descriptive words as the second segment if they accidentally contain a type keyword — e.g. field_texture_1 is WRONG because it contains 'text' as a substring but the second segment is 'texture' not 'text', causing a type mismatch. Always use field_image_<suffix> for image_field, field_video_<suffix> for video_field, etc.",
      rules:
        "Exactly one per workflow. Cannot be deleted. Leave media field values null — the user uploads media later via upload_file, then update_node. connect_nodes from a field sets linkedTarget (canvas Add to request parity) and syncs the field value to the target input.",
    },
    {
      type: "response",
      name: "Response / Output",
      category: "scaffold",
      description:
        "Exit node. Collects final results into named slots in `data.results` (each `{ id, label, value }`). Connect with connect_nodes using targetHandle \"result\" — the server auto-creates a `res_*` slot (same as dropping on the canvas). Edges must target a slot id; the canvas renders one handle per slot.",
      rules:
        "Exactly one per workflow. Cannot be deleted. Multiple edges into the same slot are last-write-wins (no aggregation). disconnect_nodes removes auto-created res_* slots; pre-seeded \"result\" slots (advertisement template) are kept.",
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
      responseTarget:
        "result (drop zone on empty canvas — connect_nodes auto-creates a res_* slot) or an existing slot id (e.g. res_123_abc, or result on advertisement template)",
      fanIn: "Only in:image_urls / in:video_urls / in:audio_urls aggregate multiple edges into an array; everything else is last-write-wins.",
      requestFieldPromotion:
        "connect_nodes from Request-Inputs → executable node sets field.linkedTarget and syncs the value (same as canvas Add to request). disconnect_nodes clears linkedTarget when that edge is removed.",
    },
    wiringGuide: {
      alwaysCallGetModelSchema:
        "Before add_node/update_node/connect_nodes on selects, call get_model_schema(type) and copy exact option value strings.",
      requestFieldIdNaming:
        "CRITICAL — field IDs are type-detected by splitting on '_'. The segment right after 'field_' MUST be the exact type keyword. Use: field_image_<suffix> for image_field, field_video_<suffix> for video_field, field_audio_<suffix> for audio_field, field_text_<suffix> for text_field, field_select_<suffix> for select_field, etc. NEVER use a descriptive noun as the second segment (e.g. field_texture_1, field_photo_1, field_subject_1 are all WRONG for image fields — use field_image_texture_1, field_image_photo_1, field_image_subject_1 instead). Wrong IDs cause type-mismatch errors when connecting to image/video/audio inputs.",
      optionalContextFields:
        "Unwired request fields (e.g. Photography Style) are fine — they appear at start_run for user context and do not affect execution unless wired.",
      aspectRatioVsSize: {
        klingV3: { inputKey: "aspect_ratio", inputHandle: "in:aspect_ratio", values: ["16:9", "9:16", "1:1"] },
        gptImage2: {
          inputKey: "size",
          inputHandle: "in:size",
          note: "See get_model_schema(gptImage2).selectInputsExactValues for the full list.",
        },
        suggestedMapping: ASPECT_TO_GPT_SIZE_MAPPING,
        recommendation:
          "Use field_aspect_ratio → kling in:aspect_ratio AND a separate field (e.g. field_image_size) with gpt size selectOptions → gpt in:size. Do not reuse 16:9 strings for in:size.",
      },
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
