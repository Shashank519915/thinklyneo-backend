/**
 * @fileoverview Hosted Thinkly MCP server (Streamable HTTP transport).
 *
 * Lets Cursor / Claude Desktop connect to Thinkly with just a URL + Bearer API key —
 * no local clone, no script path, no database. Reachable at:
 *   https://thinkly-frontend.vercel.app/api/mcp   (frontend rewrites /api/* → backend; /api/mcp bypasses Clerk)
 *   https://thinkly-backend.vercel.app/api/mcp    (direct backend — works without frontend deploy)
 *
 * Stateless JSON-RPC over POST: each tool call proxies to the same public REST API
 * (`/api/v1/...`) forwarding the caller's `Authorization: Bearer gx_...` header, so
 * auth, rate-limiting, credits, and behavior are identical to the REST surface.
 *
 * Cursor `~/.cursor/mcp.json`:
 * {
 *   "mcpServers": {
 *     "thinkly": {
 *       "url": "https://thinkly-frontend.vercel.app/api/mcp",
 *       "headers": { "Authorization": "Bearer gx_your_key_here" }
 *     }
 *   }
 * }
 */

import { NextResponse } from "next/server";
import { MCP_SERVER_INSTRUCTIONS, MCP_TOOLS } from "@/lib/mcp-tools";
import {
  buildModelSchema,
  listNodeTypes,
  listSystemWorkflows,
} from "@/lib/mcp/node-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_PROTOCOL_VERSION = "2025-06-18";

const SERVER_INFO = { name: "thinkly-mcp-server", version: "1.0.0" } as const;

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

/**
 * Discovery tools answered entirely from static node definitions (no DB, no REST hop,
 * no API key required). Returns null if `name` is not a public/discovery tool.
 */
function callPublicTool(name: string, args: Record<string, unknown>) {
  switch (name) {
    case "list_node_types":
      return textContent(listNodeTypes(args.category as string | undefined));

    case "get_model_schema": {
      const type = args.type as string;
      if (!type) throw new Error("type is required.");
      const schema = buildModelSchema(type);
      if (!schema) {
        throw new Error(
          `Unknown node type "${type}". Call list_node_types to see valid executable node types.`
        );
      }
      return textContent(schema);
    }

    case "list_system_workflows":
      return textContent(listSystemWorkflows());

    default:
      return null;
  }
}

/** Map a graph-editing tool name + args into a single PATCH graph op. */
function buildGraphOp(name: string, args: Record<string, unknown>): Record<string, unknown> {
  switch (name) {
    case "add_node":
      if (!args.nodeType) throw new Error("nodeType is required.");
      return {
        op: "addNode",
        nodeType: args.nodeType,
        label: args.label,
        column: args.column,
        row: args.row,
        position: args.position,
        inputs: args.inputs,
      };
    case "update_node":
      if (!args.nodeId) throw new Error("nodeId is required.");
      return {
        op: "updateNode",
        nodeId: args.nodeId,
        inputs: args.inputs,
        label: args.label,
        position: args.position,
      };
    case "connect_nodes":
      for (const k of ["source", "sourceHandle", "target", "targetHandle"]) {
        if (!args[k]) throw new Error(`${k} is required.`);
      }
      return {
        op: "connectNodes",
        source: args.source,
        sourceHandle: args.sourceHandle,
        target: args.target,
        targetHandle: args.targetHandle,
      };
    case "disconnect_nodes":
      return {
        op: "disconnectNodes",
        edgeId: args.edgeId,
        source: args.source,
        target: args.target,
        sourceHandle: args.sourceHandle,
        targetHandle: args.targetHandle,
      };
    case "delete_node":
      if (!args.nodeId) throw new Error("nodeId is required.");
      return { op: "deleteNode", nodeId: args.nodeId };
    default:
      throw new Error(`Unknown graph tool: ${name}`);
  }
}

type WorkflowSummary = { id: string; name?: string };

/** Pick the best workflow whose name matches a query (exact > prefix > substring). */
function fuzzyPickWorkflow(list: WorkflowSummary[], query: string): WorkflowSummary | null {
  const q = query.trim().toLowerCase();
  let best: WorkflowSummary | null = null;
  let bestScore = 0;
  for (const w of list) {
    const n = (w.name ?? "").toLowerCase();
    let score = 0;
    if (n === q) score = 3;
    else if (n.startsWith(q)) score = 2;
    else if (n.includes(q) || q.includes(n)) score = 1;
    if (score > bestScore) {
      bestScore = score;
      best = w;
    }
  }
  return bestScore >= 1 ? best : null;
}

/** Resolve a workflow id from explicit id or a fuzzy name match against the user's workflows. */
async function resolveWorkflowId(
  origin: string,
  apiKey: string,
  args: Record<string, unknown>
): Promise<string> {
  if (args.workflowId) return args.workflowId as string;
  const name = args.workflowName as string | undefined;
  if (!name) throw new Error("Provide workflowId or workflowName.");
  const data = await apiFetch(origin, apiKey, "/workflows");
  const list = (Array.isArray(data) ? data : (data as { workflows?: unknown })?.workflows ?? []) as WorkflowSummary[];
  const match = fuzzyPickWorkflow(list, name);
  if (!match) {
    const names = list.map((w) => w.name).filter(Boolean).slice(0, 10).join(", ");
    throw new Error(
      `No workflow matched "${name}". Your workflows: ${names || "(none)"}. To run a system template, create_workflow from it first.`
    );
  }
  return match.id;
}

/** Extract Request-Inputs fields from a full workflow record (for field discovery). */
function extractRequestFields(workflow: unknown): Array<{ id: string; type?: string; label?: string; value?: unknown }> {
  const nodes = ((workflow as { nodes?: unknown[] })?.nodes ?? []) as Array<{ type: string; data?: { fields?: unknown[] } }>;
  const ri = nodes.find((n) => n.type === "requestInputs");
  return (ri?.data?.fields as Array<{ id: string; type?: string; label?: string; value?: unknown }>) ?? [];
}

async function callTool(
  name: string,
  args: Record<string, unknown>,
  ctx: { origin: string; apiKey: string }
) {
  const { origin, apiKey } = ctx;

  switch (name) {
    case "list_workflows": {
      const query = args.search ? `?search=${encodeURIComponent(String(args.search))}` : "";
      const data = await apiFetch(origin, apiKey, `/workflows${query}`);
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
          requestFields: args.requestFields,
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

    case "add_node":
    case "update_node":
    case "connect_nodes":
    case "disconnect_nodes":
    case "delete_node": {
      const workflowId = args.workflowId as string;
      if (!workflowId) throw new Error("workflowId is required.");
      const op = buildGraphOp(name, args);
      const result = await apiFetch(origin, apiKey, `/workflows/${workflowId}/graph`, {
        method: "PATCH",
        body: JSON.stringify({ ops: [op] }),
      });
      return textContent(result);
    }

    case "start_run": {
      const workflowId = await resolveWorkflowId(origin, apiKey, args);

      // Request-field discovery: only when inputValues is omitted entirely.
      if (args.inputValues === undefined) {
        const wf = await apiFetch(origin, apiKey, `/workflows/${workflowId}`);
        const fields = extractRequestFields(wf);
        if (fields.length > 0) {
          return textContent({
            needsInput: true,
            workflowId,
            message:
              "This workflow has Request-Inputs fields. Provide inputValues keyed by field id, then call start_run again.",
            fields: fields.map((f) => ({
              id: f.id,
              type: f.type,
              label: f.label,
              default: f.value ?? null,
            })),
          });
        }
      }

      const body: Record<string, unknown> = { workflowId, inputValues: args.inputValues ?? {} };
      if (args.scope) body.scope = args.scope;
      if (args.nodeIds) body.nodeIds = args.nodeIds;
      const run = (await apiFetch(origin, apiKey, "/runs", {
        method: "POST",
        body: JSON.stringify(body),
      })) as { runId?: string; id?: string; status?: string };
      return textContent({
        runId: run.runId ?? run.id,
        status: run.status ?? "running",
        message: "Run started. Poll get_run_status(runId) until status is success / failed / partial.",
      });
    }

    case "get_run_status": {
      const runId = args.runId as string;
      if (!runId) throw new Error("runId is required.");
      const run = (await apiFetch(origin, apiKey, `/runs/${runId}`)) as {
        id?: string;
        status?: string;
        nodeRuns?: Array<{ nodeId: string; output?: unknown }>;
      };
      const responseRun = (run.nodeRuns ?? []).find((nr) => nr.nodeId === "response");
      const stillRunning = run.status === "running";
      return textContent({
        runId: run.id ?? runId,
        status: run.status,
        ...(stillRunning ? { hint: "Still running — call get_run_status again." } : {}),
        responseOutput: responseRun?.output ?? null,
        run,
      });
    }

    case "list_runs": {
      const qs = new URLSearchParams();
      for (const key of ["workflowId", "status", "search", "cursor", "limit"] as const) {
        if (args[key] !== undefined && args[key] !== null) qs.set(key, String(args[key]));
      }
      const query = qs.toString();
      return textContent(await apiFetch(origin, apiKey, `/runs${query ? `?${query}` : ""}`));
    }

    case "cancel_run": {
      const runId = args.runId as string;
      if (!runId) throw new Error("runId is required.");
      return textContent(
        await apiFetch(origin, apiKey, `/runs/${runId}/cancel`, { method: "POST" })
      );
    }

    case "delete_workflow": {
      const workflowId = args.workflowId as string;
      if (!workflowId) throw new Error("workflowId is required.");
      await apiFetch(origin, apiKey, `/workflows/${workflowId}`, { method: "DELETE" });
      return textContent({ deleted: true, workflowId });
    }

    case "upload_file": {
      const body: Record<string, unknown> = {};
      for (const key of ["url", "data_uri", "base64", "mime", "filename"] as const) {
        if (args[key] !== undefined) body[key] = args[key];
      }
      if (!body.url && !body.data_uri && !body.base64) {
        throw new Error("Provide one of url, data_uri, or base64 (with mime).");
      }
      return textContent(
        await apiFetch(origin, apiKey, "/uploads", { method: "POST", body: JSON.stringify(body) })
      );
    }

    case "execute_tool": {
      const toolName = (args.tool_name as string) ?? "generate";
      if (toolName !== "generate") {
        throw new Error(
          `Unsupported tool_name "${toolName}". Only "generate" is supported here; build a workflow for multi-step pipelines.`
        );
      }
      const input = (args.input as Record<string, unknown>) ?? {};
      const type = (input.type ?? input.modelId) as string | undefined;
      if (!type) throw new Error('input.type (node type, e.g. "openRouter") is required.');

      const schema = buildModelSchema(type);
      if (!schema) {
        throw new Error(`Unknown node type "${type}". Call list_node_types for valid types.`);
      }
      const outputHandle = schema.outputs[0]?.outputHandle;
      if (!outputHandle) throw new Error(`Node "${type}" has no output to wire to the response.`);

      // Strip routing keys; the rest are node inputs.
      const nodeInputs: Record<string, unknown> = { ...input };
      delete nodeInputs.type;
      delete nodeInputs.modelId;

      // 1) ephemeral empty workflow (Request + Response scaffold)
      const wf = (await apiFetch(origin, apiKey, "/workflows", {
        method: "POST",
        body: JSON.stringify({ name: `Generation: ${schema.name}`, template: "empty" }),
      })) as { id?: string };
      const workflowId = wf.id;
      if (!workflowId) throw new Error("Failed to create the ephemeral workflow.");

      // 2) add the model node, then 3) wire its output → response result
      const added = (await apiFetch(origin, apiKey, `/workflows/${workflowId}/graph`, {
        method: "PATCH",
        body: JSON.stringify({ ops: [{ op: "addNode", nodeType: type, inputs: nodeInputs }] }),
      })) as { results?: Array<{ nodeId?: string }> };
      const nodeId = added.results?.[0]?.nodeId;
      if (!nodeId) throw new Error("Failed to add the model node.");

      await apiFetch(origin, apiKey, `/workflows/${workflowId}/graph`, {
        method: "PATCH",
        body: JSON.stringify({
          ops: [
            {
              op: "connectNodes",
              source: nodeId,
              sourceHandle: outputHandle,
              target: "response",
              targetHandle: "result",
            },
          ],
        }),
      });

      // 4) run it
      const run = (await apiFetch(origin, apiKey, "/runs", {
        method: "POST",
        body: JSON.stringify({ workflowId, inputValues: {} }),
      })) as { runId?: string; id?: string; status?: string };

      return textContent({
        runId: run.runId ?? run.id,
        status: run.status ?? "running",
        workflowId,
        nodeId,
        message: "One-shot generation started. Poll get_run_status(runId) for the result.",
      });
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
  const override = process.env.THINKLY_API_ORIGIN;
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

        // Discovery tools are static (no auth, no DB) — answer them before the key gate.
        try {
          const publicResult = callPublicTool(toolName, toolArgs);
          if (publicResult) {
            responses.push(rpcResult(id, publicResult));
            break;
          }
        } catch (error) {
          responses.push(
            rpcResult(id, {
              isError: true,
              content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
            })
          );
          break;
        }

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
