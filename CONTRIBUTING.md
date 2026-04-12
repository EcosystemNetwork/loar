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

Example pattern — see `apps/server/src/routers/cinematicUniverses/` for a full sub-router example.

### Adding a New Web Route

1. Create a file in `apps/web/src/routes/` (TanStack Router file-based routing)
2. Export a `Route` using `createFileRoute`
3. The route is automatically included in `routeTree.gen.ts`

### Adding a Smart Contract

1. Write the contract in `apps/contracts/src/`
2. Write tests in `apps/contracts/test/`
3. Run tests: `make test-contracts`
4. After deployment, update `wagmi.config.ts` and run `make codegen`

### Adding Environment Variables

1. Add the variable to `.env.example` with a descriptive comment
2. Update `docs/environment.md`
3. For `VITE_` prefixed vars: they are auto-exposed to the web app via Vite
4. For server vars: access via `process.env.YOUR_VAR` (dotenv loads from root `.env`)

## Code Style

- **TypeScript** for all apps (strict mode)
- **Zod** for runtime input validation on tRPC procedures
- **Tailwind CSS** + **shadcn/ui** for frontend components
- **ESM** (ES modules) throughout — use `import`/`export`, not `require`

## Running Checks

Before submitting a PR:

```bash
make check-types    # TypeScript verification
make test           # Smart contract tests
make lint           # Linting
```

Note: There are pre-existing type errors in the web app (GenerativeMedia, GovernanceSidebar, flow components). These do not block development.

## Pull Request Process

1. Fill out the PR template completely
2. Ensure all checks pass
3. Keep PRs focused — one feature or fix per PR
4. Update documentation if you changed behavior or added env vars
5. Request a review

## Project Layout Reference

```
apps/web/src/
├── components/     # React components (ui/, flow/, segments/)
├── lib/            # Firebase client, auth helpers, tRPC client
├── routes/         # File-based routes (TanStack Router)
├── hooks/          # Custom React hooks
├── types/          # TypeScript type definitions
└── utils/          # Utilities (ponder-api, trpc)

apps/server/src/
├── lib/            # Firebase admin, auth, tRPC config, context
├── routers/        # tRPC routers (cinematicUniverses/, fal/)
├── services/       # Business logic (fal, gemini, minio, synapse, wikia)
└── routes/         # REST routes (images)

apps/indexer/
├── src/api/        # Ponder GraphQL API handlers
├── ponder.config.ts
└── ponder.schema.ts

apps/contracts/
├── src/            # Solidity contracts
├── test/           # Foundry tests
└── script/         # Deployment scripts
```
