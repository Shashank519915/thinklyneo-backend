/**
 * Shared Galaxy MCP tool manifest and server instructions.
 * Keep in sync across hosted HTTP (`app/api/mcp/route.ts`) and StdIO scripts.
 */

export const MCP_SERVER_INSTRUCTIONS = `Galaxy MCP server — workflow automation on the Galaxy canvas platform (https://galaxy-temp-frontend.vercel.app).

When the user mentions Galaxy, workflows, runs, or credits in Galaxy, ALWAYS use these MCP tools. Do NOT create local files, READMEs, or search the web as a substitute.

Workflow creation: call create_workflow with name, description, and template derived from the user's request.
- For ads, promotions, marketing, or social posts: use template "advertisement" and set productBrief to the user's product/promo details (e.g. t-shirt company summer sale).
- For a blank canvas only: omit template or use template "empty".
After creation, use update_workflow to patch nodes/edges if you need custom graph edits.

Execution flow: list_workflows → start_run → poll get_run_status until success or failed. Check get_balance before expensive runs.`;

export const MCP_TOOLS = [
  {
    name: "list_workflows",
    description:
      "List all Galaxy workflow canvases for the authenticated user (metadata only: id, name, status). Use when the user asks to see their Galaxy workflows.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_workflow",
    description:
      "Fetch the full nodes, edges, and metadata of a single Galaxy workflow by ID. Use when the user asks for workflow details or graph JSON.",
    inputSchema: {
      type: "object",
      properties: {
        workflowId: { type: "string", description: "Galaxy workflow ID from list_workflows." },
      },
      required: ["workflowId"],
    },
  },
  {
    name: "create_workflow",
    description:
      'Create a new workflow canvas on the Galaxy platform. ALWAYS call this when the user asks to create, add, or set up a workflow in Galaxy — do NOT build workflow files locally or search the web. Use template "advertisement" for ads/promotions/marketing (pre-built crop + LLM pipeline). Use template "empty" or omit for a blank canvas. Returns the new workflow id and full graph JSON.',
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Display name for the new Galaxy workflow (derive from the user's request).",
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
      },
      required: ["name"],
    },
  },
  {
    name: "update_workflow",
    description:
      "Update an existing Galaxy workflow's name, description, nodes, and/or edges. Use after create_workflow to customize the graph, or to patch metadata. Graph must keep requestInputs and response nodes.",
    inputSchema: {
      type: "object",
      properties: {
        workflowId: { type: "string", description: "Galaxy workflow ID to update." },
        name: { type: "string", description: "New display name." },
        description: { type: "string", description: "New description." },
        nodes: {
          type: "array",
          description: "Full nodes array (React Flow graph). Must include requestInputs and response.",
          items: { type: "object" },
        },
        edges: {
          type: "array",
          description: "Full edges array connecting nodes.",
          items: { type: "object" },
        },
      },
      required: ["workflowId"],
    },
  },
  {
    name: "start_run",
    description:
      "Execute a Galaxy workflow. Deducts credits and runs in the background on Trigger.dev. Returns a runId to poll with get_run_status.",
    inputSchema: {
      type: "object",
      properties: {
        workflowId: { type: "string", description: "Galaxy workflow ID to execute." },
        inputValues: {
          type: "object",
          description:
            'Flat key→value map of Request-Inputs field IDs to their values. e.g. { "field_text_1": "Summer sale on graphic tees" } for advertisement template, or { "field_text_default": "Hello" } for empty template.',
        },
      },
      required: ["workflowId"],
    },
  },
  {
    name: "get_run_status",
    description:
      "Poll the status and per-node results of a Galaxy workflow run. Call repeatedly until status is 'success' or 'failed'.",
    inputSchema: {
      type: "object",
      properties: {
        runId: { type: "string", description: "Run ID returned by start_run." },
      },
      required: ["runId"],
    },
  },
  {
    name: "get_balance",
    description:
      "Check the current Galaxy microcredit balance for the authenticated user. Use when the user asks about credits or balance in Galaxy.",
    inputSchema: { type: "object", properties: {} },
  },
] as const;
