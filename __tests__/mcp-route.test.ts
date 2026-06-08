/**
 * Hosted MCP JSON-RPC handler — no network; verifies tool manifest + initialize.
 */
import { describe, it, expect } from "vitest";
import { POST } from "@/app/api/mcp/route";

async function postMcp(body: unknown, headers: Record<string, string> = {}) {
  const request = new Request("https://thinkly-backend.vercel.app/api/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const response = await POST(request);
  return response.json() as Promise<Record<string, unknown>>;
}

describe("POST /api/mcp", () => {
  it("returns tools/list manifest", async () => {
    const data = await postMcp({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(data.jsonrpc).toBe("2.0");
    expect(data.id).toBe(1);
    const tools = (data.result as { tools?: { name: string }[] })?.tools ?? [];
    const names = tools.map((t) => t.name);
    // Core workflow/run/credit tools must always be present.
    for (const core of [
      "list_workflows",
      "get_workflow",
      "create_workflow",
      "update_workflow",
      "start_run",
      "get_run_status",
      "get_balance",
    ]) {
      expect(names).toContain(core);
    }
    // Discovery tools (static, no auth) are exposed in the manifest.
    for (const discovery of ["list_node_types", "get_model_schema", "list_system_workflows"]) {
      expect(names).toContain(discovery);
    }
  });

  it("list_node_types works without an API key (static discovery)", async () => {
    const data = await postMcp({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: { name: "list_node_types", arguments: {} },
    });
    const result = data.result as { isError?: boolean; content?: { text: string }[] };
    expect(result?.isError).toBeFalsy();
    const text = result?.content?.[0]?.text ?? "";
    expect(text).toMatch(/executableNodes/);
    expect(text).toMatch(/openRouter/);
  });

  it("get_model_schema returns input schema for a node type", async () => {
    const data = await postMcp({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: { name: "get_model_schema", arguments: { type: "openRouter" } },
    });
    const result = data.result as { isError?: boolean; content?: { text: string }[] };
    expect(result?.isError).toBeFalsy();
    const text = result?.content?.[0]?.text ?? "";
    expect(text).toMatch(/in:prompt/);
    expect(text).toMatch(/outputShape/);
  });

  it("initialize returns server info and routing instructions", async () => {
    const data = await postMcp({
      jsonrpc: "2.0",
      id: 2,
      method: "initialize",
      params: { protocolVersion: "2025-06-18" },
    });
    const result = data.result as { serverInfo?: { name: string }; instructions?: string };
    expect(result?.serverInfo?.name).toBe("thinkly-mcp-server");
    expect(result?.instructions).toMatch(/create_workflow/i);
    expect(result?.instructions).toMatch(/do not create local files/i);
  });

  it("create_workflow description steers agents to call Thinkly MCP", async () => {
    const data = await postMcp({ jsonrpc: "2.0", id: 4, method: "tools/list" });
    const tools = (data.result as { tools?: { name: string; description: string }[] })?.tools ?? [];
    const createWorkflow = tools.find((t) => t.name === "create_workflow");
    expect(createWorkflow?.description).toMatch(/thinkly platform/i);
    expect(createWorkflow?.description).toMatch(/do not build workflow files locally/i);
    expect(createWorkflow?.description).toMatch(/advertisement/i);
  });

  it("create_workflow schema includes template and productBrief", async () => {
    const data = await postMcp({ jsonrpc: "2.0", id: 5, method: "tools/list" });
    const tools = (data.result as { tools?: { name: string; inputSchema: { properties: Record<string, unknown> } }[] })?.tools ?? [];
    const createWorkflow = tools.find((t) => t.name === "create_workflow");
    expect(createWorkflow?.inputSchema.properties.template).toBeDefined();
    expect(createWorkflow?.inputSchema.properties.productBrief).toBeDefined();
  });

  it("tools/call without API key returns isError content", async () => {
    const data = await postMcp({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "list_workflows", arguments: {} },
    });
    const result = data.result as { isError?: boolean; content?: { text: string }[] };
    expect(result?.isError).toBe(true);
    expect(result?.content?.[0]?.text).toMatch(/missing api key/i);
  });
});
