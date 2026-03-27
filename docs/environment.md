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

## Variable Reference

### Firebase (Required)

These are needed for both the web app (client SDK) and server (Admin SDK).

| Variable                            | App    | Description                                  | Example                            |
| ----------------------------------- | ------ | -------------------------------------------- | ---------------------------------- |
| `FIREBASE_SERVICE_ACCOUNT`          | server | Full JSON string of Firebase service account | `'{"type":"service_account",...}'` |
| `FIREBASE_SERVICE_ACCOUNT_PATH`     | server | Alternative: path to JSON file               | `./firebase-service-account.json`  |
| `VITE_FIREBASE_API_KEY`             | web    | Firebase client API key                      | `AIzaSy...`                        |
| `VITE_FIREBASE_AUTH_DOMAIN`         | web    | Firebase auth domain                         | `your-project.firebaseapp.com`     |
| `VITE_FIREBASE_PROJECT_ID`          | web    | Firebase project ID                          | `your-project-123`                 |
| `VITE_FIREBASE_STORAGE_BUCKET`      | web    | Firebase storage bucket                      | `your-project.firebasestorage.app` |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | web    | Firebase messaging sender ID                 | `123456789012`                     |
| `VITE_FIREBASE_APP_ID`              | web    | Firebase app ID                              | `1:123456789012:web:abc123`        |

You need **either** `FIREBASE_SERVICE_ACCOUNT` (inline JSON) **or** `FIREBASE_SERVICE_ACCOUNT_PATH` (file path) for the server. Not both.

### Server

| Variable      | Required | Description                                      | Default                 |
| ------------- | -------- | ------------------------------------------------ | ----------------------- |
| `PORT`        | No       | Server port                                      | `3000`                  |
| `CORS_ORIGIN` | Yes      | Allowed CORS origin (must match web URL exactly) | `http://localhost:3001` |

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

The server will start without these keys but AI features will throw errors when called.

### Blockchain (Optional)

| Variable           | App     | Description                                                      |
| ------------------ | ------- | ---------------------------------------------------------------- |
| `PRIVATE_KEY`      | server  | Wallet private key for Synapse/Filecoin uploads (no `0x` prefix) |
| `PONDER_RPC_URL_2` | indexer | Sepolia RPC URL (Alchemy recommended)                            |

### Storage (Optional)

| Variable                  | App    | Description                                     |
| ------------------------- | ------ | ----------------------------------------------- |
| `FIREBASE_STORAGE_BUCKET` | server | Firebase Storage bucket name (for file uploads) |

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

To run the web app and server without AI or blockchain features, you only need:

```env
# Firebase Auth (get from Firebase Console > Project Settings > General)
VITE_FIREBASE_API_KEY=your-api-key
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project
VITE_FIREBASE_STORAGE_BUCKET=your-project.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=123456789
VITE_FIREBASE_APP_ID=1:123456789:web:abc123

# Firebase Admin (get from Firebase Console > Project Settings > Service Accounts)
FIREBASE_SERVICE_ACCOUNT='{"type":"service_account","project_id":"your-project",...}'

# Server
PORT=3000
CORS_ORIGIN=http://localhost:3001

# Web
VITE_SERVER_URL=http://localhost:3000
```

## Getting Firebase Credentials

### 1. Create a Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click **Add project**
3. Name your project and click through the setup wizard

### 2. Enable Authentication

1. In Firebase Console, go to **Authentication** > **Sign-in method**
2. Enable **Email/Password** provider

### 3. Create Firestore Database

1. Go to **Firestore Database** > **Create database**
2. Start in **test mode** for development
3. Choose a location close to your users

### 4. Get Web App Config (VITE\_ vars)

1. Go to **Project Settings** (gear icon) > **General**
2. Under **Your apps**, click **Add app** > **Web** (</> icon)
3. Register the app and copy the config values:
   - `apiKey` → `VITE_FIREBASE_API_KEY`
   - `authDomain` → `VITE_FIREBASE_AUTH_DOMAIN`
   - `projectId` → `VITE_FIREBASE_PROJECT_ID`
   - `storageBucket` → `VITE_FIREBASE_STORAGE_BUCKET`
   - `messagingSenderId` → `VITE_FIREBASE_MESSAGING_SENDER_ID`
   - `appId` → `VITE_FIREBASE_APP_ID`

### 5. Get Service Account Key (server)

1. Go to **Project Settings** > **Service accounts**
2. Click **Generate new private key**
3. Either:
   - Save the JSON file and set `FIREBASE_SERVICE_ACCOUNT_PATH=./firebase-service-account.json`
   - Or paste the entire JSON content as `FIREBASE_SERVICE_ACCOUNT='{ ... }'`

**Important:** Never commit service account keys. The `.gitignore` already excludes `firebase-service-account.json`.
