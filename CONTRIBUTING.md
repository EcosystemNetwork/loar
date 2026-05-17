# Contributing to LOAR

Thanks for your interest in contributing! This guide covers how to set up, develop, and submit changes.

## Getting Started

1. **Fork** the repository and clone your fork
2. Run `bash setup.sh` (checks prerequisites, installs dependencies, creates `.env`)
3. Fill in your Firebase credentials in `.env` (see [docs/environment.md](docs/environment.md))
4. Create a feature branch:
   ```bash
   git checkout -b feat/your-feature
   ```
5. Start developing: `make dev`

## Branch Naming

Use prefixed branch names:

| Prefix      | Purpose                                 |
| ----------- | --------------------------------------- |
| `feat/`     | New features                            |
| `fix/`      | Bug fixes                               |
| `docs/`     | Documentation changes                   |
| `refactor/` | Code restructuring (no behavior change) |
| `chore/`    | Build, CI, dependency updates           |

## Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add video generation queue
fix: resolve CORS error on tRPC requests
docs: update API reference with new wiki endpoints
refactor: extract auth middleware into shared module
chore: upgrade pnpm to 9.15.0
```

## Development Workflow

### Adding a New tRPC Endpoint

1. Create a router file in `apps/server/src/routers/` (or add to an existing one)
2. Define Zod input/output schemas
3. Register it in `apps/server/src/routers/index.ts` on the `appRouter`
4. Use it in the frontend via the tRPC client (`apps/web/src/utils/trpc.ts`)

Example pattern — see `apps/server/src/routers/universes/` for a full sub-router example. For a router that fans out to multiple AI backends with credit metering, see `apps/server/src/routers/generation/`.

### Adding a New Web Route

1. Create a file in `apps/web/src/routes/` (TanStack Router file-based routing)
2. Export a `Route` using `createFileRoute`
3. The route is automatically included in `routeTree.gen.ts`

### Adding a Smart Contract

1. Write the contract in `apps/contracts/src/`
2. Write tests in `apps/contracts/test/`
3. Run tests: `make test-contracts` (or `FOUNDRY_PROFILE=test forge build` if you hit the Solc 0.8.30 "Tag too large" IR bug)
4. **Before any state-changing change to an existing contract**, check the storage layout against `apps/contracts/storage-layouts/baseline/` — the CI security workflow enforces this
5. After deployment, update `wagmi.config.ts` and run `make codegen`

### Adding an Anchor / Solana Program

1. Write the program in `apps/programs/programs/<name>/`
2. Add an entry to `apps/programs/Anchor.toml`
3. `anchor build && anchor test` (devnet config)
4. Update the corresponding server glue in `apps/server/src/services/solana/`
5. See [`docs/prd-solana-native-sdk-glue.md`](docs/prd-solana-native-sdk-glue.md) for the glue-layer conventions

### Adding a Metered AI Pipeline

1. Use the centralized reservation service — `reserve` → invoke provider → `reconcile` — never inline the credit math
2. Register the model in the appropriate registry under `apps/server/src/services/{image,audio,transcription}-models/registry.ts`
3. If it's a BYOK-able provider, wire it through `apps/server/src/services/provider-keys/dispatcher.ts` so user keys are picked first
4. See [`docs/prd-model-metering.md`](docs/prd-model-metering.md) for the full contract

### Adding Environment Variables

1. Add the variable to `.env.example` with a descriptive comment
2. Update `docs/environment.md`
3. For `VITE_` prefixed vars: they are auto-exposed to the web app via Vite
4. For server vars: access via `process.env.YOUR_VAR` (dotenv loads from root `.env`)
5. Never commit secrets — `.env` is gitignored; CI uses GitHub Actions secrets

## Code Style

- **TypeScript** for all apps (strict mode)
- **Zod** for runtime input validation on tRPC procedures
- **Tailwind CSS** + **shadcn/ui** for frontend components
- **ESM** (ES modules) throughout — use `import`/`export`, not `require`

## Running Checks

Before submitting a PR:

```bash
make check-types    # TypeScript verification (web + server should both pass)
make test           # Smart contract tests
make lint           # Linting
pnpm smoke          # Optional: end-to-end testnet smoke harness (7 layers, seeded wallets)
```

Run [`gitnexus_detect_changes()`](AGENTS.md) before committing if you're touching code paths flagged by `gitnexus_impact` as HIGH/CRITICAL — the project is indexed and the impact graph catches cross-module breakage that the type checker misses.

Before editing a smart contract, also follow the [`AGENTS.md`](AGENTS.md) protocol: run impact analysis, then check the storage layout against the baseline in `apps/contracts/storage-layouts/baseline/`.

## Pull Request Process

1. Fill out the PR template completely
2. Ensure all checks pass
3. Keep PRs focused — one feature or fix per PR
4. Update documentation if you changed behavior or added env vars
5. Request a review

## Project Layout Reference

```
apps/web/src/
├── components/         # React components (ui/, flow/, voice-studio/, segments/)
│   └── voice-studio/   # CaptionsPanel, VoiceLibrary, ScriptEditor, MultilingualPanel, etc.
├── lib/                # wallet-auth (SIWE), tRPC client, Firebase client
├── routes/             # File-based routes (TanStack Router, 65+ pages)
├── hooks/              # Custom React hooks (useWalletAuth, useCircleWrite, useCircleSolanaAddress)
└── utils/              # trpc, ponder-api

apps/server/src/
├── lib/                # Firebase admin, SIWE auth, tRPC config, context, byok
├── routers/            # tRPC routers (90+, grouped by domain: universes/, generation/, marketplace/, ...)
│   └── generation/     # image / video / voice / threed / captions / lipsync / cutdown / talking-scene
├── services/           # Business logic
│   ├── provider-keys/  # BYOK single source of truth (AES-256-GCM, dispatcher)
│   ├── image-models/   # Registry + types for image backends
│   ├── audio-models/   # Registry + types for audio backends
│   ├── transcription-models/  # 4-backend caption registry (FAL/AssemblyAI/Deepgram/Groq)
│   ├── storage/        # Pinata / Lighthouse / Firebase fallback chain
│   ├── solana/         # Anchor program glue, bridge, attestation
│   └── ...             # gemini, vlm, canon-check, tripo3d, meshy, elevenlabs, etc.
└── routes/             # Direct Hono REST routes (uploads, Solana writes, webhooks)

apps/indexer/
├── src/api/            # Ponder GraphQL API handlers
├── ponder.config.ts
└── ponder.schema.ts

apps/contracts/
├── src/                # Solidity contracts (69, upgradeable via UUPS + Beacon)
├── test/               # Foundry tests
├── script/             # Deployment scripts
└── storage-layouts/baseline/  # 15 layout snapshots — CI diffs against these

apps/programs/          # Anchor / Solana workspace (16 programs on devnet)
├── programs/
│   ├── universe/  episode/  payment/  canon_market/  licensing/
│   ├── staking/   subscription/  credit_manager/  collab_manager/
│   ├── split_router/  rights/  fee_locker/  bonding_curve/
│   ├── remix_fees/  premium_actions/
└── Anchor.toml

apps/mcp/               # MCP server (25+ tools for AI agents, +6 Solana tools)
apps/mobile/            # Expo 52 / React Native (iOS + Android, Circle DCW)
scripts/                # Ops scripts: smoke harness, reattribution, recovery
```
