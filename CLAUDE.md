# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Dev (all apps in parallel)
npm run dev

# Dev individual app
npm run dev:main       # apps/main — tsx watch
npm run dev:worker     # apps/worker — tsx watch
npm run dev:web        # apps/web — next dev -p 3000

# Build
npm run build          # all apps via turbo
cd packages/shared && npm run build   # must rebuild when types change

# Type-check
npm run type-check

# Lint
npm run lint
```

**Critical:** Whenever `packages/shared/src/types.ts` or `packages/shared/src/recipes.ts` change, run `cd packages/shared && npm run build` before running the apps. The shared package resolves via a symlink to `packages/shared/dist/`, so the web/main/worker apps pick up the compiled output, not the source.

## Architecture

Transcodarr is an npm workspace monorepo using Turbo. Three runnable apps share one `packages/shared` library.

### Runtime layout

```
Main Node  (apps/main)   — Fastify on :3001
Worker Node(apps/worker) — Fastify on :3002+
Web UI     (apps/web)    — Next.js on :3000 (dev) or served statically by Main (prod)
```

In production the Main node serves the pre-built `apps/web/out` folder from its own Fastify server, so browser→API calls hit the same origin. In dev the web app proxies `/api/*` and `/ws` to `localhost:3001`.

### Data flow

1. **Discovery**: Worker broadcasts `_transcodarr-worker._tcp` mDNS → Main picks it up and calls `POST /api/workers/register` on itself. Alternative: manual IP entry in UI.
2. **Job creation**: `watcher.ts` (chokidar) sees a new file → `queue.ts` ffprobes it → inserts `queued` job into SQLite.
3. **Dispatch**: `dispatcher.ts` polls every 30 s (+ event-driven triggers) → picks first queued job + first idle worker → POSTs `JobPayload` to worker's `POST /job`.
4. **Progress**: Worker POSTs `ProgressUpdate` to `POST /api/workers/jobs/:id/progress` on Main → Main broadcasts `job:progress` WebSocket event.
5. **Completion**: Worker POSTs `JobCompletePayload` to `POST /api/workers/jobs/:id/complete` → Main swaps file, updates DB, broadcasts `job:complete`.
6. **Browser**: `useTranscodarrSocket.tsx` maintains a single WebSocket to `ws://<main>:3001/ws`. All UI state (workers, jobs, stats) is driven by events; HTTP is only used for mutations.

### Key files

| File | What it does |
|------|--------------|
| `start.mjs` | Unified launcher — reads `~/.transcodarr/config.json`, starts Main or Worker, handles setup-wizard mode |
| `apps/main/src/db.ts` | SQLite schema + migrations (tables: `workers`, `jobs`, `watched_paths`, `settings`) |
| `apps/main/src/server.ts` | Fastify + WebSocket broadcast (`broadcast(event, data)`) + health poller |
| `apps/main/src/dispatcher.ts` | Idle-worker matching, SMB path translation (`translatePath`), wireless vs SMB dispatch |
| `apps/main/src/watcher.ts` | chokidar watcher → `queue.ts` enqueue |
| `apps/worker/src/transcoder.ts` | ffmpeg spawn, progress parsing, atomic file swap |
| `apps/worker/src/hardware.ts` | GPU/encoder detection → `HardwareProfile` |
| `apps/web/hooks/useTranscodarrSocket.tsx` | Single source of truth for all UI state; handles every WebSocket event type |
| `packages/shared/src/types.ts` | All shared interfaces (Job, Worker, JobPayload, Recipe, …) |
| `packages/shared/src/recipes.ts` | Built-in recipe definitions + `buildFfmpegArgs()` |

### WebSocket events (Main → Browser)

`broadcast(event, data)` in `server.ts` sends to all connected clients.

```
worker:discovered / accepted / updated / offline / progress
job:queued / job:progress / job:complete / job:failed / job:removed / job:cleared
scan:summary
stats:update
```

Shape: `{ event: WsEventType, data: T, timestamp: number }`

### Job states

`pending → analyzing → queued → dispatched → transcoding → swapping → complete | failed | skipped`

### Connection modes (per worker)

- **SMB**: Worker mounts the NAS share; Main translates paths using `SmbMapping[]` stored in `workers.smb_mappings`. When translated path doesn't exist on disk the worker falls back to a recursive filename search under `smbBasePath`.
- **Wireless**: No shared filesystem. Worker streams the source file from `GET /api/workers/jobs/:id/download`, transcodes in a temp dir, then POSTs the result to `PUT /api/workers/jobs/:id/upload`.

### Worktree note

All active development happens in `.claude/worktrees/<name>` (git worktree). After committing in the worktree, merge and push from the main repo dir:

```bash
cd C:/Users/Nicolas/Documents/Transcodarr
git merge claude/<worktree-name> --no-edit
git push origin main
```

Do **not** create pull requests — push directly to `main`.
