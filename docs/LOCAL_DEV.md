# Local development (full stack)

Step-by-step for running **thinkly-backend** + **thinkly-frontend** on Windows/macOS/Linux.

---

## 1. Prerequisites

| Tool | Version |
|------|---------|
| Node.js | **22.x** (matches Trigger workers) |
| pnpm | 9+ |

Clone both repos as siblings:

```
Thinkly/
  thinkly-backend/
  thinkly-frontend/
```

**Do not** run `pnpm` from the parent `Thinkly/` folder — each app is its own repo with its own lockfile.

---

## 2. Accounts you need

| Service | Required for | Get keys |
|---------|----------------|----------|
| **Clerk** | Sign-in, API auth | [dashboard.clerk.com](https://dashboard.clerk.com) → API Keys |
| **Neon** (or Postgres) | Database | [neon.tech](https://neon.tech) → connection string |
| **OpenRouter** | LLM nodes + chat | [openrouter.ai](https://openrouter.ai) |
| **Trigger.dev** | Workflow runs, live run SSE | [cloud.trigger.dev](https://cloud.trigger.dev) |
| **Transloadit** | Uploads / FFmpeg nodes | [transloadit.com](https://transloadit.com) |

**Optional (enable later):**

| Service | Enables |
|---------|---------|
| Unkey | Public API keys + MCP rate limits |
| Upstash Redis | Chat rate limits (dev: skipped if unset) |
| Mem0 | Cross-session chat memory |
| `CHAT_SESSION_KEY_SECRET` | Brain MCP session keys (required for Brain in prod; set any 32+ char secret locally) |

---

## 3. Backend `.env.local`

Create `thinkly-backend/.env.local`:

```env
# Database (Neon)
DATABASE_URL=postgresql://...

# Clerk — same app as frontend
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/dashboard
NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=/dashboard

# LLM + runs
OPENROUTER_API_KEY=sk-or-...
TRIGGER_SECRET_KEY=tr_dev_...

# Media
TRANSLOADIT_KEY=...
TRANSLOADIT_SECRET=...

# Chat / Brain (add when testing chat)
BACKEND_URL=http://localhost:3000
CHAT_SESSION_KEY_SECRET=replace-with-32-char-random-string

# Optional — override chat models (defaults are OpenRouter :free models)
# CHAT_MODEL_HELPER=meta-llama/llama-3.2-3b-instruct:free
# CHAT_MODEL_THINKLY=openrouter/free
# CHAT_MODEL_BRAIN=openrouter/free
# CHAT_MAX_OUTPUT_TOKENS=4096

# Optional
UNKEY_ROOT_KEY=
UNKEY_API_ID=
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
MEM0_API_KEY=
```

---

## 4. Frontend `.env.local`

Create `thinkly-frontend/.env.local`:

```env
BACKEND_URL=http://localhost:3000

NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...   # must match backend
CLERK_SECRET_KEY=sk_test_...                    # must match backend
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/dashboard
NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=/dashboard

NEXT_PUBLIC_LINKEDIN_URL=https://www.linkedin.com/in/your-profile
```

Clerk keys must be from the **same Clerk application** in both files.

---

## 5. Install and database

```powershell
cd thinkly-backend
pnpm install
pnpm db:push
# optional: pnpm db:migrate deploy   # if using SQL migrations
```

If `pnpm install` warns about ignored builds, run once:

```powershell
pnpm approve-builds
```

(Or ensure `pnpm-workspace.yaml` `allowBuilds` includes `prisma`, `sharp`, `@google/genai`.)

---

## 6. Run dev servers (two terminals)

**Terminal 1 — backend (port 3000):**

```powershell
cd thinkly-backend
pnpm dev
```

**Terminal 2 — Trigger worker (same repo):**

```powershell
cd thinkly-backend
npx trigger.dev@latest dev
```

**Terminal 3 — frontend (port 3001):**

```powershell
cd thinkly-frontend
pnpm dev
```

Open **http://localhost:3001/sign-in**

API is at **http://localhost:3000** (frontend proxies `/api/*` to backend).

---

## 7. Windows: out-of-memory (OOM) on frontend

If `next dev` crashes with `JavaScript heap out of memory` while compiling `/sign-in`:

1. **Use the fixed `next.config.ts`** (`turbopack.root` points at `thinkly-frontend`).
2. **Remove** any broken `Thinkly/pnpm-workspace.yaml` at the parent folder (causes Turbopack to scan the whole tree).
3. Increase Node heap before dev:

```powershell
$env:NODE_OPTIONS="--max-old-space-size=8192"
pnpm dev
```

4. If Turbopack still OOMs, use Webpack dev server:

```powershell
pnpm dev:webpack
```

5. Close other heavy apps; 16GB RAM recommended for Turbopack + IDE.

---

## 8. `NODE_AUTH_TOKEN` warning

Frontend `.npmrc` references GitHub Packages for `@shashank519915/*`. If you see:

`Failed to replace env in config: ${NODE_AUTH_TOKEN}`

That is a **warning** (not fatal). `@shashank519915/shared` is installed from the public npm version in `package.json`. To silence it locally, either:

- Set a GitHub PAT: `$env:NODE_AUTH_TOKEN="ghp_..."` before `pnpm install`, or
- Comment out the `//npm.pkg.github.com/:_authToken` line in `.npmrc` if you only use npm-published shared.

---

## 9. What works without full chat setup

| Feature | Minimum env |
|---------|-------------|
| Sign-in / dashboard | Clerk + `BACKEND_URL` on frontend |
| Workflows / canvas | + `DATABASE_URL`, `TRIGGER_SECRET_KEY`, worker running |
| LLM nodes in runs | + `OPENROUTER_API_KEY` on backend **and** Trigger dashboard |
| Chat Helper / Thinkly | + `OPENROUTER_API_KEY` on backend |
| Chat Brain + MCP | + `CHAT_SESSION_KEY_SECRET`, `BACKEND_URL` on backend; Unkey for real MCP keys in prod |

---

## 10. Chat quick test (after env is set)

1. Sign in → **http://localhost:3001/chat**
2. Thinkly mode → new plan → activate blueprint → Brain mode
3. Backend must be running; Brain needs `OPENROUTER_API_KEY` + `CHAT_SESSION_KEY_SECRET`

---

## 11. Production (Vercel + Trigger)

Deploy and test on prod in three places: **backend Vercel**, **frontend Vercel**, and **Trigger.dev dashboard**. Full variable list: [ENVIRONMENT.md](./ENVIRONMENT.md).

### Before first deploy

1. **Database** — run migrations against prod Neon:
   ```bash
   cd thinkly-backend
   npx prisma migrate deploy
   ```
2. **Clerk** — add your production frontend URL to allowed origins and redirect URLs (same Clerk app as local).
3. **Use production keys** on both Vercel projects (`pk_live_…` / `sk_live_…`, `tr_prod_…` for Trigger).

### Backend Vercel (`thinklyneo-backend` → https://thinklyneo-backend.vercel.app)

| Must set | Notes |
|----------|--------|
| `DATABASE_URL` | Same Neon DB as migrations |
| Clerk keys | Match frontend |
| `TRIGGER_SECRET_KEY` | `tr_prod_…` |
| `OPENROUTER_API_KEY`, `TRANSLOADIT_*` | Runs + uploads |
| `BACKEND_URL` | **This deployment’s URL** (e.g. `https://thinklyneo-backend.vercel.app`) — no trailing slash |
| `CHAT_SESSION_KEY_SECRET` | Random 32+ chars — required for Brain/chat |
| `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` | **Required** for chat in prod (rate limits fail-closed without them) |
| `UNKEY_ROOT_KEY` + `UNKEY_API_ID` | Optional locally; needed for public API keys / MCP limits in prod |

### Frontend Vercel (`thinklyneo` → https://thinklyneo.vercel.app)

| Must set | Notes |
|----------|--------|
| `BACKEND_URL` | `https://thinklyneo-backend.vercel.app` (rewrites `/api/*` there) |
| Clerk keys | Same app as backend |
| Build command | `pnpm sync-shared && pnpm build` |
| `NODE_AUTH_TOKEN` | Only if Vercel build needs GitHub Packages for `@shashank519915/shared` |

### Trigger.dev (cloud project env)

Set in the Trigger dashboard — **not** only on Vercel:

- `DATABASE_URL`
- `OPENROUTER_API_KEY`
- `TRANSLOADIT_KEY` / `TRANSLOADIT_SECRET`
- `TRIGGER_SECRET_KEY`

Deploy workers: `npx trigger.dev deploy` from `thinkly-backend` (or push to `main` if CI is wired).

### Prod smoke test (after deploy)

| URL | Expect |
|-----|--------|
| `https://<frontend>/sign-in` | Clerk sign-in loads |
| `https://<frontend>/dashboard` | After auth |
| `https://<frontend>/chat` | UI loads; Brain needs full chat env above |
| Workflow run | Trigger worker + OpenRouter on Trigger dashboard |

Local = “does it load?” Prod = full env + migrations + Trigger workers.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Sign-in blank / spinner forever | Clerk keys mismatch between frontend/backend; check browser console |
| `401` on `/api/*` | Backend not running or wrong `BACKEND_URL` |
| Runs stuck at "running" | Start `npx trigger.dev@latest dev` (local) or check Trigger prod env + deploy |
| Chat OpenRouter `429` rate limit | Wait ~30s and retry; or set `CHAT_MODEL_THINKLY=qwen/qwen3-next-80b-a3b-instruct:free` in `.env.local` |
| Chat 429 / blocked in prod (Upstash) | Set Upstash vars on backend Vercel |
| Backend `pnpm dev` fails on install | `pnpm approve-builds` in `thinkly-backend` |
| Frontend OOM | §7 above |
| Frontend `EADDRINUSE :3001` | Kill stale `node` on 3001 or restart terminal after Cursor hang |
