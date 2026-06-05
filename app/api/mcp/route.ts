/**
 * @fileoverview Hosted Galaxy MCP server (Streamable HTTP transport).
 *
 * Lets Cursor / Claude Desktop connect to Galaxy with just a URL + Bearer API key —
 * no local clone, no script path, no database. Reachable at:
 *   https://galaxy-temp-frontend.vercel.app/api/mcp   (frontend rewrites /api/* → backend; /api/mcp bypasses Clerk)
 *   https://galaxy-temp-backend.vercel.app/api/mcp    (direct backend — works without frontend deploy)
 *
 * Stateless JSON-RPC over POST: each tool call proxies to the same public REST API
 * (`/api/v1/...`) forwarding the caller's `Authorization: Bearer gx_...` header, so
 * auth, rate-limiting, credits, and behavior are identical to the REST surface.
 *
 * Cursor `~/.cursor/mcp.json`:
 * {
 *   "mcpServers": {
 *     "galaxy": {
 *       "url": "https://galaxy-temp-frontend.vercel.app/api/mcp",
 *       "headers": { "Authorization": "Bearer gx_your_key_here" }
 *     }
 *   }
 * }
 */

import { NextResponse } from "next/server";
import { MCP_SERVER_INSTRUCTIONS, MCP_TOOLS } from "@/lib/mcp-tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_PROTOCOL_VERSION = "2025-06-18";

const SERVER_INFO = { name: "galaxy-mcp-server", version: "1.0.0" } as const;

type JsonRpcId = string | number | null;

function rpcResult(id: JsonRpcId, result: unknown) {
  return { jsonrpc: "2.0" as const, id, result };
}

function rpcError(id: JsonRpcId, code: number, message: string) {
  return { jsonrpc: "2.0" as const, id, error: { code, message } };
}

/** Proxy a request to this deployment's own public REST API, forwarding the caller's API key. */
async function apiFetch(
  origin: string,
  apiKey: string,
  path: string,
  opts: RequestInit = {}
): Promise<unknown> {
  const url = `${origin}/api/v1${path}`;
  const res = await fetch(url, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...(opts.headers ?? {}),
    },
  });

  const body = (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as Record<
    string,
    unknown
  >;

  if (!res.ok) {
    const msg = (body?.error as string) ?? (body?.message as string) ?? `HTTP ${res.status} from ${url}`;
    throw new Error(msg);
  }

  return (body as { data?: unknown })?.data ?? body;
}

function textContent(value: unknown) {
  return { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] };
}

async function callTool(
  name: string,
  args: Record<string, unknown>,
  ctx: { origin: string; apiKey: string }
) {
  const { origin, apiKey } = ctx;

  switch (name) {
    case "list_workflows": {
      const data = await apiFetch(origin, apiKey, "/workflows");
      const workflows = Array.isArray(data) ? data : (data as { workflows?: unknown })?.workflows ?? data;
      return textContent(workflows);
    }

    case "get_workflow": {
      const workflowId = args.workflowId as string;
      if (!workflowId) throw new Error("workflowId is required.");
      return textContent(await apiFetch(origin, apiKey, `/workflows/${workflowId}`));
    }

    case "create_workflow": {
      const wfName = args.name as string;
      if (!wfName) throw new Error("name is required.");
      const workflow = await apiFetch(origin, apiKey, "/workflows", {
        method: "POST",
        body: JSON.stringify({
          name: wfName,
          description: args.description,
          template: args.template,
          productBrief: args.productBrief,
        }),
      });
      return textContent(`Workflow created:\n${JSON.stringify(workflow, null, 2)}`);
    }

    case "update_workflow": {
      const workflowId = args.workflowId as string;
      if (!workflowId) throw new Error("workflowId is required.");
      const patch: Record<string, unknown> = {};
      if (args.name !== undefined) patch.name = args.name;
      if (args.description !== undefined) patch.description = args.description;
      if (args.nodes !== undefined) patch.nodes = args.nodes;
      if (args.edges !== undefined) patch.edges = args.edges;
      const workflow = await apiFetch(origin, apiKey, `/workflows/${workflowId}`, {
        method: "PUT",
        body: JSON.stringify(patch),
      });
      return textContent(`Workflow updated:\n${JSON.stringify(workflow, null, 2)}`);
    }

    case "start_run": {
      const workflowId = args.workflowId as string;
      if (!workflowId) throw new Error("workflowId is required.");
      const run = (await apiFetch(origin, apiKey, "/runs", {
        method: "POST",
        body: JSON.stringify({ workflowId, inputValues: args.inputValues ?? {} }),
      })) as { runId?: string; id?: string; status?: string };
      return textContent(
        `Run started. Poll get_run_status(runId) until status is 'success' or 'failed'.\n${JSON.stringify(
          { runId: run.runId ?? run.id, status: run.status ?? "running" },
          null,
          2
        )}`
      );
    }

    case "get_run_status": {
      const runId = args.runId as string;
      if (!runId) throw new Error("runId is required.");
      return textContent(await apiFetch(origin, apiKey, `/runs/${runId}`));
    }

    case "get_balance": {
      const data = (await apiFetch(origin, apiKey, "/credits/balance")) as Record<string, unknown>;
      const microcredits =
        (data?.balance as number) ?? (data?.microcredits as number) ?? (typeof data === "number" ? data : 0);
      return textContent({ microcredits, credits: `${(microcredits / 1_000_000).toFixed(2)}M` });
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

/** Resolve the origin used for self-proxying to /api/v1 (override via env when behind a proxy). */
function resolveApiOrigin(request: Request): string {
  const override = process.env.GALAXY_API_ORIGIN;
  if (override) return override.replace(/\/$/, "");
  const forwardedHost = request.headers.get("x-forwarded-host");
  if (forwardedHost) {
    const proto = request.headers.get("x-forwarded-proto") ?? "https";
    return `${proto}://${forwardedHost.split(",")[0]?.trim()}`;
  }
  return new URL(request.url).origin;
}

export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization") ?? "";
  const apiKey = authHeader.replace(/^Bearer\s+/i, "").trim();
  const origin = resolveApiOrigin(request);

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(rpcError(null, -32700, "Parse error: invalid JSON"), { status: 400 });
  }

  const messages = Array.isArray(payload) ? payload : [payload];
  const responses: unknown[] = [];

  for (const msg of messages) {
    const { id = null, method, params } = (msg ?? {}) as {
      id?: JsonRpcId;
      method?: string;
      params?: Record<string, unknown>;
    };

    // Notifications (no id) require no response.
    if (!method || method.startsWith("notifications/")) continue;

    switch (method) {
      case "initialize":
        responses.push(
          rpcResult(id, {
            protocolVersion: (params?.protocolVersion as string) ?? DEFAULT_PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: SERVER_INFO,
            instructions: MCP_SERVER_INSTRUCTIONS,
          })
        );
        break;

      case "ping":
        responses.push(rpcResult(id, {}));
        break;

      case "tools/list":
        responses.push(rpcResult(id, { tools: MCP_TOOLS }));
        break;

      case "tools/call": {
        const toolName = params?.name as string;
        const toolArgs = (params?.arguments as Record<string, unknown>) ?? {};
        if (!apiKey) {
          responses.push(
            rpcResult(id, {
              isError: true,
              content: [
                {
                  type: "text",
                  text: "Missing API key. Add `\"headers\": { \"Authorization\": \"Bearer gx_...\" }` to your mcp.json server entry.",
                },
              ],
            })
          );
          break;
        }
        try {
          responses.push(rpcResult(id, await callTool(toolName, toolArgs, { origin, apiKey })));
        } catch (error) {
          responses.push(
            rpcResult(id, {
              isError: true,
              content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
            })
          );
        }
        break;
      }

      default:
        if (id !== null) responses.push(rpcError(id, -32601, `Method not found: ${method}`));
    }
  }

  // Only notifications were sent — acknowledge with 202 and no body.
  if (responses.length === 0) return new Response(null, { status: 202 });

  return NextResponse.json(Array.isArray(payload) ? responses : responses[0]);
}

/** Stateless MCP — JSON-RPC over POST only. GET returns a clear JSON error (not HTML 404). */
export function GET() {
  return NextResponse.json(
    rpcError(null, -32601, "This MCP endpoint is stateless; use POST for JSON-RPC."),
    {
      status: 405,
      headers: {
        Allow: "POST, OPTIONS",
        "Content-Type": "application/json",
      },
    }
  );
}

export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      Allow: "POST, GET, OPTIONS",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id",
    },
  });
}
