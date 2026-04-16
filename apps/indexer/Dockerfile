# ── Stage 1: Builder ──────────────────────────────────────────────────────
FROM node:20.18.1-alpine AS builder

RUN apk add --no-cache curl
ENV COREPACK_INTEGRITY_KEYS=0
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

# Remove vitest from indexer devDeps (conflicts with Ponder's vite-node) and skip husky
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

# Prune dev dependencies
RUN pnpm prune --prod --no-optional

# ── Stage 2: Production ──────────────────────────────────────────────────
FROM node:20.18.1-alpine

RUN apk add --no-cache curl
ENV COREPACK_INTEGRITY_KEYS=0
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

# Copy pruned node_modules and source from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/pnpm-workspace.yaml ./
COPY --from=builder /app/apps/indexer ./apps/indexer
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/deployments ./deployments

RUN addgroup -g 1001 -S appgroup && adduser -S appuser -u 1001 -G appgroup
RUN chown -R appuser:appgroup /app/apps/indexer
USER appuser

WORKDIR /app/apps/indexer

EXPOSE 42069

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:42069/health || exit 1

CMD ["pnpm", "start"]
