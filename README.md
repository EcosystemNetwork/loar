# LOAR: Decentralized Narrative Control Suite

<div align="center">

![LOAR Banner](https://fungerbil.com/LOARLOGO.png)

### _Empowering Creators to Build Collaborative Cinematic Universes_

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![pnpm 9.15.0](https://img.shields.io/badge/pnpm-9.15.0-orange)](https://pnpm.io/)
[![Node 18+](https://img.shields.io/badge/Node.js-18%2B-green)](https://nodejs.org/)
[![Sepolia Testnet](https://img.shields.io/badge/Network-Sepolia-blue)](https://sepolia.etherscan.io/)

</div>

## Overview

LOAR is a decentralized platform for collaborative cinematic universe creation. Communities build narrative worlds with AI-generated video content, on-chain governance, and censorship-resistant storage. Think Naver Webtoons meets TikTok, powered by Web3.

**Four pillars:** Consumption (AI-generated video) | Production (accessible AI tooling + crypto incentives) | Discussion (storyline & canon debate) | Speculation (universe token trading)

**Domain:** [loartech.xyz](https://loartech.xyz) (Sepolia testnet)

## Architecture

| App              | Stack                                                                   | Port  | Description              |
| ---------------- | ----------------------------------------------------------------------- | ----- | ------------------------ |
| `apps/web`       | React 18, Vite, TanStack Router/Query, wagmi, RainbowKit, Firebase Auth | 3001  | Frontend SPA             |
| `apps/server`    | Hono, tRPC, Firebase Admin (Firestore + Auth)                           | 3000  | API server               |
| `apps/indexer`   | Ponder v0.15, GraphQL (Sepolia)                                         | 42069 | Blockchain indexer       |
| `apps/contracts` | Foundry, Solidity                                                       | -     | Smart contracts          |
| `packages/abis`  | Auto-generated wagmi hooks                                              | -     | Shared contract bindings |

## Quick Start

```bash
git clone <repo-url>
cd loar
bash setup.sh    # or: make setup
pnpm dev         # start all services
```

The setup script checks prerequisites, copies `.env.example` to `.env`, and installs dependencies. Fill in your Firebase credentials in `.env` before running.

## Prerequisites

| Tool                 | Required | Notes                                                                                              |
| -------------------- | -------- | -------------------------------------------------------------------------------------------------- |
| **Node.js** >= 18    | Yes      | [nodejs.org](https://nodejs.org/)                                                                  |
| **pnpm** 9.15.0      | Yes      | Auto-installed via `corepack` during setup                                                         |
| **Foundry**          | Optional | For smart contract development. [Install](https://book.getfoundry.sh/getting-started/installation) |
| **Docker**           | Optional | For containerized deployment                                                                       |
| **Firebase project** | Yes      | For Auth + Firestore. See [docs/environment.md](docs/environment.md)                               |

## Project Structure

```
loar/
├── apps/
│   ├── web/             # React frontend (Vite + TanStack Router)
│   ├── server/          # Hono + tRPC API server
│   ├── indexer/         # Ponder blockchain indexer
│   └── contracts/       # Foundry/Solidity smart contracts
├── packages/
│   └── abis/            # Generated wagmi hooks + contract ABIs
├── docs/                # Architecture, API, troubleshooting
├── .env.example         # Environment variable template
├── setup.sh             # First-time setup script
├── Makefile             # Command shortcuts (make help)
├── docker-compose.yml   # Container orchestration
└── turbo.json           # Turbo build config
```

## Common Commands

Run `make help` to see all commands. Highlights:

| Command            | Description                                 |
| ------------------ | ------------------------------------------- |
| `make dev`         | Start all services (web + server + indexer) |
| `make dev-web`     | Start web app only (port 3001)              |
| `make dev-server`  | Start server only (port 3000)               |
| `make build`       | Build all apps                              |
| `make check-types` | TypeScript type checking                    |
| `make test`        | Run smart contract tests                    |
| `make docker-up`   | Start Docker containers                     |
| `make codegen`     | Generate wagmi hooks from ABIs              |
| `make db-seed`     | Seed Firestore with sample data             |

## Environment Setup

All apps read from a single `.env` file at the repository root. Copy from the template:

```bash
cp .env.example .env
```

At minimum, you need Firebase credentials to run the app. See [docs/environment.md](docs/environment.md) for the full variable reference and Firebase setup walkthrough.

## Smart Contracts

Deployed on Sepolia testnet:

- **UniverseManager** — Factory for deploying cinematic universes
- **Universe** — Manages narrative nodes and canonization
- **UniverseTokenDeployer** — Deploys governance ERC20 tokens
- **GovernanceERC20** — Voting-power tokens
- **UniverseGovernor** — On-chain governance (OpenZeppelin Governor)
- **LoarHookStaticFee** — Uniswap v4 fee hook
- **LoarFeeLocker** — Fee escrow
- **LoarLpLockerMultiple** — LP token locking

See [docs/contracts.md](docs/contracts.md) for development and deployment guides.

## Auth Flow

```
Firebase Auth (client) -> getIdToken() -> Authorization: Bearer <token> -> server verifyIdToken()
```

The web app authenticates via Firebase Auth (email/password). Each tRPC request attaches the Firebase ID token as a Bearer header. The server verifies it via `firebase-admin`. See [docs/architecture.md](docs/architecture.md) for details.

## Documentation

| Document                                   | Description                                   |
| ------------------------------------------ | --------------------------------------------- |
| [Architecture](docs/architecture.md)       | System design, auth flow, service connections |
| [Environment](docs/environment.md)         | All env vars, Firebase setup guide            |
| [API Reference](docs/api.md)               | REST + tRPC + GraphQL endpoints               |
| [Smart Contracts](docs/contracts.md)       | Contract guide, ABI generation                |
| [Database](docs/database.md)               | Firestore + Ponder schema reference           |
| [Deployment](docs/deployment.md)           | Docker, CI/CD, manual deploy                  |
| [Troubleshooting](docs/troubleshooting.md) | Common errors and fixes                       |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on branching, commits, adding features, and submitting PRs.

## License

This project is licensed under the MIT License.
