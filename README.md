# Transcodarr

The zero-config, native, intelligent media transcoding platform designed for the home server.

## Features
- **mDNS Auto-Discovery**: Workers on your network automatically find the Main Node via Zero-Conf.
- **Smart SMB Bypass**: Network transfers are bypassed if a chunk of media is natively accessible via SMB mappings on the worker.
- **Hardware Agnostic**: Supports NVENC, AMF, QuickSync, or CPU fallback dynamically detected.
- **Built-in Dashboard**: Premium Web UI built on Next.js communicating directly with the internal Fastify queue.

## Getting Started

### Local Development (Monorepo)
```bash
npm install
npm run dev:main
npm run dev:worker
```

### Production via Docker (Main Node)
A `docker-compose.yml` and `Dockerfile` are included for deploying the Main Node to Portainer, Raspberry Pi, or any standard Linux NAS.
