/**
 * @fileoverview HTTP-based Galaxy MCP server.
 *
 * This is the recommended way to use Galaxy from Cursor / Claude Desktop.
 * It proxies all tool calls to the hosted REST API — no database connection,
 * no local clone required. Just your API key.
 *
 * Usage (Cursor mcp.json):
 * {
 *   "mcpServers": {
 *     "galaxy": {
 *       "command": "npx",
 *       "args": ["tsx", "/absolute/path/to/mcp-server-http.ts"],
 *       "env": {
 *         "GALAXY_API_KEY": "gx_your_key_here",
 *         "GALAXY_BASE_URL": "https://galaxy-temp-frontend.vercel.app"
 *       }
 *     }
 *   }
 * }
 *
 * Or run standalone:
 *   GALAXY_API_KEY=gx_... npx tsx scripts/mcp-server-http.ts
 */

import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });
dotenv.config();

const BASE_URL = (process.env.GALAXY_BASE_URL ?? "https://galaxy-temp-frontend.vercel.app").replace(/\/$/, "");
const API_KEY = process.env.GALAXY_API_KEY ?? "";

if (!API_KEY) {
  console.error("[Galaxy MCP] GALAXY_API_KEY is not set. Add it to the env block in your mcp.json.");
  process.exit(1);
}

async function apiFetch(path: string, opts: RequestInit = {}): Promise<any> {
  const url = `${BASE_URL}/api/v1${path}`;
  const res = await fetch(url, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
      ...(opts.headers ?? {}),
    },
  });

  const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));

  if (!res.ok) {
    const msg = body?.error ?? body?.message ?? `HTTP ${res.status} from ${url}`;
    throw new Error(msg);
  }

  return body?.data ?? body;
}

async function main() {
  const { Server } = await import("@modelcontextprotocol/sdk/server/index.js");
  const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
  const {
    CallToolRequestSchema,
    ErrorCode,
    ListToolsRequestSchema,
    McpError,
  } = await import("@modelcontextprotocol/sdk/types.js");

  const server = new Server(
    { name: "galaxy-mcp-server", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  // ── Tool manifest ──────────────────────────────────────────────────────────

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "list_workflows",
        description: "List all workflow canvases owned by the authenticated user (metadata only).",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "get_workflow",
        description: "Fetch the full nodes, edges, and metadata of a single workflow.",
        inputSchema: {
          type: "object",
          properties: {
            workflowId: { type: "string", description: "ID of the workflow to fetch." },
          },
          required: ["workflowId"],
        },
      },
      {
        name: "create_workflow",
        description: "Create a new workflow canvas. Returns the new workflow with default Request-Inputs and Response nodes.",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Display name of the new workflow." },
            description: { type: "string", description: "Optional description." },
          },
          required: ["name"],
        },
      },
      {
        name: "start_run",
        description:
          "Execute a workflow. Deducts credits and runs in the background on Trigger.dev. Returns a runId to poll with get_run_status.",
        inputSchema: {
          type: "object",
          properties: {
            workflowId: { type: "string", description: "ID of the workflow to execute." },
            inputValues: {
              type: "object",
              description:
                "Flat key→value map of Request-Inputs field IDs to their values. e.g. { \"field_text_default\": \"Hello world\" }",
            },
          },
          required: ["workflowId"],
        },
      },
      {
        name: "get_run_status",
        description:
          "Poll the status and per-node results of a workflow run. Call repeatedly until status is 'success' or 'failed'.",
        inputSchema: {
          type: "object",
          properties: {
            runId: { type: "string", description: "ID returned by start_run." },
          },
          required: ["runId"],
        },
      },
      {
        name: "get_balance",
        description: "Check the current microcredit balance for the authenticated user.",
        inputSchema: { type: "object", properties: {} },
      },
    ],
  }));

  // ── Tool handlers ──────────────────────────────────────────────────────────

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        // ── list_workflows ──────────────────────────────────────────────────
        case "list_workflows": {
          const data = await apiFetch("/workflows");
          const workflows = Array.isArray(data) ? data : data?.workflows ?? data;
          return {
            content: [{ type: "text", text: JSON.stringify(workflows, null, 2) }],
          };
        }

        // ── get_workflow ────────────────────────────────────────────────────
        case "get_workflow": {
          const { workflowId } = args as { workflowId: string };
          if (!workflowId) throw new McpError(ErrorCode.InvalidParams, "workflowId is required.");
          const workflow = await apiFetch(`/workflows/${workflowId}`);
          return {
            content: [{ type: "text", text: JSON.stringify(workflow, null, 2) }],
          };
        }

        // ── create_workflow ─────────────────────────────────────────────────
        case "create_workflow": {
          const { name: wfName, description } = args as { name: string; description?: string };
          if (!wfName) throw new McpError(ErrorCode.InvalidParams, "name is required.");
          const workflow = await apiFetch("/workflows", {
            method: "POST",
            body: JSON.stringify({ name: wfName, description }),
          });
          return {
            content: [
              {
                type: "text",
                text: `Workflow created:\n${JSON.stringify(workflow, null, 2)}`,
              },
            ],
          };
        }

        // ── start_run ───────────────────────────────────────────────────────
        case "start_run": {
          const { workflowId, inputValues = {} } = args as {
            workflowId: string;
            inputValues?: Record<string, unknown>;
          };
          if (!workflowId) throw new McpError(ErrorCode.InvalidParams, "workflowId is required.");
          const run = await apiFetch("/runs", {
            method: "POST",
            body: JSON.stringify({ workflowId, inputValues }),
          });
          return {
            content: [
              {
                type: "text",
                text: `Run started. Poll get_run_status(runId) until status is 'success' or 'failed'.\n${JSON.stringify(
                  { runId: run.runId ?? run.id, status: run.status ?? "running" },
                  null,
                  2
                )}`,
              },
            ],
          };
        }

        // ── get_run_status ──────────────────────────────────────────────────
        case "get_run_status": {
          const { runId } = args as { runId: string };
          if (!runId) throw new McpError(ErrorCode.InvalidParams, "runId is required.");
          const run = await apiFetch(`/runs/${runId}`);
          return {
            content: [{ type: "text", text: JSON.stringify(run, null, 2) }],
          };
        }

        // ── get_balance ─────────────────────────────────────────────────────
        case "get_balance": {
          const data = await apiFetch("/credits/balance");
          const microcredits: number = data?.balance ?? data?.microcredits ?? data ?? 0;
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    microcredits,
                    credits: `${(microcredits / 1_000_000).toFixed(2)}M`,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        default:
          throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
      }
    } catch (error: any) {
      console.error(`[Galaxy MCP] Tool error (${name}):`, error?.message ?? error);
      return {
        isError: true,
        content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[Galaxy MCP] HTTP server running. Base URL: ${BASE_URL}`);
}

main().catch((err) => {
  console.error("[Galaxy MCP] Fatal:", err);
  process.exit(1);
});
