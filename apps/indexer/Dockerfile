# ── Stage 1: Builder ──────────────────────────────────────────────────────
# Debian slim (glibc), not alpine (musl). Vite 8+ pulls in rolldown, whose
# platform-specific native bindings ship as optionalDependencies. On alpine
# the musl binding (@rolldown/binding-linux-x64-musl) failed to resolve at
# runtime even with optional deps preserved — swapping to glibc sidesteps
# the entire class of musl-binding issues common in the Node ecosystem.
FROM node:20-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*
ENV COREPACK_INTEGRITY_KEYS=""
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

# Copy workspace root files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/indexer/package.json ./apps/indexer/
COPY apps/server/package.json ./apps/server/
COPY apps/web/package.json ./apps/web/
COPY apps/mcp/package.json ./apps/mcp/
COPY apps/contracts/package.json ./apps/contracts/
COPY packages/abis/package.json ./packages/abis/
COPY packages/shared/package.json ./packages/shared/

# Remove vitest from indexer devDeps (conflicts with Ponder's vite-node) and skip husky.
#
# NOTE on --no-frozen-lockfile: the in-container `delete p.devDependencies.vitest`
# above mutates apps/indexer/package.json at build time, so the lockfile is
# intentionally out of sync with the on-disk manifest. `--frozen-lockfile`
# would fail the install. Supply-chain risk is bounded because the monorepo
# lockfile is still committed and is what ships for every OTHER workspace —
# only the indexer's devDeps diverge, and `pnpm prune --prod` on line 46
# drops all devDeps before the image is promoted. Do NOT flip this flag
# without also finding a way to strip vitest from the lockfile pre-install.
RUN npm pkg set scripts.prepare="echo skip"
RUN node -e "\
  const fs=require('fs'); \
  const p=JSON.parse(fs.readFileSync('./apps/indexer/package.json')); \
  if(p.devDependencies)delete p.devDependencies.vitest; \
  fs.writeFileSync('./apps/indexer/package.json',JSON.stringify(p,null,2))"
RUN pnpm install --no-frozen-lockfile

# Copy indexer source (selective — no vitest.config.ts, no __tests__)
COPY apps/indexer/src/api ./apps/indexer/src/api
COPY apps/indexer/src/index.ts ./apps/indexer/src/
COPY apps/indexer/ponder.config.ts apps/indexer/ponder.schema.ts apps/indexer/ponder-env.d.ts ./apps/indexer/
COPY apps/indexer/env.ts apps/indexer/tsconfig.json ./apps/indexer/
COPY apps/indexer/abis ./apps/indexer/abis
COPY packages/abis/ ./packages/abis/
COPY deployments/ ./deployments/

# Prune dev dependencies. Keep optional deps — rolldown (and other build
# tools) ship their platform-specific native bindings as optionalDependencies,
# so --no-optional strips @rolldown/binding-linux-x64-musl and the indexer
# crashes at startup with MODULE_NOT_FOUND.
RUN pnpm prune --prod

# ── Stage 2: Production ──────────────────────────────────────────────────
FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*
ENV COREPACK_INTEGRITY_KEYS=""
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

# Copy pruned node_modules and source from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/pnpm-workspace.yaml ./
COPY --from=builder /app/apps/indexer ./apps/indexer
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/deployments ./deployments

RUN groupadd --gid 1001 appgroup && useradd --uid 1001 --gid appgroup --system --create-home appuser
RUN chown -R appuser:appgroup /app/apps/indexer
USER appuser

WORKDIR /app/apps/indexer

EXPOSE 42069

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:42069/health || exit 1

CMD ["pnpm", "start"]
