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
import { MCP_SERVER_INSTRUCTIONS, MCP_TOOLS } from "../lib/mcp-tools.js";

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
    { capabilities: { tools: {} }, instructions: MCP_SERVER_INSTRUCTIONS }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: MCP_TOOLS,
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
          const { name: wfName, description, template, productBrief } = args as {
            name: string;
            description?: string;
            template?: string;
            productBrief?: string;
          };
          if (!wfName) throw new McpError(ErrorCode.InvalidParams, "name is required.");
          const workflow = await apiFetch("/workflows", {
            method: "POST",
            body: JSON.stringify({ name: wfName, description, template, productBrief }),
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

        case "update_workflow": {
          const { workflowId, name, description, nodes, edges } = args as {
            workflowId: string;
            name?: string;
            description?: string;
            nodes?: unknown[];
            edges?: unknown[];
          };
          if (!workflowId) throw new McpError(ErrorCode.InvalidParams, "workflowId is required.");
          const patch: Record<string, unknown> = {};
          if (name !== undefined) patch.name = name;
          if (description !== undefined) patch.description = description;
          if (nodes !== undefined) patch.nodes = nodes;
          if (edges !== undefined) patch.edges = edges;
          const workflow = await apiFetch(`/workflows/${workflowId}`, {
            method: "PUT",
            body: JSON.stringify(patch),
          });
          return {
            content: [
              {
                type: "text",
                text: `Workflow updated:\n${JSON.stringify(workflow, null, 2)}`,
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
