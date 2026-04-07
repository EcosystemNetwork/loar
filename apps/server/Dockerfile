FROM node:20-alpine AS builder

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

# Copy workspace root files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json ./apps/server/
COPY apps/web/package.json ./apps/web/
COPY apps/indexer/package.json ./apps/indexer/
COPY packages/abis/package.json ./packages/abis/

# Install dependencies
# Create a fake .git so husky's prepare script doesn't fail, then clean up
RUN mkdir -p .git && pnpm install --frozen-lockfile && rm -rf .git

# Copy source code
COPY apps/server/src ./apps/server/src
COPY apps/server/tsconfig.json ./apps/server/

# Bundle with esbuild for node target
# Install esbuild directly (it's a transitive dep via tsx, not exposed as a workspace bin)
RUN pnpm add -w -D esbuild && pnpm exec esbuild apps/server/src/index.ts \
  --bundle \
  --platform=node \
  --format=esm \
  --outdir=apps/server/dist \
  --external:better-sqlite3

# Production stage
FROM node:20-alpine AS production

RUN apk add --no-cache curl
WORKDIR /app

# Copy workspace root files for pnpm install
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json ./apps/server/
COPY apps/web/package.json ./apps/web/
COPY apps/indexer/package.json ./apps/indexer/
COPY packages/abis/package.json ./packages/abis/

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
RUN pnpm install --frozen-lockfile --prod --ignore-scripts

# Copy built application
COPY --from=builder /app/apps/server/dist ./apps/server/dist

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

CMD ["node", "apps/server/dist/index.js"]
