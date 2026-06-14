/**
 * Shared Thinkly MCP tool manifest and server instructions.
 * Keep in sync across hosted HTTP (`app/api/mcp/route.ts`) and StdIO scripts.
 */

export const MCP_SERVER_INSTRUCTIONS = `Thinkly MCP server — build and run AI media workflows on the Thinkly canvas platform (https://thinklyneo.vercel.app).

When the user mentions Thinkly, workflows, runs, nodes, or credits, ALWAYS use these MCP tools. Do NOT create local files, READMEs, or search the web as a substitute.

═══ PICK THE RIGHT PATH ═══
1) Reusable multi-step pipeline the user wants to save → BUILD: create_workflow → add_node/connect_nodes → start_run.
2) Run an existing or template workflow → start_run (matches user workflows first, then system templates by fuzzy name).
3) Quick single generation (one image/video/LLM reply) → still goes through a tiny workflow under the hood; prefer the simplest build or a system template.

═══ HOW TO BUILD CORRECTLY (read before adding nodes) ═══
- Discover first: list_node_types (8 executable nodes + the two scaffold nodes) and get_model_schema(type) for exact inputs, defaults, ranges, tabs, and the OUTPUT SHAPE of each node.
- Every workflow MUST keep exactly one requestInputs node and one response node. They cannot be deleted.
- Handle ID rules (used by connect_nodes and the engine):
  • executable input port  = "in:<inputKey>"   (e.g. in:prompt, in:image_urls)
  • executable output port = "out:<outputKey>" (e.g. out:response, out:result, out:outputImage)
  • Request-Inputs source  = the raw field id  (e.g. field_image_1 — NO prefix)
  • Response target        = "result" (drop zone — auto-creates a res_* slot) or an existing slot id (NO in: prefix)
- connect_nodes to Response with targetHandle "result" auto-creates a visible result slot (mirrors canvas drop zone). disconnect_nodes removes auto-created res_* slots.
- get_model_schema returns exact defaults, min/max/step, and options as { label, value } for every dropdown/slider. Use those values in update_node or in requestFields.selectOptions — do not guess enum strings. It also returns selectInputsExactValues and wiringNotes per node type.
- connect_nodes from Request-Inputs → a node input sets field.linkedTarget (canvas “Add to request” parity) and syncs the field value onto the target. disconnect_nodes clears linkedTarget when that edge is removed.
- Request-Inputs select values must match the TARGET input key exactly: klingV3 uses in:aspect_ratio (16:9|9:16|1:1); gptImage2 uses in:size (3840x2160|2160x3840|…). See list_node_types.wiringGuide.aspectRatioVsSize — use separate fields or map pixel sizes for GPT.
- Unwired request fields are OK (optional run-time context only — they do not affect execution).
- Prefer update_node defaults for node params the user does not need at run time. Wire fields you create to in:<key> handles when they should drive a node. select_field requires selectOptions or the canvas shows no dropdown.
- Output shapes differ per node — wire to the right key. Examples: LLMs output {response}; gptImage2/klingV3 output {result}; cropImage outputs a BARE STRING url; mergeVideo outputs {outputVideo}. Always confirm via get_model_schema.
- Fan-in: ONLY in:image_urls / in:video_urls / in:audio_urls aggregate multiple incoming edges into an array. Every other handle is last-write-wins, so do not wire two sources into one in:prompt expecting concatenation.

═══ MEDIA RULE (important) ═══
Never invent or auto-upload media. When a node or request field needs an image/video/audio file, LEAVE IT EMPTY (null). Tell the user to provide it; they (or you, on their explicit instruction) use upload_file to get a stable URL, then update_node to set it.

═══ EXECUTION & CREDITS ═══
- Check get_balance before expensive runs. start_run places a credit hold; results stream per-node.
- start_run returns runId (poll with get_run_status) AND orchestratorRunId (for Trigger.dev realtime in Thinkly UI — pin_live_run in Brain chat).
- Poll get_run_status(runId) until terminal. Default includes node outputs (set includeOutputs:false for slim). Thinkly UI also subscribes via orchestratorRunId + Trigger realtime.
- Note: Kling v3 and GPT Image 2 return demo/stub media (no live model in this environment); other nodes run for real and fall back to a stub asset only if the provider fails.`;

export const MCP_TOOLS = [
  {
    name: "list_node_types",
    description:
      "Discover the node types available on the Thinkly canvas. Returns the 8 executable nodes (with input/output port handle IDs, tabs, categories, credit cost, output shape, and stub behavior) plus the two scaffold nodes (requestInputs, response) and the handle-naming conventions. Call this BEFORE building or editing a workflow graph. Optionally filter by category.",
    inputSchema: {
      type: "object",
      properties: {
        category: {
          type: "string",
          enum: ["text", "image", "video", "audio", "utility"],
          description: "Optional category filter for executable nodes.",
        },
      },
    },
  },
  {
    name: "get_model_schema",
    description:
      "Get the full input parameter schema for one executable node type (e.g. openRouter, gptImage2, klingV3, cropImage, mergeVideo, mergeAV, extractAudio, gemini): every input's key, control type, default, min/max/step, options, required flag, which tab it belongs to, element sub-fields, limits, the exact OUTPUT SHAPE, and stub behavior. Call this before add_node/update_node with an unfamiliar node.",
    inputSchema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          description: "Executable node type from list_node_types (e.g. \"openRouter\").",
        },
      },
      required: ["type"],
    },
  },
  {
    name: "list_system_workflows",
    description:
      "Browse pre-built system workflow templates that create_workflow can scaffold from. Returns each template's id, node/edge counts, node types, and description. Use \"advertisement\" for marketing/ad/social pipelines (pass productBrief) or \"empty\" for a blank Request-Inputs + Response canvas.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_workflows",
    description:
      "List the authenticated user's Thinkly workflow canvases (metadata only: id, name, status, run count). Optional `search` filters by name (case-insensitive contains).",
    inputSchema: {
      type: "object",
      properties: {
        search: { type: "string", description: "Optional name filter (case-insensitive contains)." },
      },
    },
  },
  {
    name: "get_workflow",
    description:
      "Fetch the full nodes, edges, and metadata of a single Thinkly workflow by ID. Use when the user asks for workflow details or graph JSON.",
    inputSchema: {
      type: "object",
      properties: {
        workflowId: { type: "string", description: "Thinkly workflow ID from list_workflows." },
      },
      required: ["workflowId"],
    },
  },
  {
    name: "create_workflow",
    description:
      'Create a new workflow canvas on the Thinkly platform. ALWAYS call this when the user asks to create, add, or set up a workflow in Thinkly — do NOT build workflow files locally or search the web. Use template "advertisement" for ads/promotions/marketing (pre-built crop + LLM pipeline). Use template "empty" or omit for a blank canvas. Returns the new workflow id and full graph JSON.',
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Display name for the new Thinkly workflow (derive from the user's request).",
        },
        description: {
          type: "string",
          description: "Optional description of the workflow purpose (use the user's stated goal).",
        },
        template: {
          type: "string",
          enum: ["empty", "advertisement"],
          description:
            'Graph scaffold. "advertisement" = marketing pipeline (crop images + copy + social post). "empty" = Request-Inputs + Response only.',
        },
        productBrief: {
          type: "string",
          description:
            'Product/promotion details seeded into Request-Inputs (e.g. "T-shirt company: 20% off summer graphic tees, free shipping"). Used with template "advertisement".',
        },
        requestFields: {
          type: "array",
          description:
            'Optional Request-Inputs fields to seed (mostly for an empty canvas). Each: { type, label?, value?, id?, selectOptions?, numberMin?, numberMax?, numberStep?, mediaMaxCount? }. type is one of text_field/select_field/number_field/boolean_field/image_field/audio_field/video_field/media_field/file_field. select_field MUST include selectOptions: [{ label, value }] with EXACT value strings from get_model_schema for the target you will wire to (e.g. gptImage2 in:size → 3840x2160, NOT 16:9). Set text/select/number values; LEAVE media fields empty. Wire fields that should drive nodes via connect_nodes (sets linkedTarget); unwired fields are optional run-time context only.',
          items: { type: "object" },
        },
      },
      required: ["name"],
    },
  },
  {
    name: "update_workflow",
    description:
      "Update an existing Thinkly workflow's name, description, nodes, and/or edges. Prefer add_node / connect_nodes / update_node for graph edits — they validate handles, prevent cycles, and set correct edge rendering. Only pass raw nodes/edges arrays here when doing a full atomic graph replacement (e.g. migrating all fields at once). If you pass edges, each edge must include { id, source, sourceHandle, target, targetHandle } — rendering fields (type, markerEnd, data) are auto-filled server-side. Graph must keep requestInputs and response nodes.",
    inputSchema: {
      type: "object",
      properties: {
        workflowId: { type: "string", description: "Thinkly workflow ID to update." },
        name: { type: "string", description: "New display name." },
        description: { type: "string", description: "New description." },
        nodes: {
          type: "array",
          description: "Full nodes array (React Flow graph). Must include requestInputs and response.",
          items: { type: "object" },
        },
        edges: {
          type: "array",
          description: "Full edges array. Each edge needs { id, source, sourceHandle, target, targetHandle }. Do NOT use this to add individual edges — use connect_nodes instead, which validates handles and prevents cycles.",
          items: { type: "object" },
        },
      },
      required: ["workflowId"],
    },
  },
  {
    name: "delete_workflow",
    description:
      "Permanently delete a workflow by ID. This cannot be undone. Confirm with the user before deleting.",
    inputSchema: {
      type: "object",
      properties: { workflowId: { type: "string", description: "Workflow ID to delete." } },
      required: ["workflowId"],
    },
  },
  {
    name: "upload_file",
    description:
      "Upload an image/video/audio/file to permanent Thinkly storage and get a stable URL to use in node inputs. Provide exactly one of: url (a public URL to fetch), data_uri (data:<mime>;base64,...), or base64 (+ mime). Use the returned URL with update_node. Only call when the user has actually provided media — never invent files.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Public URL to fetch and store." },
        data_uri: { type: "string", description: "Data URI: data:<mime>;base64,<data>." },
        base64: { type: "string", description: "Raw base64 payload (requires mime)." },
        mime: { type: "string", description: "MIME type (required with base64)." },
        filename: { type: "string", description: "Optional filename." },
      },
    },
  },
  {
    name: "execute_tool",
    description:
      "One-shot single-model generation without hand-building a pipeline. Routes via tool_name: \"generate\". Provide input.type (a node type like gptImage2/klingV3/openRouter/cropImage/mergeVideo/extractAudio) plus that node's inputs (call get_model_schema first). Under the hood it builds a tiny Request→model→Response workflow, runs it, and returns a runId to poll with get_run_status. Leave media inputs as URLs the user provided (use upload_file first).",
    inputSchema: {
      type: "object",
      properties: {
        tool_name: { type: "string", enum: ["generate"], description: "Currently only \"generate\"." },
        input: {
          type: "object",
          description:
            "Generation input: { type: <nodeType>, ...nodeInputs }. e.g. { type: \"openRouter\", prompt: \"A haiku about Mars\" }.",
        },
      },
      required: ["input"],
    },
  },
  {
    name: "add_node",
    description:
      "Add one executable node to a workflow's canvas. Returns the new node id and its input/output port handles. Use column/row for layout (same column = parallel, stacked by row). Optionally seed text/number/select inputs; LEAVE media/file inputs empty (null) — the user uploads media later. Call get_model_schema(nodeType) first for valid input keys, defaults, and tabs.",
    inputSchema: {
      type: "object",
      properties: {
        workflowId: { type: "string", description: "Workflow to edit." },
        nodeType: {
          type: "string",
          description: "Executable node type from list_node_types (e.g. openRouter, gptImage2, cropImage).",
        },
        label: { type: "string", description: "Optional display label (defaults to the node name)." },
        column: { type: "number", description: "Optional layout column index (left→right pipeline stage)." },
        row: { type: "number", description: "Optional layout row index (parallel nodes in the same column)." },
        inputs: {
          type: "object",
          description:
            "Optional initial input values keyed by input key (NOT handle), e.g. { systemPrompt: \"...\", temperature: 0.7 }. Do not set media/file fields here.",
        },
      },
      required: ["workflowId", "nodeType"],
    },
  },
  {
    name: "update_node",
    description:
      "Update input values (and optionally label/position) on an existing node without removing it or its edges. Merges into the node's current inputs. Use this to set a media URL returned by upload_file, or to tweak prompts/settings.",
    inputSchema: {
      type: "object",
      properties: {
        workflowId: { type: "string", description: "Workflow to edit." },
        nodeId: { type: "string", description: "Node id (from add_node or get_workflow)." },
        inputs: {
          type: "object",
          description: "Partial map of input key → value to merge (e.g. { prompt: \"A red Ferrari\" }).",
        },
        label: { type: "string", description: "Optional new display label." },
        position: {
          type: "object",
          description: "Optional new canvas position { x, y }.",
          properties: { x: { type: "number" }, y: { type: "number" } },
        },
      },
      required: ["workflowId", "nodeId"],
    },
  },
  {
    name: "connect_nodes",
    description:
      "Create a validated edge between two nodes. Handle IDs: source output = out:<key> (or a Request-Inputs field id), target input = in:<key>, Response = \"result\" (auto-creates a res_* result slot on empty canvases — same as canvas drop zone) or an existing slot id. Validates type compatibility, prevents cycles, and enforces single-input on non-fan-in handles. Only in:image_urls/in:video_urls/in:audio_urls accept multiple incoming edges. When source is Request-Inputs, sets field.linkedTarget and syncs the field value to the target input (Add to request parity).",
    inputSchema: {
      type: "object",
      properties: {
        workflowId: { type: "string", description: "Workflow to edit." },
        source: { type: "string", description: "Source node id." },
        sourceHandle: {
          type: "string",
          description: "Source handle: out:<outputKey>, or a Request-Inputs field id like field_image_1.",
        },
        target: { type: "string", description: "Target node id." },
        targetHandle: {
          type: "string",
          description:
            'Target handle: in:<inputKey> for executable nodes, or "result" for Response (auto-creates res_* slot) / an existing Response slot id.',
        },
      },
      required: ["workflowId", "source", "sourceHandle", "target", "targetHandle"],
    },
  },
  {
    name: "disconnect_nodes",
    description:
      "Remove an edge by edgeId, or by source/target (optionally narrowed by sourceHandle/targetHandle). Disconnecting from Response removes auto-created res_* slots.",
    inputSchema: {
      type: "object",
      properties: {
        workflowId: { type: "string", description: "Workflow to edit." },
        edgeId: { type: "string", description: "Edge id to remove (preferred)." },
        source: { type: "string", description: "Source node id (if not using edgeId)." },
        target: { type: "string", description: "Target node id (if not using edgeId)." },
        sourceHandle: { type: "string", description: "Optional source handle to narrow the match." },
        targetHandle: { type: "string", description: "Optional target handle to narrow the match." },
      },
      required: ["workflowId"],
    },
  },
  {
    name: "delete_node",
    description:
      "Remove a node and all of its connected edges from a workflow. Cannot delete the scaffold nodes (requestInputs, response).",
    inputSchema: {
      type: "object",
      properties: {
        workflowId: { type: "string", description: "Workflow to edit." },
        nodeId: { type: "string", description: "Node id to delete." },
      },
      required: ["workflowId", "nodeId"],
    },
  },
  {
    name: "start_run",
    description:
      "Execute a Thinkly workflow. Provide workflowId OR workflowName (fuzzy-matched). Returns runId (for get_run_status) and orchestratorRunId (for realtime UI). REQUEST-FIELD DISCOVERY: if you call it WITHOUT inputValues and the workflow has Request-Inputs fields, it returns the field schema instead of running — call again with inputValues filled in. Deducts credits and runs in the background.",
    inputSchema: {
      type: "object",
      properties: {
        workflowId: { type: "string", description: "Thinkly workflow ID to execute." },
        workflowName: {
          type: "string",
          description: "Workflow name to fuzzy-match (used when workflowId is not given).",
        },
        inputValues: {
          type: "object",
          description:
            'Flat key→value map of Request-Inputs field IDs to values, e.g. { "field_text_1": "Summer sale" }. Omit entirely to discover required fields first.',
        },
        scope: {
          type: "string",
          enum: ["full", "partial", "single"],
          description: "Execution scope. Default \"full\". Use partial/single with nodeIds to run a subset.",
        },
        nodeIds: {
          type: "array",
          items: { type: "string" },
          description: "Target node ids for partial/single scope (their upstream deps run too).",
        },
      },
    },
  },
  {
    name: "get_run_status",
    description:
      "Poll the status and per-node results of a Thinkly workflow run. Call repeatedly until status is terminal. By default returns node outputs (parity with GET /api/v1/runs/:id). Set includeOutputs:false for slim hasOutput-only rows.",
    inputSchema: {
      type: "object",
      properties: {
        runId: { type: "string", description: "Run ID returned by start_run." },
        includeOutputs: {
          type: "boolean",
          description: "When false, nodeRuns omit output payloads (hasOutput only). Default true.",
        },
      },
      required: ["runId"],
    },
  },
  {
    name: "list_runs",
    description:
      "List the authenticated user's workflow runs (summary only). Optional filters: workflowId, status (running/success/failed/partial), search (by workflow name). Cursor pagination via cursor + limit (default 20, max 100).",
    inputSchema: {
      type: "object",
      properties: {
        workflowId: { type: "string", description: "Filter to one workflow's runs." },
        status: { type: "string", description: "Filter by run status." },
        search: { type: "string", description: "Filter by workflow name (case-insensitive contains)." },
        cursor: { type: "string", description: "Pagination cursor (a run id from a previous page)." },
        limit: { type: "number", description: "Page size (1–100, default 20)." },
      },
    },
  },
  {
    name: "cancel_run",
    description:
      "Cancel a running workflow run. Stops the orchestrator, marks the run 'canceled', and refunds the unused portion of the credit hold (you are only charged for nodes that already succeeded).",
    inputSchema: {
      type: "object",
      properties: {
        runId: { type: "string", description: "Run ID to cancel (must currently be running)." },
      },
      required: ["runId"],
    },
  },
  {
    name: "get_balance",
    description:
      "Check the current Thinkly microcredit balance for the authenticated user. Use when the user asks about credits or balance in Thinkly.",
    inputSchema: { type: "object", properties: {} },
  },
] as const;
