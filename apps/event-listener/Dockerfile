FROM node:20.18.1-alpine AS builder

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/event-listener/package.json ./apps/event-listener/
COPY apps/server/package.json ./apps/server/
COPY apps/web/package.json ./apps/web/
COPY apps/indexer/package.json ./apps/indexer/
COPY apps/mcp/package.json ./apps/mcp/
COPY apps/mcp-gateway/package.json ./apps/mcp-gateway/
COPY apps/contracts/package.json ./apps/contracts/
COPY packages/abis/package.json ./packages/abis/
COPY packages/shared/package.json ./packages/shared/

RUN mkdir -p .git && npm pkg set scripts.prepare="echo skip" && \
    pnpm install --frozen-lockfile --filter "event-listener..." && \
    rm -rf .git

COPY apps/event-listener/src ./apps/event-listener/src
COPY apps/event-listener/tsconfig.json ./apps/event-listener/
COPY packages/abis/ ./packages/abis/
COPY deployments/ ./deployments/

RUN pnpm --filter event-listener build

FROM node:20.18.1-alpine AS production

RUN apk add --no-cache curl
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/event-listener/package.json ./apps/event-listener/
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
    pnpm install --no-frozen-lockfile --prod --filter "event-listener..."

COPY --from=builder /app/apps/event-listener/dist ./apps/event-listener/dist
COPY --from=builder /app/deployments ./deployments

RUN addgroup -g 1001 -S appgroup && adduser -S appuser -u 1001 -G appgroup
USER appuser

EXPOSE 3400

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:${PORT:-3400}/health || exit 1

CMD ["node", "apps/event-listener/dist/index.js"]
