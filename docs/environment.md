# Environment Variables

## Overview

LOAR uses a **single `.env` file at the repository root**. All apps (web, server, indexer) read from this file.

```bash
cp .env.example .env
```

## How Each App Reads the `.env`

| App         | Mechanism         | Details                                                                                                |
| ----------- | ----------------- | ------------------------------------------------------------------------------------------------------ |
| **Server**  | `dotenv.config()` | Loads from `path.resolve(__dirname, "../../../.env")` in `src/index.ts`                                |
| **Web**     | Vite `envDir`     | `vite.config.ts` sets `envDir` to monorepo root. Only `VITE_` prefixed vars are exposed to the browser |
| **Indexer** | `dotenv.config()` | Loads from `path.resolve(__dirname, "../../.env")` in `ponder.config.ts`                               |

## Env Validation

The server validates all environment variables at startup using Zod schemas (`apps/server/src/lib/env.ts`). Missing or malformed values produce actionable error messages and exit immediately.

The indexer validates `PONDER_RPC_URL_2` at config load time and exits with an error if missing.

## Variable Reference

### Authentication (Required)

LOAR uses **SIWE (Sign-In With Ethereum)** for authentication — wallet-based login with JWT sessions. Firebase Auth is **not used**.

| Variable          | App    | Description                                        | Example           |
| ----------------- | ------ | -------------------------------------------------- | ----------------- |
| `SIWE_JWT_SECRET` | server | Secret for signing SIWE session JWTs (256-bit hex) | `a1b2c3d4e5f6...` |

### Firebase (Firestore — data storage only)

Firebase is used **only for Firestore** (data storage). No Firebase Auth, no Firebase client SDK.

| Variable                        | App    | Description                                  | Example                            |
| ------------------------------- | ------ | -------------------------------------------- | ---------------------------------- |
| `FIREBASE_SERVICE_ACCOUNT`      | server | Full JSON string of Firebase service account | `'{"type":"service_account",...}'` |
| `FIREBASE_SERVICE_ACCOUNT_PATH` | server | Alternative: path to JSON file               | `./firebase-service-account.json`  |

You need **either** `FIREBASE_SERVICE_ACCOUNT` (inline JSON) **or** `FIREBASE_SERVICE_ACCOUNT_PATH` (file path) for the server. Not both. In development, the server starts in degraded mode without Firebase credentials (in-memory nonces only).

### Server

| Variable      | Required | Description                                      | Default                 |
| ------------- | -------- | ------------------------------------------------ | ----------------------- |
| `PORT`        | No       | Server port                                      | `3000`                  |
| `NODE_ENV`    | No       | Environment mode                                 | `development`           |
| `CORS_ORIGIN` | In prod  | Allowed CORS origin (must match web URL exactly) | `http://localhost:3001` |

### Web

| Variable                        | Required | Description                                    | Default                  |
| ------------------------------- | -------- | ---------------------------------------------- | ------------------------ |
| `VITE_SERVER_URL`               | Yes      | Server API URL                                 | `http://localhost:3000`  |
| `VITE_PONDER_URL`               | No       | Indexer GraphQL URL                            | `http://localhost:42069` |
| `VITE_CHAIN_ENV`                | No       | Chain environment (`testnet` or `mainnet`)     | `testnet`                |
| `VITE_CHAIN_ID`                 | No       | Default chain ID                               | `11155111`               |
| `VITE_THIRDWEB_CLIENT_ID`       | Yes      | thirdweb client ID for wallet connection       | —                        |
| `VITE_WALLETCONNECT_PROJECT_ID` | No       | WalletConnect project ID                       | —                        |
| `VITE_LOAR_TOKEN_ADDRESS`       | No       | $LOAR ERC-20 contract address (for frontend)   | —                        |
| `VITE_TREASURY_ADDRESS`         | No       | Treasury address (for frontend payment UI)     | —                        |
| `VITE_UNIVERSE_MANAGER`         | No       | UniverseManager contract address               | —                        |
| `VITE_ADMIN_ADDRESSES`          | No       | Comma-separated admin wallet addresses         | —                        |
| `VITE_STRIPE_PUBLISHABLE_KEY`   | No       | Stripe publishable key (enables card payments) | —                        |

### AI Services (Optional)

Needed for AI-powered features (video generation, wiki creation, storyline generation, 3D, voice).

| Variable             | App    | Description                                                                  |
| -------------------- | ------ | ---------------------------------------------------------------------------- |
| `FAL_KEY`            | server | [Fal AI](https://fal.ai/) API key — image/video generation                   |
| `BYTEDANCE_API_KEY`  | server | ByteDance ModelArk API key — Seedance 2.0 video generation                   |
| `GOOGLE_API_KEY`     | server | [Google Gemini](https://ai.google.dev/) API key — wiki generation from video |
| `OPENAI_API_KEY`     | server | [OpenAI](https://platform.openai.com/) API key — storyline generation        |
| `MESHY_API_KEY`      | server | [Meshy](https://www.meshy.ai/) API key — 3D model generation                 |
| `ELEVENLABS_API_KEY` | server | [ElevenLabs](https://elevenlabs.io/) API key — TTS and voice cloning         |

The server starts without these keys but AI features will throw errors when called.

### Payments (Optional)

| Variable                | App    | Description                                                          |
| ----------------------- | ------ | -------------------------------------------------------------------- |
| `STRIPE_SECRET_KEY`     | server | Stripe secret key — enables card payments for credit purchase        |
| `STRIPE_WEBHOOK_SECRET` | server | Stripe webhook signing secret — verifies `/api/stripe/webhook` calls |
| `TREASURY_ADDRESS`      | server | Ethereum address that receives ETH/$LOAR payments                    |
| `LOAR_TOKEN_ADDRESS`    | server | $LOAR ERC-20 contract address for token payment verification         |

### Infrastructure (Optional)

| Variable    | App    | Description                                                               |
| ----------- | ------ | ------------------------------------------------------------------------- |
| `REDIS_URL` | server | Redis connection URL — enables distributed rate limiting (multi-instance) |

When `REDIS_URL` is not set, the server uses an in-memory rate limiter (suitable for single-process deployments).

### Observability (Optional)

| Variable                       | App    | Description                                                                                                                 |
| ------------------------------ | ------ | --------------------------------------------------------------------------------------------------------------------------- |
| `SENTRY_DSN`                   | server | Sentry DSN for server-side error reporting. When unset, Sentry is inert.                                                    |
| `VITE_SENTRY_DSN`              | web    | Public Sentry DSN for the web bundle. Safe to expose — DSNs are project-scoped write-only keys.                             |
| `VITE_RELEASE`                 | web    | Release identifier (typically a git SHA) injected at build time so Sentry groups errors by deployed version.                |
| `LOG_LEVEL`                    | server | pino log level: `trace` \| `debug` \| `info` \| `warn` \| `error` \| `fatal`. Defaults: `debug` dev, `info` prod.           |
| `METRICS_AUTH_TOKEN`           | server | Bearer token required on `GET /metrics`. When unset, the endpoint is open — deploy on a private network or proxy allowlist. |
| `SLACK_WEBHOOK_URL`            | server | Incoming webhook URL. Routes kill-switch flips and abuse flags to a Slack channel. No-op when unset.                        |
| `ABUSE_DETECT_ENABLED`         | server | `true` to run the in-process abuse scan every 30 min. Enable on ONE replica only.                                           |
| `ABUSE_DETECT_DAILY_THRESHOLD` | server | Spend rows in 24h that trigger a flag. Default `100`.                                                                       |
| `ABUSE_DETECT_INTERVAL_MS`     | server | How often the scan runs. Default `1800000` (30 min).                                                                        |
| `ABUSE_DETECT_SCAN_LIMIT`      | server | Most-recent `userCredits` docs to inspect each tick. Default `500`.                                                         |
| `ABUSE_DETECT_COOLDOWN_MS`     | server | Cooldown window that suppresses re-flagging the same wallet. Default `21600000` (6 hours).                                  |

The `/metrics` endpoint emits Prometheus exposition-format text and is intended to be scraped every 15–60s. It bypasses the global rate limit. In addition to the default Node process metrics (prefix `loar_`), the server exports counters for HTTP requests, AI generations, storage uploads, credits transactions, and auth events, plus live gauges for queue depth and circuit breaker state.

### Blockchain

| Variable           | App     | Required | Description                                                      |
| ------------------ | ------- | -------- | ---------------------------------------------------------------- |
| `PRIVATE_KEY`      | server  | No       | Wallet private key for Synapse/Filecoin uploads (no `0x` prefix) |
| `PONDER_RPC_URL_2` | indexer | Yes      | Sepolia RPC URL (Alchemy recommended)                            |

### Decentralized Storage (Optional)

| Variable                    | App    | Description                                                         |
| --------------------------- | ------ | ------------------------------------------------------------------- |
| `FIREBASE_STORAGE_BUCKET`   | server | Firebase Storage bucket name (for file uploads)                     |
| `PINATA_JWT`                | server | Pinata API JWT (IPFS pinning — primary hot storage)                 |
| `PINATA_GATEWAY_URL`        | server | Pinata gateway URL for content retrieval                            |
| `LIGHTHOUSE_API_KEY`        | server | Lighthouse API key (Filecoin/IPFS permanent storage + token-gating) |
| `STORAGE_PROVIDER_PRIORITY` | server | Comma-separated priority order (e.g. `pinata,lighthouse,firebase`)  |

### Contracts / Foundry (Optional)

| Variable             | App       | Description                                 |
| -------------------- | --------- | ------------------------------------------- |
| `RPC_11155111`       | contracts | Sepolia RPC URL for deployments             |
| `VERIFICATION_KEY_1` | contracts | Etherscan API key for contract verification |

## Minimal `.env` for Development

To run the web app and server without AI or blockchain features:

```env
# Authentication
SIWE_JWT_SECRET=dev-secret-change-in-production

# Server
PORT=3000
CORS_ORIGIN=http://localhost:3001

# Web
VITE_SERVER_URL=http://localhost:3000
```

The server will start in degraded mode (in-memory nonces, no Firestore persistence). This is fine for local development.

## Getting Firebase Credentials

### 1. Create a Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click **Add project** and complete setup

### 2. Create Firestore Database

1. Go to **Firestore Database** > **Create database**
2. Start in **test mode** for development
3. Choose a location close to your users

### 3. Get Service Account Key

1. Go to **Project Settings** > **Service accounts**
2. Click **Generate new private key**
3. Either:
   - Save the JSON file and set `FIREBASE_SERVICE_ACCOUNT_PATH=./firebase-service-account.json`
   - Or paste the entire JSON content as `FIREBASE_SERVICE_ACCOUNT='{ ... }'`

**Important:** Never commit service account keys. The `.gitignore` already excludes `firebase-service-account.json`.
