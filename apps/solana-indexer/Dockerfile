# ── Stage 1: Builder ──────────────────────────────────────────────────────
# Same node:20-slim glibc base as the EVM indexer (apps/indexer/Dockerfile) —
# avoids musl-binding surprises in @solana/web3.js native deps.
FROM node:20-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*
ENV COREPACK_INTEGRITY_KEYS=""
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

# Workspace root + per-package manifests so pnpm can resolve the workspace
# graph. Only the manifests the indexer actually links against are needed.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/solana-indexer/package.json ./apps/solana-indexer/
COPY packages/abis/package.json ./packages/abis/

# Skip husky in CI/container builds.
RUN npm pkg set scripts.prepare="echo skip"
RUN pnpm install --frozen-lockfile

# Copy source. abis is needed for the @loar/abis/chain import.
COPY apps/solana-indexer/src ./apps/solana-indexer/src
COPY apps/solana-indexer/scripts ./apps/solana-indexer/scripts
COPY apps/solana-indexer/tsconfig.json ./apps/solana-indexer/
COPY packages/abis ./packages/abis

# Build TS → dist/. @loar/abis is referenced by source path; tsc resolves it
# through pnpm's workspace symlinks.
RUN pnpm -F @loar/abis build:ts || true
RUN pnpm -F @loar/solana-indexer build

# Drop devDeps to shrink the runtime image.
RUN pnpm prune --prod

# ── Stage 2: Runtime ──────────────────────────────────────────────────────
FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*
ENV COREPACK_INTEGRITY_KEYS=""
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/pnpm-workspace.yaml ./
COPY --from=builder /app/apps/solana-indexer ./apps/solana-indexer
COPY --from=builder /app/packages ./packages

RUN groupadd --gid 1001 appgroup && useradd --uid 1001 --gid appgroup --system --create-home appuser
RUN chown -R appuser:appgroup /app/apps/solana-indexer
USER appuser

WORKDIR /app/apps/solana-indexer

EXPOSE 42070

# /healthz is the indexer's own readiness endpoint (src/index.ts).
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD curl -f http://localhost:42070/healthz || exit 1

CMD ["pnpm", "start"]
