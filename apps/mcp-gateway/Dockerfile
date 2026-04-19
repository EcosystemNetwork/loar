# syntax=docker/dockerfile:1.6
#
# LOAR MCP Gateway — production image for Railway / Fly / Render.
#
# Build: from the monorepo root, `docker build -f apps/mcp-gateway/Dockerfile .`
# The Docker context MUST be the repo root so pnpm-workspace can resolve the
# `@loar/mcp-server` workspace dependency.

FROM node:20.18.1-alpine AS builder

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

# Lockfile + every workspace member's package.json so `--frozen-lockfile`
# resolves against the exact same tree committed to git.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json ./apps/server/
COPY apps/web/package.json ./apps/web/
COPY apps/indexer/package.json ./apps/indexer/
COPY apps/mcp/package.json ./apps/mcp/
COPY apps/mcp-gateway/package.json ./apps/mcp-gateway/
COPY apps/contracts/package.json ./apps/contracts/
COPY packages/abis/package.json ./packages/abis/
COPY packages/shared/package.json ./packages/shared/

# Stub out husky so `pnpm install` doesn't fail without a .git directory.
RUN mkdir -p .git && npm pkg set scripts.prepare="echo skip" && \
    pnpm install --frozen-lockfile --filter "@loar/mcp-gateway..." && \
    rm -rf .git

# Source for gateway + its workspace dep.
COPY apps/mcp-gateway/src ./apps/mcp-gateway/src
COPY apps/mcp-gateway/tsconfig.json ./apps/mcp-gateway/
COPY apps/mcp/src ./apps/mcp/src
COPY apps/mcp/tsconfig.json ./apps/mcp/

# Build the workspace dep first, then the gateway.
RUN pnpm --filter @loar/mcp-server build && \
    pnpm --filter @loar/mcp-gateway build

# ── Production ────────────────────────────────────────────────────────
FROM node:20.18.1-alpine AS production

RUN apk add --no-cache curl
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json ./apps/server/
COPY apps/web/package.json ./apps/web/
COPY apps/indexer/package.json ./apps/indexer/
COPY apps/mcp/package.json ./apps/mcp/
COPY apps/mcp-gateway/package.json ./apps/mcp-gateway/
COPY apps/contracts/package.json ./apps/contracts/
COPY packages/abis/package.json ./packages/abis/
COPY packages/shared/package.json ./packages/shared/

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate && \
    npm pkg set scripts.prepare="echo skip" && \
    pnpm install --frozen-lockfile --prod --filter "@loar/mcp-gateway..."

COPY --from=builder /app/apps/mcp-gateway/dist ./apps/mcp-gateway/dist
COPY --from=builder /app/apps/mcp/dist ./apps/mcp/dist

RUN addgroup -g 1001 -S appgroup && adduser -S appuser -u 1001 -G appgroup
USER appuser

EXPOSE 3334

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:${PORT:-3334}/health || exit 1

CMD ["node", "apps/mcp-gateway/dist/src/index.js"]
