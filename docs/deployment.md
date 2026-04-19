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
2. Add a **Redis** database: "+ New" → "Database" → "Add Redis". Railway exposes it as reference variable `${{Redis.REDIS_URL}}`.
3. Add two services from the same repo:

**Service 1: loar-server**

- Root directory: `apps/server`
- Railway reads `apps/server/railway.toml` automatically
- Set env vars in the Railway dashboard:

| Variable                   | Required | Notes                                                                                          |
| -------------------------- | -------- | ---------------------------------------------------------------------------------------------- |
| `PORT`                     | Yes      | `3000`                                                                                         |
| `NODE_ENV`                 | Yes      | `production`                                                                                   |
| `SIWE_JWT_SECRET`          | Yes      | `openssl rand -hex 32`                                                                         |
| `CORS_ORIGIN`              | Yes      | `https://loar.fun`                                                                             |
| `FIREBASE_SERVICE_ACCOUNT` | Yes      | JSON string of service account                                                                 |
| `RPC_URL`                  | Yes      | Base / Sepolia RPC URL                                                                         |
| `LOAR_TOKEN_ADDRESS`       | Yes      | Token contract address                                                                         |
| `TREASURY_ADDRESS`         | Yes      | Treasury wallet address                                                                        |
| `REDIS_URL`                | Yes      | Set to `${{Redis.REDIS_URL}}` (reference). Without it, generation jobs run inline and time out |
| AI keys, storage keys      | Optional | Features degrade gracefully without these                                                      |

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
  "buildCommand": "cd apps/web && pnpm run build",
  "outputDirectory": "apps/web/dist",
  "installCommand": "npm i -g pnpm@9.15.0 && pnpm install --frozen-lockfile",
  "framework": null,
  "rewrites": [{ "source": "/((?!assets/).*)", "destination": "/index.html" }]
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

Contracts are deployed on **Sepolia testnet** using upgradeable proxy patterns (UUPS + Beacon).

### Revenue Infrastructure (Full Deploy)

```bash
cd apps/contracts
source ../../.env && export PRIVATE_KEY="0x$PRIVATE_KEY"

# Deploy all revenue contracts (implementations + beacons + proxies + factory)
forge script script/DeployRevenue.s.sol \
  --rpc-url "$RPC_11155111" \
  --broadcast \
  --skip "script/Deploy{Protocol,Hook,Locker,Universe}*" \
  --sender 0x116C28e6DCABCa363f83217C712d79DCE168d90e
```

This deploys 28 contracts:

- 5 NFT implementations + 5 UpgradeableBeacons
- 1 RevenueModuleFactory
- 9 UUPS implementations + 9 ERC1967Proxies (initialized)

Broadcast results are saved to `apps/contracts/broadcast/DeployRevenue.s.sol/11155111/run-latest.json`.

### Core Protocol Deploy

```bash
forge script script/DeployProtocol.s.sol --rpc-url $RPC_11155111 --broadcast --verify
```

### After Any Deployment

1. Update `apps/web/src/configs/addresses.ts` with new proxy addresses
2. Run `cd ../.. && pnpm exec wagmi generate` to regenerate TypeScript hooks
3. Update `apps/indexer/ponder.config.ts` if new factory or event sources were added

### Upgrading Deployed Contracts

**UUPS Singletons** (PaymentRouter, RightsRegistry, etc.):

```bash
# Deploy new implementation, then upgrade proxy
forge create src/PaymentRouter.sol:PaymentRouter --rpc-url $RPC_11155111 --private-key $PRIVATE_KEY
cast send <PROXY> "upgradeToAndCall(address,bytes)" <NEW_IMPL> 0x --rpc-url $RPC_11155111 --private-key $PRIVATE_KEY
```

**Beacon NFTs** (CharacterNFT, EpisodeNFT, etc.):

```bash
# Deploy new implementation, then upgrade beacon (all proxies update at once)
forge create src/revenue/CharacterNFT.sol:CharacterNFT --rpc-url $RPC_11155111 --private-key $PRIVATE_KEY
cast send <BEACON> "upgradeTo(address)" <NEW_IMPL> --rpc-url $RPC_11155111 --private-key $PRIVATE_KEY
```

See [contracts.md](./contracts.md) for the full address table and architecture details.

## Environment Injection Per Platform

Each service receives only the secrets it needs. The tables below list the exact vars to configure per platform.

### Vercel (web only)

Set these in **Vercel → Settings → Environment Variables**. All are `VITE_` prefixed and safe to expose publicly — they are baked into the JS bundle.

| Variable                | Required    | Notes                               |
| ----------------------- | ----------- | ----------------------------------- |
| `VITE_SERVER_URL`       | ✅          | Backend API URL                     |
| `VITE_PONDER_URL`       | recommended | Indexer GraphQL URL                 |
| `VITE_TREASURY_ADDRESS` | recommended | Treasury wallet                     |
| `VITE_FIREBASE_*`       | optional    | Firebase web client config (6 vars) |
| `VITE_ADMIN_ADDRESSES`  | optional    | Comma-separated admin wallets       |

> ⚠ Never add `FIREBASE_SERVICE_ACCOUNT` or any server secret to Vercel — those belong on the server only.

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
