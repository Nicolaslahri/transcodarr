# Use the official Node 22 image (needed for node:sqlite)
FROM node:22-alpine AS builder

WORKDIR /app

# Install turbo
RUN npm install -g turbo

# Copy the monorepo over
COPY . .

# Install dependencies and build everything
RUN npm install
RUN turbo build

# Production image
FROM node:22-alpine

WORKDIR /app
# We need ffmpeg/ffprobe on the MAIN node to do initial file analysis
RUN apk add --no-cache ffmpeg tzdata

# Need to copy over the dist payload for Main, the static `out` for Web, and package config
COPY --from=builder /app/package.json /app/package.json
COPY --from=builder /app/node_modules /app/node_modules

COPY --from=builder /app/packages/shared/dist /app/packages/shared/dist
COPY --from=builder /app/packages/shared/package.json /app/packages/shared/package.json

COPY --from=builder /app/apps/main/dist /app/apps/main/dist
COPY --from=builder /app/apps/main/package.json /app/apps/main/package.json

COPY --from=builder /app/apps/web/out /app/apps/web/out

# Setting env variables
ENV NODE_ENV=production
ENV MAIN_PORT=3001
ENV MAIN_HOST=0.0.0.0
ENV DB_PATH=/app/data/transcodarr.db

EXPOSE 3001

CMD ["node", "apps/main/dist/index.js"]
