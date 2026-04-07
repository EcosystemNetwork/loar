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

# Install dependencies (--ignore-scripts: skip husky prepare in Docker)
RUN pnpm install --frozen-lockfile --ignore-scripts

# Copy indexer source
COPY apps/indexer/ ./apps/indexer/

WORKDIR /app/apps/indexer

EXPOSE 42069

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:42069/health || exit 1

CMD ["pnpm", "start"]
