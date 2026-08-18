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

RUN npm pkg set scripts.prepare="echo skip"
RUN pnpm install --frozen-lockfile --prod

# Copy indexer source (selective — no vitest.config.ts, no __tests__)
COPY apps/indexer/src/api ./apps/indexer/src/api
COPY apps/indexer/src/index.ts ./apps/indexer/src/
COPY apps/indexer/ponder.config.ts apps/indexer/ponder.schema.ts apps/indexer/ponder-env.d.ts ./apps/indexer/
COPY apps/indexer/env.ts apps/indexer/tsconfig.json ./apps/indexer/
COPY apps/indexer/abis ./apps/indexer/abis
COPY packages/abis/ ./packages/abis/
COPY deployments/ ./deployments/

# ── Stage 2: Production ──────────────────────────────────────────────────
FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*
ENV COREPACK_INTEGRITY_KEYS=""
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

# Copy production node_modules and source from builder
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

CMD ["sh", "-c", "pnpm start --schema \"$RAILWAY_DEPLOYMENT_ID\""]
