# Setup Guide (Backend)

Local development for **galaxy-temp-backend**. Companion UI: **galaxy-temp-frontend**. Env vars: [ENVIRONMENT.md](./ENVIRONMENT.md).

---

## Prerequisites

- Node.js 22 (Trigger workers use `node-22`)
- pnpm
- PostgreSQL (Neon recommended)
- Accounts: Clerk, Trigger.dev, OpenRouter, Transloadit (Unkey optional for `/api/v1`)

---

## Quick start (this repo)

```bash
pnpm install
pnpm db:push
pnpm dev

# Second terminal — same repo
npx trigger.dev@latest dev
```

API: `http://localhost:3000`

---

## Full stack with frontend

Clone **galaxy-temp-frontend** alongside this repo.

```bash
# Backend (this repo)
pnpm install
pnpm db:push
pnpm dev

# Trigger worker
npx trigger.dev@latest dev

# Frontend (sibling repo)
cd ../galaxy-temp-frontend
pnpm install
pnpm sync-shared    # copies shared/ from backend source — point script at backend if needed
pnpm dev
```

Frontend: `http://localhost:3001` — set `BACKEND_URL=http://localhost:3000` in frontend `.env.local`.

Run the backend before the frontend.

---

## Backend detail

```bash
pnpm install          # postinstall runs prisma generate
# Create .env.local — see ENVIRONMENT.md
pnpm db:push
pnpm db:seed          # optional
pnpm dev
```

Without `npx trigger.dev dev`, execute routes enqueue tasks but nothing processes them.

**Scripts:** `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm db:studio`

> The MCP server is hosted at `/api/mcp` (no local script). See `docs/MCP_SETUP.md`.

---

## `@galaxy/shared`

Source of truth: `shared/` in this repo. Frontend mirrors it via `pnpm sync-shared` in the frontend repo after you change definitions.

---

## Deploying Trigger workers

```bash
pnpm --filter @galaxy/shared build
npx trigger.dev deploy
```

CI: `.github/workflows/trigger-deploy.yml` on push to `main` (needs `TRIGGER_ACCESS_TOKEN`).

---

## Docs site (optional)

**galaxy-docs** repo — `npx mintlify@latest dev`. Hosted at `/docs` on the frontend domain.

---

## Testing

```bash
pnpm typecheck && pnpm lint && pnpm test
```

---

## Further reading

- [ENVIRONMENT.md](./ENVIRONMENT.md)
- [DATABASE.md](./DATABASE.md)
- [SYSTEM_DEEP_DIVE.md](./SYSTEM_DEEP_DIVE.md)
- [MCP_SETUP.md](./MCP_SETUP.md) — hosted MCP setup
