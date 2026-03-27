# Deployment Guide

## Canonical Deployment Path

**Docker Compose** is the canonical deployment path for all environments. It runs all three services (server, web, indexer) in isolated containers behind a shared bridge network.

**Vercel** is supported as a secondary path for the **web frontend only** (static hosting). The server and indexer must still run via Docker or bare-metal.

## Architecture

| Service      | Dockerfile                | Port  | Health Check          |
| ------------ | ------------------------- | ----- | --------------------- |
| `app-server` | `apps/server/Dockerfile`  | 3000  | `GET /health`         |
| `app-web`    | `apps/web/Dockerfile`     | 3001  | `wget localhost:3001` |
| `indexer`    | `apps/indexer/Dockerfile` | 42069 | `GET /health`         |

All services connect via the `loar-network` bridge network. Each Dockerfile includes a `HEALTHCHECK` directive — Docker will restart unhealthy containers automatically with `restart: unless-stopped`.

## Quick Start (Local Development)

```bash
# 1. Clone and install
git clone <repo-url> && cd loar
pnpm install

# 2. Configure environment
cp .env.example .env
# Edit .env — at minimum set SIWE_JWT_SECRET (see docs/environment.md)

# 3. Start all services
pnpm dev
# Or individual services:
#   make dev-web      (port 3001)
#   make dev-server   (port 3000)
#   make dev-indexer  (port 42069)
```

## Docker Deployment (Staging & Production)

### Prerequisites

- Docker Engine 20+ with Compose V2
- `.env` file configured at repo root (see [environment.md](./environment.md))

### Build & Run

```bash
# Build all containers
docker compose build

# Start in detached mode
docker compose up -d

# View logs
docker compose logs -f

# Stop
docker compose down
```

Or use Make targets:

```bash
make docker-build
make docker-up
make docker-logs
make docker-down
make docker-restart   # rebuild + restart
```

### Environment Variables in Docker

- **Server & Indexer**: `.env` is injected at runtime via `env_file` in `docker-compose.yml`
- **Web**: `VITE_*` variables are baked at build time by Vite. To change them, rebuild:
  ```bash
  docker compose build app-web && docker compose up -d app-web
  ```

### Health Checks

All services expose health endpoints. Docker checks them every 30s and restarts unresponsive containers.

```bash
# Manual verification
curl http://localhost:3000/health   # Server — returns JSON with status, uptime, env
curl http://localhost:42069/health  # Indexer — returns JSON with status
wget -qO- http://localhost:3001    # Web — returns HTML
```

### Build Details

**Server** (`apps/server/Dockerfile`):

- Multi-stage: builder (esbuild bundle) → production (runtime only)
- Bundles to single ESM file, excludes `better-sqlite3` (native module)
- Production image: `node:20-alpine` + `curl` (for healthcheck)

**Web** (`apps/web/Dockerfile`):

- Multi-stage: builder (Vite build) → production (static `serve`)
- Production image: `node:20-alpine` + `serve@14`

**Indexer** (`apps/indexer/Dockerfile`):

- Single-stage: installs deps, runs `ponder start`
- Longer start period (30s) — Ponder needs time to sync initial blocks

## CI/CD (GitHub Actions)

### Deploy Workflow (`.github/workflows/deploy.yml`)

**Trigger:** Push to `main`

**Process:**

1. SSH into deployment server
2. Pull latest code
3. Install dependencies with pnpm
4. Build with Turbo
5. Rebuild and restart Docker containers

### Required GitHub Secrets

| Secret            | Description                        |
| ----------------- | ---------------------------------- |
| `SSH_HOST`        | Deployment server hostname/IP      |
| `SSH_USER`        | SSH username                       |
| `SSH_PRIVATE_KEY` | SSH private key (full PEM content) |
| `WORK_DIR`        | Path to the repo on the server     |
| `MAIN_BRANCH`     | Branch name (typically `main`)     |

### CI Workflow (`.github/workflows/ci.yml`)

Runs on every push/PR to `main`:

1. **Quality**: format check → lint → type check
2. **Build**: full Turbo build
3. **Contracts**: Foundry fmt → build → test

## Vercel (Web Frontend Only)

`vercel.json` at the repo root deploys **only the web app** as a static site:

```json
{
  "buildCommand": "pnpm install --frozen-lockfile && cd apps/web && pnpm run build",
  "outputDirectory": "apps/web/dist",
  "installCommand": "npm i -g pnpm@9.15.0 && pnpm install --frozen-lockfile",
  "framework": null
}
```

Vercel handles the web frontend. The server and indexer must be deployed separately (Docker on a VPS, Railway, Fly.io, etc.).

Set `VITE_SERVER_URL` and `VITE_PONDER_URL` in Vercel's environment variables to point at your deployed server and indexer.

## Manual Deployment (Without Docker)

If Docker is not available:

### Server

```bash
cd apps/server
npx esbuild src/index.ts --bundle --platform=node --format=esm \
  --outfile=dist/index.js --external:better-sqlite3
node dist/index.js
```

### Web

```bash
cd apps/web
pnpm run build
npx serve -s dist -l 3001
```

### Indexer

```bash
cd apps/indexer
pnpm start
```

## Contract Deployment

```bash
cd apps/contracts
export RPC_11155111=https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY
export VERIFICATION_KEY_1=YOUR_ETHERSCAN_KEY
forge script script/Deploy.s.sol --rpc-url $RPC_11155111 --broadcast --verify
```

After deployment:

1. Update contract addresses in the codebase
2. Run `pnpm exec wagmi generate` to regenerate hooks
3. Update the indexer's `ponder.config.ts` with new addresses

## Environment Matrix

| Variable           | Local Dev         | Staging                       | Production                 |
| ------------------ | ----------------- | ----------------------------- | -------------------------- |
| `NODE_ENV`         | `development`     | `production`                  | `production`               |
| `CORS_ORIGIN`      | `localhost:3001`  | `https://staging.loar...`     | `https://loartech.xyz`     |
| `VITE_SERVER_URL`  | `localhost:3000`  | `https://api-staging.loar...` | `https://api.loartech.xyz` |
| `VITE_PONDER_URL`  | `localhost:42069` | `https://idx-staging.loar...` | `https://idx.loartech.xyz` |
| `PONDER_RPC_URL_2` | Alchemy free      | Alchemy growth                | Alchemy growth             |
| Firebase           | Test mode / none  | Test project                  | Production project         |

## Production Checklist

- [ ] `.env` has production Firebase credentials
- [ ] `NODE_ENV=production`
- [ ] `CORS_ORIGIN` set to production domain
- [ ] `SIWE_JWT_SECRET` is a secure random 256-bit hex string
- [ ] AI service keys (FAL_KEY, GOOGLE_API_KEY, OPENAI_API_KEY) configured
- [ ] `PONDER_RPC_URL_2` uses a production-grade RPC endpoint
- [ ] Firestore security rules are locked down (not test mode)
- [ ] Docker containers running with `restart: unless-stopped`
- [ ] SSL/TLS termination configured (reverse proxy: nginx, Caddy, or cloud LB)
- [ ] All three health checks return healthy responses

## Rollback

If a deploy breaks production:

```bash
# SSH into server
cd $WORK_DIR

# Revert to last known good commit
git log --oneline -5       # find the commit
git checkout <good-commit>

# Rebuild
docker compose build && docker compose up -d

# Verify health
curl http://localhost:3000/health
curl http://localhost:42069/health
```

To restore from a specific tag/branch:

```bash
git checkout main
git reset --hard <good-commit>
docker compose build && docker compose up -d
```
