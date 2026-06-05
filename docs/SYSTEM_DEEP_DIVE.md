# System Deep Dive

Architecture reference for the Galaxy platform. Code paths below are relative to **galaxy-temp-backend** unless noted.

---

## Key code paths (this repo)

| Area | Path |
|------|------|
| Execute entry | `app/api/workflows/[id]/execute/route.ts` |
| Public runs | `app/api/v1/runs/route.ts` |
| Orchestrator | `trigger/workflowOrchestrator.ts` |
| Coordinator notify | `trigger/utils.ts` (`notifyCoordinator`) |
| Provider chain | `trigger/provider-chain.ts` |
| Task shell | `trigger/task-coordination.ts` |
| Shared executors | `trigger/executors/index.ts` |
| Node definitions + `providers[]` | `shared/src/definitions/*.node.ts` |
| Credits | `lib/credits.ts` |
| Input limits (HEAD) | `lib/validate-input-limits.ts` |
| Upload (sharp) | `app/api/upload/route.ts` |
| API auth | `lib/api-auth.ts` |
| Webhooks | `trigger/emitWebhookTask.ts`, `lib/webhooks.ts` |
| MCP HTTP | `app/api/mcp/route.ts` |
| Deploy config | `trigger.config.ts` |

Frontend (companion repo): `useRealtimeRun`, `restoreLiveRun`, canvas in `app/workflow/[id]/canvas/`.

---

## Provider fallback (summary)

Config-driven provider fallback (work trial Req 7):

- Each executable node declares ordered `providers[]` in `@galaxy/shared`.
- `runProviderChain` tries providers in order; failures log to `providerAttempts` on `NodeRun`.
- Executor kinds: `openrouter`, `webhook-sim`, `ffmpeg` (task-local), `stub`.
- The orchestrator is **provider-transparent** — dispatches by `node.type` only.

Changing `providers[]` requires `npx trigger.dev deploy`.

### Provider chains (primary → fallback)

| Node | Primary | Fallback |
|------|---------|----------|
| openRouter | `main-openrouter` (15s) | `backup-stub` (text) |
| gemini | `main-openrouter` | `backup-stub` (text) |
| gptImage2 | `gpt-image-webhook` (10s sim) | `backup-stub` (image) |
| klingV3 | `kling-webhook` (12s sim) | `backup-stub` (video) |
| cropImage | `main-ffmpeg` | `backup-stub` (image) |
| mergeVideo / mergeAV | `main-ffmpeg` | `backup-stub` (video) |
| extractAudio | `main-ffmpeg` | `backup-stub` (audio) |

---

## Coordinator-waitpoint (summary)

1. Topo-sort; dispatch ready layer with non-blocking `tasks.trigger`.
2. Park on `wait.forToken` (no idle compute).
3. Node tasks call `notifyCoordinator` → update `NodeRun` → re-trigger orchestrator.
4. Repeat until DAG complete → `reconcileWorkflowCredits` → complete waitpoint.

Scheduling state in Postgres; client re-attaches via `restoreLiveRun()` + `useRealtimeRun`.

Sequence diagrams: [README](../README.md#execution-flow).

---

## Credits lifecycle

`estimateWorkflowCost` → hold in execute/v1 transaction → per-node `creditCost` on success → `reconcileWorkflowCredits` at DAG end (or credit-abort / reconcile route).

Mid-run: `checkNextLayerWithinHold` before each layer.

Registry: `shared/src/definitions/registry.ts`.

---

## Input limits

| Moment | Where |
|--------|--------|
| Upload | `app/api/upload/route.ts` — file size + **sharp** image dimensions |
| Pre-run sync | `@galaxy/shared` `validateWorkflowInputsSync` (frontend Run click) |
| Server execute | `lib/validate-input-limits.ts` — sync rules + HEAD `Content-Length` |

Video duration is declared in `platform-limits.ts` but not probed pre-run.

---

## Related docs

- [DATABASE.md](./DATABASE.md) — schema, ER diagram, ledger types
- [ENVIRONMENT.md](./ENVIRONMENT.md) — `DATABASE_URL`
- [SETUP.md](./SETUP.md) — `db:push` / `db:seed`
