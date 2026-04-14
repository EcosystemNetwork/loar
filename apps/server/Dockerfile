FROM node:20.18.1-alpine AS builder

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

# Copy workspace root files + only the packages the server actually needs.
# Stub out other workspace members referenced in pnpm-lock.yaml with
# minimal package.json files so pnpm install --no-frozen-lockfile succeeds
# without needing the full source trees.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json ./apps/server/
COPY packages/abis/package.json ./packages/abis/
COPY packages/shared/package.json ./packages/shared/

# Stub workspace members that exist in the lockfile but aren't needed at runtime
RUN mkdir -p apps/web apps/indexer apps/mcp apps/contracts && \
    echo '{"name":"web","version":"0.0.0","private":true}' > apps/web/package.json && \
    echo '{"name":"indexer","version":"0.0.0","private":true}' > apps/indexer/package.json && \
    echo '{"name":"mcp","version":"0.0.0","private":true}' > apps/mcp/package.json && \
    echo '{"name":"contracts","version":"0.0.0","private":true}' > apps/contracts/package.json

# Install dependencies
# Create a fake .git so husky's prepare script doesn't fail, then clean up
RUN mkdir -p .git && pnpm install --no-frozen-lockfile && rm -rf .git

# Copy source code
COPY apps/server/src ./apps/server/src
COPY apps/server/tsconfig.json ./apps/server/

# Bundle app code only — all node_modules stay external (firebase-admin needs fs paths)
# esbuild is in root devDependencies, installed by pnpm install above
RUN pnpm exec esbuild apps/server/src/index.ts \
  --bundle \
  --platform=node \
  --format=esm \
  --outdir=apps/server/dist \
  --packages=external

# Production stage
FROM node:20.18.1-alpine AS production

RUN apk add --no-cache curl
WORKDIR /app

# Copy workspace root files for pnpm install
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json ./apps/server/
COPY packages/abis/package.json ./packages/abis/
COPY packages/shared/package.json ./packages/shared/

# Stub workspace members (same as builder — only needed for lockfile resolution)
RUN mkdir -p apps/web apps/indexer apps/mcp apps/contracts && \
    echo '{"name":"web","version":"0.0.0","private":true}' > apps/web/package.json && \
    echo '{"name":"indexer","version":"0.0.0","private":true}' > apps/indexer/package.json && \
    echo '{"name":"mcp","version":"0.0.0","private":true}' > apps/mcp/package.json && \
    echo '{"name":"contracts","version":"0.0.0","private":true}' > apps/contracts/package.json

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
# Nuke the prepare script so pnpm doesn't try to run husky (a devDep not installed in --prod)
# This preserves all other lifecycle scripts (postinstall for native addons like keccak)
RUN npm pkg set scripts.prepare="echo skip"
RUN pnpm install --no-frozen-lockfile --prod

# Copy built application
COPY --from=builder /app/apps/server/dist ./apps/server/dist

RUN addgroup -g 1001 -S appgroup && adduser -S appuser -u 1001 -G appgroup
USER appuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

CMD ["node", "apps/server/dist/index.js"]
