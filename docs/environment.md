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

| Variable          | Required | Description         | Default                  |
| ----------------- | -------- | ------------------- | ------------------------ |
| `VITE_SERVER_URL` | Yes      | Server API URL      | `http://localhost:3000`  |
| `VITE_PONDER_URL` | No       | Indexer GraphQL URL | `http://localhost:42069` |

### AI Services (Optional)

Needed for AI-powered features (video generation, wiki creation, storyline generation).

| Variable         | App    | Description                                                                  |
| ---------------- | ------ | ---------------------------------------------------------------------------- |
| `FAL_KEY`        | server | [Fal AI](https://fal.ai/) API key — image/video generation                   |
| `GOOGLE_API_KEY` | server | [Google Gemini](https://ai.google.dev/) API key — wiki generation from video |
| `OPENAI_API_KEY` | server | [OpenAI](https://platform.openai.com/) API key — storyline generation        |

The server starts without these keys but AI features will throw errors when called.

### Payments (Optional)

| Variable             | App    | Description                                                   |
| -------------------- | ------ | ------------------------------------------------------------- |
| `STRIPE_SECRET_KEY`  | server | Stripe secret key — enables card payments for credit purchase |
| `TREASURY_ADDRESS`   | server | Ethereum address that receives ETH/$LOAR payments             |
| `LOAR_TOKEN_ADDRESS` | server | $LOAR ERC-20 contract address for token payment verification  |

### Infrastructure (Optional)

| Variable    | App    | Description                                                               |
| ----------- | ------ | ------------------------------------------------------------------------- |
| `REDIS_URL` | server | Redis connection URL — enables distributed rate limiting (multi-instance) |

When `REDIS_URL` is not set, the server uses an in-memory rate limiter (suitable for single-process deployments).

### Blockchain

| Variable           | App     | Required | Description                                                      |
| ------------------ | ------- | -------- | ---------------------------------------------------------------- |
| `PRIVATE_KEY`      | server  | No       | Wallet private key for Synapse/Filecoin uploads (no `0x` prefix) |
| `PONDER_RPC_URL_2` | indexer | Yes      | Sepolia RPC URL (Alchemy recommended)                            |

### Decentralized Storage (Optional)

| Variable                    | App    | Description                                                          |
| --------------------------- | ------ | -------------------------------------------------------------------- |
| `FIREBASE_STORAGE_BUCKET`   | server | Firebase Storage bucket name (for file uploads)                      |
| `WALRUS_PUBLISHER_URL`      | server | Walrus testnet publisher endpoint                                    |
| `WALRUS_AGGREGATOR_URL`     | server | Walrus testnet aggregator endpoint                                   |
| `PINATA_JWT`                | server | Pinata API JWT (IPFS pinning)                                        |
| `PINATA_GATEWAY_URL`        | server | Pinata gateway URL for content retrieval                             |
| `STORAGE_PROVIDER_PRIORITY` | server | Comma-separated priority order (e.g. `walrus,ipfs,synapse,firebase`) |

### Coinbase Developer Platform (Optional)

| Variable              | App | Description                            |
| --------------------- | --- | -------------------------------------- |
| `VITE_CDP_PROJECT_ID` | web | Coinbase Developer Platform project ID |
| `VITE_CDP_API_KEY`    | web | CDP API key                            |
| `VITE_CDP_API_SECRET` | web | CDP API secret                         |

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
