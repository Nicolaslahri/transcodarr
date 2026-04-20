# ─── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:22-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy workspace manifests first for layer caching
COPY package.json package-lock.json turbo.json tsconfig.base.json ./
COPY packages/shared/package.json   ./packages/shared/
COPY apps/main/package.json         ./apps/main/
COPY apps/worker/package.json       ./apps/worker/
COPY apps/web/package.json          ./apps/web/

RUN npm ci --prefer-offline

# Copy source
COPY packages/ ./packages/
COPY apps/main/ ./apps/main/
COPY apps/worker/ ./apps/worker/
COPY apps/web/  ./apps/web/

# Build packages directly with npm scripts (no turbo — avoids layer-cache issues on Linux).
# NODE_OPTIONS raises the V8 heap so tsc doesn't OOM on RAM-constrained hosts.
#
# Pass --build-arg CACHE_BUST=$(date +%s) to docker compose build to force a clean rebuild.
ARG CACHE_BUST=3
RUN echo "Build $CACHE_BUST"
ENV NODE_OPTIONS=--max-old-space-size=2048

# 1. Build shared first — main, worker, and web all import from its dist/
RUN cd packages/shared && npm run build

# 2. Build apps (web uses Next.js, main/worker use tsc)
RUN cd apps/web    && npm run build
RUN cd apps/main   && npm run build
RUN cd apps/worker && npm run build

# ─── Stage 2: Runtime ──────────────────────────────────────────────────────────
FROM node:22-slim AS runtime

# ffmpeg is required by both main (probing) and worker (transcoding)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy compiled assets
COPY --from=builder /app/packages/shared/dist     ./packages/shared/dist
COPY --from=builder /app/packages/shared/package.json ./packages/shared/package.json

COPY --from=builder /app/apps/main/dist           ./apps/main/dist
COPY --from=builder /app/apps/main/package.json   ./apps/main/package.json

COPY --from=builder /app/apps/worker/dist         ./apps/worker/dist
COPY --from=builder /app/apps/worker/package.json ./apps/worker/package.json

COPY --from=builder /app/apps/web/out             ./apps/web/out

# Copy dependency node_modules
COPY --from=builder /app/node_modules             ./node_modules

# Copy unified launcher
COPY --from=builder /app/package.json             ./package.json
COPY start.mjs ./

# Set environment
ENV NODE_ENV=production
ENV MAIN_PORT=3001
ENV WORKER_PORT=3001
ENV FFMPEG_PATH=/usr/bin/ffmpeg
ENV FFPROBE_PATH=/usr/bin/ffprobe

EXPOSE 3001

# The unified launcher handles reading the config, showing the wizard, 
# and spinning up either main/dist/index.js or worker/dist/index.js
CMD ["node", "start.mjs"]
