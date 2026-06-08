# Thinkly MCP Server

Thinkly exposes a **hosted, stateless MCP server** over Streamable HTTP (JSON-RPC over POST).
Connect any MCP client (Cursor, Claude Desktop, …) with just a URL + a Bearer API key — no
local clone, no script, no database connection.

> The previous local StdIO servers (`scripts/mcp-server*.ts`) have been removed. The hosted
> route is the single supported transport and the single source of truth for tool logic.

## Endpoint

```
https://thinkly-frontend.vercel.app/api/mcp   (frontend rewrites /api/* → backend; bypasses Clerk)
https://thinkly-backend.vercel.app/api/mcp    (direct backend)
```

Each tool call proxies to the same public REST API (`/api/v1/...`) forwarding your
`Authorization: Bearer gx_...` header, so auth, rate-limiting, credits, and validation are
identical to the REST surface.

## 1. Create an API key

Dashboard → **API & Outbound Webhooks** → create a key (`gx_…`). Copy it once at creation.

## 2. Configure your MCP client

`~/.cursor/mcp.json` (or Claude Desktop config):

```json
{
  "mcpServers": {
    "thinkly": {
      "url": "https://thinkly-frontend.vercel.app/api/mcp",
      "headers": { "Authorization": "Bearer gx_your_key_here" }
    }
  }
}
```

That's it — no `command`, `args`, `cwd`, or env.

## Tools

**Discovery** (static; no API key required)
| Tool | Purpose |
|------|---------|
| `list_node_types` | Executable + scaffold nodes, port handles, tabs, output shapes, stub behavior, handle conventions |
| `get_model_schema` | Full input schema for one node type (defaults, ranges, options, tabs, limits, output shape) |
| `list_system_workflows` | Pre-built templates (`empty`, `advertisement`) |

**Workflows**
| Tool | Purpose |
|------|---------|
| `list_workflows` | List user workflows (optional `search`) |
| `get_workflow` | Full nodes/edges/metadata |
| `create_workflow` | New canvas (optional `template`, `productBrief`, `requestFields`) |
| `update_workflow` | Patch metadata / full graph |
| `delete_workflow` | Delete a workflow |

**Graph editing** (validated, atomic via `PATCH /api/v1/workflows/:id/graph`)
| Tool | Purpose |
|------|---------|
| `add_node` | Add an executable node (column/row layout, initial inputs) |
| `update_node` | Merge input values / label / position |
| `connect_nodes` | Validated edge (type compat, cycle prevention, single-input, fan-in) |
| `disconnect_nodes` | Remove an edge |
| `delete_node` | Remove a node + its edges (scaffolds protected) |

**Execution & credits**
| Tool | Purpose |
|------|---------|
| `start_run` | Run by id or fuzzy name; `scope`/`nodeIds`; request-field discovery |
| `get_run_status` | Status + Response output (surfaced first) + per-node detail |
| `list_runs` | List runs (filters + cursor pagination) |
| `cancel_run` | Cancel a running run; refunds the unused credit hold |
| `execute_tool` | One-shot single-model generation (ephemeral workflow under the hood) |
| `upload_file` | Upload media (`url` / `data_uri` / `base64`) → stable URL |
| `get_balance` | Microcredit balance |

## Notes

- **Never auto-upload media.** Leave node/request media fields empty; use `upload_file` then
  `update_node` only when the user actually provides a file.
- **Handle conventions:** executable input `in:<key>`, output `out:<key>`; Request-Inputs source
  = raw field id (e.g. `field_image_1`); Response slot = `result`.
- **Fan-in:** only `in:image_urls` / `in:video_urls` / `in:audio_urls` aggregate multiple edges
  into an array; all other handles are last-write-wins.
- **Stub behavior:** Kling v3 and GPT Image 2 return demo media (no live model in this
  environment); other nodes run for real and fall back to a stub asset only on failure.
