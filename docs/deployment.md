# Deployment Guide

## Docker Deployment

### Architecture

`docker-compose.yml` defines three services:

| Service      | Dockerfile                | Port  | Image                            |
| ------------ | ------------------------- | ----- | -------------------------------- |
| `app-server` | `apps/server/Dockerfile`  | 3000  | node:20-alpine, esbuild bundle   |
| `app-web`    | `apps/web/Dockerfile`     | 3001  | alpine, static files via `serve` |
| `indexer`    | `apps/indexer/Dockerfile` | 42069 | node:20-alpine, Ponder           |

All services connect via the `loar-network` bridge network.

### Build & Run

```bash
# Build all containers
docker compose build

# Start in detached mode
docker compose up -d

# View logs
docker compose logs -f

# Stop all services
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

### Environment Variables

- **Server** and **Indexer**: `.env` file is mounted via `env_file: ./.env` in `docker-compose.yml`
- **Web**: Environment variables are baked at build time by Vite. To change them, rebuild the container:
  ```bash
  docker compose build app-web
  docker compose up -d app-web
  ```

### Health Checks

Both server and web Dockerfiles include `HEALTHCHECK` directives:

```bash
# Server health check
curl http://localhost:3000/health

# Web health check
wget -q -O /dev/null http://localhost:3001
```

### Build Details

**Server** (`apps/server/Dockerfile`):

- Multi-stage build (builder + production)
- Uses esbuild to bundle into a single ESM file
- Production image contains only runtime dependencies + bundle
- Healthcheck: `curl /health`

**Web** (`apps/web/Dockerfile`):

- Multi-stage build (builder + production)
- Vite build produces static files
- Production image uses lightweight `serve` static server
- Healthcheck: `wget localhost:3001`

**Indexer** (`apps/indexer/Dockerfile`):

- Single-stage build
- Runs `pnpm start` (Ponder CLI)
- No healthcheck configured

## CI/CD (GitHub Actions)

### Workflow: `.github/workflows/deploy.yml`

**Trigger:** Push to `main` branch

**Process:**

1. SSH into the deployment server
2. `git pull` latest code
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

### Setup

1. Add secrets in GitHub repo > Settings > Secrets and variables > Actions
2. Ensure the server has:
   - Node.js 18+ installed
   - Docker + Docker Compose installed
   - The repo cloned at `WORK_DIR`
   - `.env` file configured on the server

## Manual Deployment

If you prefer deploying without Docker:

### Server

```bash
# Build
cd apps/server
npx esbuild src/index.ts --bundle --platform=node --format=esm --outfile=dist/index.js --external:firebase-admin

# Run
node dist/index.js
```

### Web

```bash
# Build
cd apps/web
pnpm run build

# Serve static files (port 3001)
npx serve -s dist -l 3001
```

### Indexer

```bash
cd apps/indexer
pnpm start
```

## Contract Deployment

Deploy smart contracts to Sepolia:

```bash
cd apps/contracts

# Set env vars
export RPC_11155111=https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY
export VERIFICATION_KEY_1=YOUR_ETHERSCAN_KEY

# Deploy
forge script script/Deploy.s.sol --rpc-url $RPC_11155111 --broadcast --verify
```

After deployment:

1. Update contract addresses in the codebase
2. Run `pnpm exec wagmi generate` to regenerate hooks
3. Update the indexer's `ponder.config.ts` with new addresses

## Production Checklist

- [ ] `.env` has production Firebase credentials
- [ ] `CORS_ORIGIN` set to production domain
- [ ] AI service keys (FAL_KEY, GOOGLE_API_KEY, OPENAI_API_KEY) configured
- [ ] `PONDER_RPC_URL_2` uses a production-grade RPC endpoint
- [ ] Firestore security rules are locked down (not test mode)
- [ ] Firebase Auth settings restrict signup as needed
- [ ] Docker containers are running with `restart: unless-stopped`
- [ ] SSL/TLS termination configured (reverse proxy)
