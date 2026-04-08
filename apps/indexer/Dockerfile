FROM node:20-alpine

RUN apk add --no-cache curl
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

# Copy workspace root files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/indexer/package.json ./apps/indexer/
COPY apps/server/package.json ./apps/server/
COPY apps/web/package.json ./apps/web/
COPY packages/abis/package.json ./packages/abis/

# Install only indexer + abis deps using pnpm deploy (creates isolated node_modules)
RUN npm pkg set scripts.prepare="echo skip"
RUN pnpm install --frozen-lockfile --filter indexer --filter @loar/abis

# Copy indexer source + shared packages (exclude tests)
COPY apps/indexer/ ./apps/indexer/
RUN rm -rf apps/indexer/src/__tests__
COPY packages/abis/ ./packages/abis/
COPY deployments/ ./deployments/

WORKDIR /app/apps/indexer

EXPOSE 42069

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:42069/health || exit 1

CMD ["pnpm", "start"]
