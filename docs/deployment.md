# Deployment Guide

## Canonical Deployment Path

The stack is split across two deployment targets by design:

| Layer                | Platform                          | Why                                                                                                |
| -------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------- |
| **Web frontend**     | **Vercel**                        | Static SPA — global CDN, automatic HTTPS, git-push deploys, `VITE_*` env vars managed in dashboard |
| **Server + Indexer** | **Railway** or **Docker Compose** | Stateful persistent processes — need direct chain access, Firebase Admin, restart policies         |
| **Mobile**           | **Expo (EAS)**                    | iOS + Android builds via `eas build` / `eas submit`                                                |

## Architecture

| Service   | Dockerfile                | Port  | Health Check  | Platform     |
| --------- | ------------------------- | ----- | ------------- | ------------ |
| `server`  | `apps/server/Dockerfile`  | 3000  | `GET /health` | Docker (VPS) |
| `indexer` | `apps/indexer/Dockerfile` | 42069 | `GET /health` | Docker (VPS) |
| `web`     | —                         | —     | —             | Vercel (CDN) |

The server and indexer connect via the `loar-network` bridge network. Each Dockerfile includes a `HEALTHCHECK` directive — Docker will restart unhealthy containers automatically with `restart: unless-stopped`.

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

## Railway Deployment (Recommended)

Railway auto-deploys from GitHub and manages containers, networking, and HTTPS for you.

### Setup

1. Create a [Railway](https://railway.com) project and connect your GitHub repo
2. Add two services from the same repo:

**Service 1: loar-server**

- Root directory: `apps/server`
- Railway reads `apps/server/railway.toml` automatically
- Set env vars in the Railway dashboard:

| Variable                   | Required | Notes                                     |
| -------------------------- | -------- | ----------------------------------------- |
| `PORT`                     | Yes      | `3000`                                    |
| `NODE_ENV`                 | Yes      | `production`                              |
| `SIWE_JWT_SECRET`          | Yes      | `openssl rand -hex 32`                    |
| `CORS_ORIGIN`              | Yes      | `https://loar.fun`                        |
| `FIREBASE_SERVICE_ACCOUNT` | Yes      | JSON string of service account            |
| `RPC_URL`                  | Yes      | Base / Sepolia RPC URL                    |
| `LOAR_TOKEN_ADDRESS`       | Yes      | Token contract address                    |
| `TREASURY_ADDRESS`         | Yes      | Treasury wallet address                   |
| AI keys, storage keys      | Optional | Features degrade gracefully without these |

**Service 2: loar-indexer**

- Root directory: `apps/indexer`
- Railway reads `apps/indexer/railway.toml` automatically
- Set env vars:

| Variable           | Required | Notes                                 |
| ------------------ | -------- | ------------------------------------- |
| `PONDER_RPC_URL_2` | Yes      | Your RPC endpoint                     |
| `PONDER_CHAIN`     | Optional | `sepolia` (default) or `base-sepolia` |

### Custom Domains

In Railway, add custom domains to each service:

- `api.loar.fun` → server service
- `idx.loar.fun` → indexer service

Then update Vercel env vars:

- `VITE_SERVER_URL` = `https://api.loar.fun`
- `VITE_PONDER_URL` = `https://idx.loar.fun`

---

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
make smoke-test       # run 5 smoke tests against localhost
make rollback         # roll back to previous SHA (reads .loar-deploy)
```

### Environment Variables in Docker

- **Server & Indexer**: `.env` is injected at runtime via `env_file` in `docker-compose.yml`
- **Web**: `VITE_*` variables are baked at build time by Vite. On Vercel, set them in the project dashboard — Vercel rebuilds on every push automatically.

### Health Checks

All services expose health endpoints. Docker checks them every 30s and restarts unresponsive containers.

```bash
# Manual verification
curl http://localhost:3000/health   # Server — returns JSON with status, uptime, env
curl http://localhost:42069/health  # Indexer — returns JSON with status
# Web health is monitored by Vercel (dashboard → Deployments)
```

### Build Details

**Server** (`apps/server/Dockerfile`):

- Multi-stage: builder (esbuild bundle) → production (runtime only)
- Bundles to single ESM file, excludes `better-sqlite3` (native module)
- Production image: `node:20-alpine` + `curl` (for healthcheck)

**Web**: deployed via Vercel (see [Vercel section](#vercel-web-frontend-only) below — no Dockerfile needed).

**Indexer** (`apps/indexer/Dockerfile`):

- Single-stage: installs deps, runs `ponder start`
- Longer start period (30s) — Ponder needs time to sync initial blocks

## CI/CD (GitHub Actions)

### Deploy Workflow (`.github/workflows/deploy.yml`)

**Trigger:** Push to `main`

**Process:**

1. SSH into deployment server
2. Record current git SHA as the rollback point (saved to `.loar-deploy`)
3. Pull latest code (`git pull origin main`)
4. Build and restart Docker containers
5. Poll `GET /health` on both services — retries every 5s for up to 90s
6. Run `scripts/smoke-test.sh` (5 checks across server + indexer)
7. **On failure:** auto-rollback to previous SHA, rebuild, re-run smoke tests, exit non-zero
8. On success: print deploy summary (commit SHA, URLs, test results)

A broken deploy is automatically detected and rolled back — no SSH required.

### Deploy State File

The workflow writes `.loar-deploy` at the repo root on every deploy:

```
PREV_SHA=<git sha before this deploy>
CURRENT_SHA=<git sha that was deployed>
DEPLOY_TIME=<ISO-8601 UTC timestamp>
DEPLOY_STATUS=ok | failed_smoke | failed_timeout | rolled_back
```

`scripts/rollback.sh` reads `PREV_SHA` from this file.

### Required GitHub Secrets

| Secret            | Description                        |
| ----------------- | ---------------------------------- |
| `SSH_HOST`        | Deployment server hostname/IP      |
| `SSH_USER`        | SSH username                       |
| `SSH_PRIVATE_KEY` | SSH private key (full PEM content) |
| `WORK_DIR`        | Path to the repo on the server     |

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

## Environment Injection Per Platform

Each service receives only the secrets it needs. The tables below list the exact vars to configure per platform.

### Vercel (web only)

Set these in **Vercel → Settings → Environment Variables**. All are `VITE_` prefixed and safe to expose publicly — they are baked into the JS bundle.

| Variable                  | Required    | Notes                               |
| ------------------------- | ----------- | ----------------------------------- |
| `VITE_SERVER_URL`         | ✅          | Backend API URL                     |
| `VITE_PONDER_URL`         | recommended | Indexer GraphQL URL                 |
| `VITE_LOAR_TOKEN_ADDRESS` | recommended | $LOAR token contract                |
| `VITE_TREASURY_ADDRESS`   | recommended | Treasury wallet                     |
| `VITE_CDP_PROJECT_ID`     | optional    | Coinbase project ID only            |
| `VITE_FIREBASE_*`         | optional    | Firebase web client config (6 vars) |
| `VITE_ADMIN_ADDRESSES`    | optional    | Comma-separated admin wallets       |

> ⚠ Never add `CDP_API_KEY`, `CDP_API_SECRET`, `FIREBASE_SERVICE_ACCOUNT`, or any server secret to Vercel — those belong on the server only.

### Docker / VPS (server)

Inject via `env_file` in `docker-compose.yml` or runtime environment. Only the server container receives these.

| Variable                                   | Required                 | Notes                                                       |
| ------------------------------------------ | ------------------------ | ----------------------------------------------------------- |
| `SIWE_JWT_SECRET`                          | ✅                       | `openssl rand -hex 32`                                      |
| `FIREBASE_SERVICE_ACCOUNT`                 | ✅ prod                  | Inline JSON string (or use `FIREBASE_SERVICE_ACCOUNT_PATH`) |
| `CORS_ORIGIN`                              | ✅ prod                  | Your public domain                                          |
| `NODE_ENV`                                 | ✅                       | `production`                                                |
| `PORT`                                     | ✅                       | `3000`                                                      |
| `FIREBASE_STORAGE_BUCKET`                  | recommended              | Firebase Storage bucket                                     |
| `ADMIN_WALLET`                             | recommended              | Admin wallet address (`0x...`)                              |
| `PRIVATE_KEY`                              | if on-chain writes       | 64-char hex, no `0x`                                        |
| `FAL_KEY` / `OPENAI_API_KEY` / etc.        | if AI features           | Per-provider API keys                                       |
| `PINATA_JWT` / `LIGHTHOUSE_API_KEY` / etc. | if decentralized storage | Per-provider keys                                           |

See `apps/server/.env.example` for the complete list.

### Docker / VPS (indexer)

The indexer needs exactly one secret:

| Variable           | Required | Notes                |
| ------------------ | -------- | -------------------- |
| `PONDER_RPC_URL_2` | ✅       | Sepolia RPC endpoint |

### Secret Rotation

Rotating one secret does **not** require rebuilding unrelated services:

| Secret                     | Scope   | Action                                                               |
| -------------------------- | ------- | -------------------------------------------------------------------- |
| `SIWE_JWT_SECRET`          | server  | Restart server — all existing sessions invalidate immediately        |
| `FIREBASE_SERVICE_ACCOUNT` | server  | Restart server                                                       |
| AI keys (`FAL_KEY`, etc.)  | server  | Restart server                                                       |
| `PONDER_RPC_URL_2`         | indexer | Restart indexer only                                                 |
| Any `VITE_*` var           | web     | Update Vercel dashboard → redeploy web                               |
| `PRIVATE_KEY`              | server  | Restart server; update on-chain authorized address if wallet changed |

## Environment Matrix

| Variable           | Local Dev                | Staging                        | Production             |
| ------------------ | ------------------------ | ------------------------------ | ---------------------- |
| `NODE_ENV`         | `development`            | `production`                   | `production`           |
| `CORS_ORIGIN`      | `http://localhost:3001`  | `https://staging.loar.fun`     | `https://loar.fun`     |
| `VITE_SERVER_URL`  | `http://localhost:3000`  | `https://api-staging.loar.fun` | `https://api.loar.fun` |
| `VITE_PONDER_URL`  | `http://localhost:42069` | `https://idx-staging.loar.fun` | `https://idx.loar.fun` |
| `PONDER_RPC_URL_2` | Alchemy free             | Alchemy growth                 | Alchemy growth         |
| Firebase           | Test mode / none         | Test project                   | Production project     |

## Production Checklist

**Server (Docker / VPS)**

- [ ] `NODE_ENV=production`
- [ ] `SIWE_JWT_SECRET` is a secure random 256-bit hex string (`openssl rand -hex 32`)
- [ ] `CORS_ORIGIN` set to production domain
- [ ] `FIREBASE_SERVICE_ACCOUNT` or `FIREBASE_SERVICE_ACCOUNT_PATH` configured
- [ ] AI service keys configured for features in use
- [ ] Storage provider keys configured (`PINATA_JWT`, `LIGHTHOUSE_API_KEY`, etc.)
- [ ] Server starts cleanly — no `❌ Environment validation failed` in logs

**Indexer (Docker / VPS)**

- [ ] `PONDER_RPC_URL_2` uses a production-grade RPC endpoint (paid tier)
- [ ] Indexer starts cleanly — no `❌ Indexer environment validation failed` in logs

**Web (Vercel)**

- [ ] `VITE_SERVER_URL` and `VITE_PONDER_URL` point at production endpoints
- [ ] No server secrets set in Vercel env vars
- [ ] Vercel deployment is live

**Infrastructure**

- [ ] Firestore security rules are locked down (not test mode)
- [ ] Docker containers running with `restart: unless-stopped`
- [ ] SSL/TLS termination configured for server + indexer
- [ ] Server and indexer health checks return healthy (`/health` on both)

## Rollback

### Automatic (deploy pipeline)

Rollback is triggered automatically when smoke tests fail during a deploy. The pipeline resets to the previous SHA, rebuilds, and verifies before marking the deploy as failed.

### Manual (operator)

If you need to roll back outside the pipeline:

```bash
# SSH into server
cd $WORK_DIR

# Option A — use the rollback script (reads .loar-deploy for the previous SHA)
bash scripts/rollback.sh

# Option B — explicit SHA
ROLLBACK_SHA=<git-sha> bash scripts/rollback.sh

# Option C — manual steps
git log --oneline -5            # find target commit
git reset --hard <good-commit>
docker compose build && docker compose up -d
bash scripts/smoke-test.sh      # verify
```

The rollback script runs smoke tests after restoring the previous image and exits non-zero if they still fail, so you know immediately if the previous state is also broken.

To restore from a specific tag/branch:

```bash
git checkout main
git reset --hard <good-commit>
docker compose build && docker compose up -d
```
