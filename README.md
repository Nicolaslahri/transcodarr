# Transcodarr

> Distributed media transcoding for your home server — GPU-accelerated, zero-config, web UI included.

Transcodarr runs a **Main Node** on your server (NAS, Pi, etc.) that watches folders and manages a queue, and one or more **Worker Nodes** on any machine with a GPU. Workers find the Main automatically via mDNS, or you can add them manually by IP.

---

## How it works

```
[ Watched Folder ] → Main Node → dispatches job → Worker Node (GPU)
                                                          ↓
                                              ffmpeg transcode
                                                          ↓
                         ← streams result back (wireless) OR writes in place (SMB)
```

Two connection modes:
- **Shared Drive (SMB)** — Worker has the NAS mounted; it reads and writes files directly. Fastest.
- **Direct Transfer (Wireless)** — No shared filesystem needed; Main streams the file to the Worker over HTTP, Worker streams the result back. Works over LAN with no NAS setup.

---

## Features

- **Auto-discovery** — Workers broadcast via mDNS (`_transcodarr-worker._tcp`). Main picks them up instantly. No IP config needed.
- **Hardware-agnostic** — NVIDIA NVENC, AMD AMF, Intel QuickSync, or CPU fallback. Detected automatically on worker boot.
- **Smart skip** — Files already in the target codec are skipped automatically; processed files are fingerprinted so they stay skipped even after "Clear All".
- **Live progress** — Real-time progress bars, FPS, and ETA in the queue. Terminal progress display on both Main and Worker.
- **Community recipes** — Import custom ffmpeg recipe packs from any URL returning a JSON array.
- **Web UI** — Dark-theme Next.js dashboard served by the Main Node. Works from any browser on your network.

---

## Quick Start

### Option 1 — Docker (recommended for Main Node)

```bash
docker compose up -d
```

Then open `http://<your-server-ip>:3001` in a browser and follow the setup wizard.

### Option 2 — Node.js directly

**Requirements:** Node.js 20+, ffmpeg in PATH (or set `FFMPEG_PATH` env var)

```bash
npm install
node start.mjs
```

On first run you'll see a setup wizard to configure the node as Main or Worker.

### Development (monorepo)

```bash
npm install
npm run dev          # all three apps in parallel

# Or individually:
npm run dev:main     # Main Node on :3001
npm run dev:worker   # Worker Node on :3002
npm run dev:web      # Next.js dev server on :3000
```

> **After changing `packages/shared`:** run `cd packages/shared && npm run build` before starting apps.

---

## Architecture

```
apps/
  main/     — Fastify API + SQLite + file watcher + dispatcher
  worker/   — Fastify job receiver + ffmpeg runner
  web/      — Next.js UI (static export, served by Main in prod)
packages/
  shared/   — Types, recipe definitions, ffmpeg arg builder
```

See [`CLAUDE.md`](./CLAUDE.md) for a detailed architecture guide including data flow, WebSocket events, and job state machine.

---

## Configuration

Configuration lives in `~/.transcodarr/config.json` (created by the setup wizard).

| Key | Description |
|-----|-------------|
| `role` | `"main"` or `"worker"` |
| `mainUrl` | (Worker only) URL of the Main Node, e.g. `http://192.168.1.10:3001` |
| `nodeName` | Display name shown in the fleet |
| `port` | Override the default port (Main: 3001, Worker: 3002) |

---

## Recipes

Built-in recipes:

| Recipe | Output | Est. reduction |
|--------|--------|----------------|
| HEVC Balanced | H.265 / MKV | ~40% |
| HEVC Quality | H.265 / MKV | ~35% |
| H.264 Compat | H.264 / MP4 | ~20% |
| AV1 Balanced | AV1 / MKV | ~55% |
| Remux to MKV | copy / MKV | 0% (container only) |
| Web Optimised | H.264 / MP4 | ~20% + faststart |
| 4K/1080p → 720p | H.265 / MP4 | ~60% |
| HDR → SDR Tonemap | H.265 / MKV | ~40% |

You can also import community recipe packs from any URL returning a `Recipe[]` JSON array via Settings → Recipes.

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` / `MAIN_PORT` | `3001` | Main Node HTTP port |
| `WORKER_PORT` | `3002` | Worker Node HTTP port |
| `MAIN_HOST` | `0.0.0.0` | IP Main advertises to workers for callbacks |
| `MAIN_URL` | — | (Worker) Full URL of the Main Node |
| `FFMPEG_PATH` | auto-detect | Path to ffmpeg binary |
| `FFPROBE_PATH` | auto-detect | Path to ffprobe binary |
| `DB_PATH` | `./transcodarr.db` | SQLite database path |
| `WORKER_NAME` | hostname | Display name for this worker |

---

## Docker Compose example

```yaml
services:
  transcodarr:
    image: ghcr.io/nicolaslahri/transcodarr:latest
    ports:
      - "3001:3001"
    volumes:
      - /mnt/nas/media:/mnt/nas/media   # your media folder
      - transcodarr-db:/app/data
    environment:
      MAIN_HOST: 192.168.1.10           # your server's LAN IP
      DB_PATH: /app/data/transcodarr.db
volumes:
  transcodarr-db:
```
