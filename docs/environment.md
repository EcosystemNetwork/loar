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

| Variable                   | App    | Description                                                                                                                                                          | Example               |
| -------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| `SIWE_JWT_SECRET`          | server | Secret for signing SIWE session JWTs (256-bit hex)                                                                                                                   | `a1b2c3d4e5f6...`     |
| `SIWE_JWT_SECRET_PREVIOUS` | server | Optional. Previous JWT secret during a 24h rotation grace window. `verifySessionToken()` tries the current secret then falls back to this one. Remove after JWT TTL. | `<prior secret>`      |
| `SIWE_ALLOWED_DOMAINS`     | server | Optional comma-separated allowed domains for SIWE messages. Defaults to `CORS_ORIGIN`.                                                                               | `loar.fun,staging...` |
| `SIWE_ALLOWED_CHAIN_IDS`   | server | Optional comma-separated chain IDs accepted in SIWE messages. Defaults to `8453,84532,11155111,31337` (Base, Base Sepolia, Sepolia, Anvil).                          | `8453,84532`          |

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

### ERC-4337 Paymaster / Gas Sponsorship (Optional)

Server-side gas sponsorship for sponsored meta-transactions (mint, vote, universe creation). Provider is resolved in order: thirdweb → Pimlico → Biconomy. Configure exactly **one** — when none are set, `/api/paymaster` returns 501 and sponsored actions silently fall back to user-paid gas. See [apps/server/src/routes/paymaster.ts](../apps/server/src/routes/paymaster.ts).

| Variable                     | App    | Description                                                                                             |
| ---------------------------- | ------ | ------------------------------------------------------------------------------------------------------- |
| `THIRDWEB_SECRET_KEY`        | server | thirdweb paymaster (uses the same project as `VITE_THIRDWEB_CLIENT_ID`). Default provider when present. |
| `PIMLICO_API_KEY`            | server | Pimlico v2 bundler + paymaster RPC.                                                                     |
| `BICONOMY_API_KEY`           | server | Biconomy v2 bundler + paymaster RPC.                                                                    |
| `PAYMASTER_DAILY_LIMIT`      | server | Per-wallet sponsored operations per rolling 24h window. Default `50`.                                   |
| `PAYMASTER_DEFAULT_CHAIN_ID` | server | Fallback chain when a sponsorship request omits `chainId`. Default `84532` (Base Sepolia).              |

### CSAM / Hash-Matching Moderation

Every image publish is scanned by [apps/server/src/services/fingerprint/csam-providers.ts](../apps/server/src/services/fingerprint/csam-providers.ts) before it can be pinned to IPFS. At least **one** provider should be configured in production — without any provider, only local perceptual hashing runs and previously-seen CSAM can pass through unflagged.

| Variable                    | App    | Description                                                                  |
| --------------------------- | ------ | ---------------------------------------------------------------------------- |
| `PHOTODNA_ENDPOINT`         | server | Microsoft PhotoDNA endpoint (e.g. `https://api.microsoftmoderator.com/...`). |
| `PHOTODNA_SUBSCRIPTION_KEY` | server | PhotoDNA Azure subscription key.                                             |
| `HIVE_API_KEY`              | server | Hive AI image-moderation API key. Augments or replaces PhotoDNA.             |

### Cost Tracker & Controls (Optional)

Admin-only per-provider cost attribution with gross-margin gauges, daily platform caps, and Slack/email alerts. See [apps/server/src/services/cost-tracker/](../apps/server/src/services/cost-tracker/).

| Variable                      | App    | Description                                                                                                            |
| ----------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------- |
| `COST_MARGIN_TARGET`          | server | Target gross margin `(revenue − cost) / revenue`. Flagged when breached. Default `0.30`.                               |
| `COST_ALERT_ENABLED`          | server | `true` to run the background alert sweep. Enable on **ONE replica only**.                                              |
| `COST_ALERT_INTERVAL_MS`      | server | Alert sweep interval. Default `600000` (10 min).                                                                       |
| `COST_ALERT_COOLDOWN_MIN`     | server | Minutes between repeat alerts for the same rule. Default `30`.                                                         |
| `COST_DAILY_PLATFORM_CAP_USD` | server | Hard daily platform cost cap. When reached, every paid provider call fails with `CostCapExceededError` until rollover. |
| `COST_CONTROLS_CACHE_MS`      | server | Admin-facing controls cache TTL. Admin mutations invalidate immediately. Default `30000`.                              |

### VLM Subsystem (Optional)

Gemini-backed media-understanding pipeline (moderation, canon checks, multimodal search). See [docs/prd-vlm-subsystem.md](prd-vlm-subsystem.md). Requires `GOOGLE_API_KEY`.

| Variable                        | App    | Description                                                                                |
| ------------------------------- | ------ | ------------------------------------------------------------------------------------------ |
| `VLM_WORKER_DISABLED`           | server | `true` skips the in-process VLM worker (use when running a dedicated worker replica).      |
| `VLM_WORKER_CONCURRENCY`        | server | VLM worker job concurrency. Default `3`.                                                   |
| `VLM_AUTO_EXTRACT`              | server | Auto-enqueue extract after every generation. Default `true`.                               |
| `VLM_AUTO_HIDE_HIGH_RISK`       | server | Auto-hide content when risk=high (requires admin review to un-hide). Default `false`.      |
| `VLM_EMBEDDINGS`                | server | Store `text-embedding-004` vectors on `sceneIndex` for similarity search. Default `false`. |
| `VLM_EXTRACT_PER_USER_PER_HOUR` | server | Per-user rate limit for `vlm.extract.start`. Default `10`.                                 |
| `VLM_USER_MONTHLY_USD`          | server | Per-user monthly VLM spend cap, USD. Default `5`.                                          |
| `VLM_CROSS_MODEL`               | server | Ensemble Gemini + OpenAI for high-stakes checks. Default `false`.                          |
| `VLM_MODERATION_ON_GENERATION`  | server | Run VLM moderation on every finished generation. Default `false`.                          |
| `CANON_BLOCK_ON_HIGH`           | server | Hard-block publish on block-severity canon conflicts. Default `false`.                     |
| `VLM_CONTINUOUS_FILM`           | server | Phase 7 autoplay loop — enable on **ONE replica only**.                                    |
| `VLM_AUTOPLAY_MAX_PER_DAY`      | server | Autoplay advancements per universe per day. Default `10`.                                  |
| `VLM_AUTOPLAY_BUDGET_USD`       | server | Per-universe autoplay daily USD cap. Default `20`.                                         |
| `VLM_AUTOPLAY_REQUIRE_VOTE`     | server | Require on-chain canon vote before advancing autoplay state. Default `true`.               |

### Webhooks (Optional)

HMAC-signed outbound webhooks delivered by the [webhook worker](../apps/server/src/workers/webhook.worker.ts). Receivers verify `X-Loar-Signature: sha256=<hex>` over `${X-Loar-Timestamp}.${body}`.

| Variable                     | App    | Description                                                                                             |
| ---------------------------- | ------ | ------------------------------------------------------------------------------------------------------- |
| `WEBHOOK_SIGNING_SECRET`     | server | HMAC-SHA256 secret used to sign outbound webhook bodies. When unset, `enqueueWebhook()` silently skips. |
| `WEBHOOK_WORKER_CONCURRENCY` | server | Parallel webhook deliveries per worker. Default `10`.                                                   |

### DMCA § 512(g) Auto-Putback (Optional)

Automatically restores taken-down content when a counter-notice has been pending for the configured hold window with no court action filed. Critical for safe-harbor eligibility.

| Variable                   | App    | Description                                                            |
| -------------------------- | ------ | ---------------------------------------------------------------------- |
| `DMCA_PUTBACK_ENABLED`     | server | Enable the auto-putback sweep. **ONE replica only.**                   |
| `DMCA_PUTBACK_INTERVAL_MS` | server | Sweep interval. Default `3600000` (1h).                                |
| `DMCA_PUTBACK_HOLD_DAYS`   | server | Hold period before putback. Default `14` calendar days (≈10 business). |
| `DMCA_PUTBACK_BATCH_LIMIT` | server | Counter-notices processed per tick. Default `50`.                      |

### MCP Server (Optional)

| Variable             | App | Description                                                                   |
| -------------------- | --- | ----------------------------------------------------------------------------- |
| `LOAR_SERVER_URL`    | mcp | LOAR API base URL the MCP server proxies to. Default `http://localhost:3000`. |
| `LOAR_API_KEY`       | mcp | API key used to authenticate MCP→server calls.                                |
| `LOAR_MCP_TRANSPORT` | mcp | Transport: `stdio` (default, direct agent wiring) or `http`.                  |
| `LOAR_MCP_HOST`      | mcp | HTTP bind host when `LOAR_MCP_TRANSPORT=http`. Default `0.0.0.0`.             |
| `LOAR_MCP_PORT`      | mcp | HTTP bind port when `LOAR_MCP_TRANSPORT=http`. Default `4000`.                |

### Mobile (Expo — EXPO*PUBLIC* prefix)

Everything prefixed with `EXPO_PUBLIC_` is bundled into the app binary — **no secrets**. Read at build time via `expo-env`.

| Variable                         | App    | Description                                                              |
| -------------------------------- | ------ | ------------------------------------------------------------------------ |
| `EXPO_PUBLIC_SERVER_URL`         | mobile | LOAR API base URL.                                                       |
| `EXPO_PUBLIC_THIRDWEB_CLIENT_ID` | mobile | thirdweb project client ID (mirrors web).                                |
| `EXPO_PUBLIC_APP_ENV`            | mobile | `production` \| `staging` \| `development`.                              |
| `EXPO_PUBLIC_SENTRY_DSN`         | mobile | Sentry DSN for JS-layer crashes.                                         |
| `EXPO_PUBLIC_RELEASE`            | mobile | Git SHA injected by CI at `eas build` time.                              |
| `EXPO_PUBLIC_POSTHOG_KEY`        | mobile | PostHog project API key.                                                 |
| `EXPO_PUBLIC_POSTHOG_HOST`       | mobile | PostHog host (`https://us.i.posthog.com` or `https://eu.i.posthog.com`). |

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
| `POSTHOG_API_KEY`              | server | PostHog project API key for server-side product analytics events. When unset, server analytics is a silent no-op.           |
| `POSTHOG_HOST`                 | server | PostHog host (`https://us.i.posthog.com`, `https://eu.i.posthog.com`, or self-hosted).                                      |
| `VITE_POSTHOG_KEY`             | web    | PostHog project API key for the web SDK. Public-safe (write-only, scoped to one project).                                   |
| `VITE_POSTHOG_HOST`            | web    | PostHog host for the web SDK.                                                                                               |
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
| `PINATA_GATEWAY_TOKEN`      | server | Access token for dedicated `*.mypinata.cloud` gateways (optional)   |
| `VITE_PINATA_GATEWAY_URL`   | web    | Client-side gateway URL (mirrors `PINATA_GATEWAY_URL`)              |
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
