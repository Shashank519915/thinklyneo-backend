# Environment Variables

Secrets are split across three surfaces: **Vercel backend**, **Vercel frontend**, and the **Trigger.dev project dashboard**. The Next.js API and Trigger workers are deployed separately, so some keys (e.g. `DATABASE_URL`, `OPENROUTER_API_KEY`) must exist in more than one place.

---

## Backend (Vercel: `galaxy-temp-backend`)

| Variable | Required | Purpose |
|----------|----------|---------|
| `DATABASE_URL` | Yes | Neon Postgres connection string (Prisma) |
| `CLERK_SECRET_KEY` | Yes | Validates session cookie on API routes |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Yes | Clerk client key (must match frontend) |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | Yes | `/sign-in` |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | Yes | `/sign-up` |
| `NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL` | Yes | `/dashboard` |
| `NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL` | Yes | `/dashboard` |
| `TRIGGER_SECRET_KEY` | Yes | `tasks.trigger`, mint public token, metadata updates (`tr_prod_…` on Vercel) |
| `OPENROUTER_API_KEY` | Yes | LLM provider for openRouter and gemini nodes |
| `TRANSLOADIT_KEY` / `TRANSLOADIT_SECRET` | Yes | FFmpeg task outputs and `/api/upload` |
| `UNKEY_ROOT_KEY` | Optional | Unkey verification and rate limits for `/api/v1` |
| `UNKEY_API_KEY` | Optional | Unkey API id (code reads `UNKEY_API_ID` or `UNKEY_API_KEY`; else SHA-256 key table) |
| `NEXT_PUBLIC_LINKEDIN_URL` | Optional | Footer link |
| `TRIGGER_API_URL` | Optional | Defaults to `https://api.trigger.dev` |
| `GALAXY_API_ORIGIN` | Optional | Override origin for hosted MCP route proxy |

---

## Frontend (Vercel: `galaxy-temp-frontend`)

| Variable | Required | Purpose |
|----------|----------|---------|
| `BACKEND_URL` | Yes | Backend URL for `/api/*` rewrite proxy |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Yes | Must match backend |
| `CLERK_SECRET_KEY` | Yes | Clerk middleware on protected pages |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | Yes | `/sign-in` |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | Yes | `/sign-up` |
| `NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL` | Yes | `/dashboard` |
| `NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL` | Yes | `/dashboard` |
| `NEXT_PUBLIC_LINKEDIN_URL` | Optional | Footer link |
| `DATABASE_URL` | Optional | Set in deployment but unused by frontend (no Prisma) |

**Vercel build command:** `pnpm sync-shared && pnpm build`

---

## Trigger.dev cloud (project dashboard, per environment)

Injected at **task runtime** — not compiled into the deploy bundle.

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Prisma in orchestrator, `notifyCoordinator`, webhook lookup |
| `OPENROUTER_API_KEY` | `executeOpenRouterProvider` |
| `TRANSLOADIT_KEY` / `TRANSLOADIT_SECRET` | FFmpeg tasks (crop, merge, extract) |
| `TRIGGER_SECRET_KEY` | Orchestrator metadata REST updates |
| `TRIGGER_API_URL` | Optional; defaults to `https://api.trigger.dev` |

**Common mistake:** `OPENROUTER_API_KEY` set only on Vercel. Orchestrated runs call OpenRouter from the **worker**, so it must also be set in the Trigger dashboard.

Redeploy workers after changing any task or a definition's `providers[]` — config is baked into the bundle at deploy time.

---

## GitHub Actions (backend repo)

| Secret | Purpose |
|--------|---------|
| `TRIGGER_ACCESS_TOKEN` | Trigger.dev PAT (`tr_pat_…`) for `.github/workflows/trigger-deploy.yml` |

Auto-deploys on push to `main` when `trigger/**`, `trigger.config.ts`, or `shared/**` change.

---

## MCP client (local, e.g. Cursor `mcp.json`)

| Variable | Purpose |
|----------|---------|
| `GALAXY_API_KEY` | Bearer key for MCP server/endpoint |
| `GALAXY_BASE_URL` | Defaults to hosted frontend URL |

---

## Local development

Create `.env.local` in each app. Minimum for a working local stack:

**Backend:** `DATABASE_URL`, Clerk keys, `TRIGGER_SECRET_KEY`, `OPENROUTER_API_KEY`, `TRANSLOADIT_KEY`, `TRANSLOADIT_SECRET`

**Frontend:** `BACKEND_URL=http://localhost:3000`, same Clerk keys

**Trigger.dev dev:** same worker secrets as the Trigger dashboard (or use `npx trigger.dev dev` with project linked)

See [SETUP.md](./SETUP.md) for step-by-step local run instructions.
