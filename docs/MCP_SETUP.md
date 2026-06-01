# Galaxy MCP Server Setup

StdIO MCP server for Cursor, Claude Desktop, and other MCP clients. Uses the same database and Trigger.dev orchestrator as the web app (**coordinator architecture unchanged**).

## Prerequisites

- Backend `.env.local` with `DATABASE_URL`, Trigger.dev keys, and a valid API key
- Dependencies installed: `pnpm install` in `galaxy-temp-backend`

## 1. Create an API key

1. Sign in to the dashboard → **API & Outbound Webhooks**
2. Create a key (Unkey `gx_…` or local `gx_mock_…`)
3. Copy the full key once — it is shown only at creation time

## 2. Configure environment

In `galaxy-temp-backend/.env.local`:

```env
GALAXY_API_KEY=gx_your_key_here
# Optional — same as REST API verification:
UNKEY_ROOT_KEY=...
UNKEY_API_ID=...
```

`GALAXY_API_KEY` is the bearer token the MCP process uses for all tool calls (mapped to your Clerk user via Unkey or local DB hash).

## 3. Run the server

```bash
cd galaxy-temp-backend
pnpm mcp:start
```

## 4. Cursor configuration

Add to `.cursor/mcp.json` (project or user level):

```json
{
  "mcpServers": {
    "galaxy-workflows": {
      "command": "pnpm",
      "args": ["mcp:start"],
      "cwd": "C:\\Users\\YOU\\Desktop\\PF\\galaxy-temp-backend",
      "env": {
        "GALAXY_API_KEY": "gx_your_key_here"
      }
    }
  }
}
```

Use `tsx` directly if pnpm is not on PATH:

```json
{
  "command": "npx",
  "args": ["tsx", "scripts/mcp-server.ts"],
  "cwd": ".../galaxy-temp-backend"
}
```

## Tools exposed

| Tool | Description |
|------|-------------|
| `list_workflows` | List workflow metadata for the authenticated user |
| `get_workflow` | Full nodes/edges JSON for one workflow |
| `create_workflow` | New canvas with Request-Inputs + Response |
| `start_run` | Full run via `workflow-orchestrator` (credit hold + Trigger.dev) |
| `get_run_status` | Run + nodeRuns status, outputs, errors |
| `get_balance` | Microcredit balance |

## Claude Desktop

Same `command` / `args` / `env` block under `mcpServers` in Claude Desktop config (see [MCP quickstart](https://modelcontextprotocol.io/docs/getting-started/intro)).
