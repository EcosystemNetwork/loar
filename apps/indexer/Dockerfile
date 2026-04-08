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

# Strip devDeps (vitest conflicts with Ponder's vite-node) and skip husky
RUN npm pkg set scripts.prepare="echo skip"
RUN node -e "const p=require('./apps/indexer/package.json');delete p.devDependencies;require('fs').writeFileSync('./apps/indexer/package.json',JSON.stringify(p,null,2))"
RUN pnpm install --no-frozen-lockfile

# Copy indexer source + shared packages (exclude tests and vitest config)
COPY apps/indexer/src ./apps/indexer/src
COPY apps/indexer/ponder.config.ts apps/indexer/ponder.schema.ts apps/indexer/ponder-env.d.ts ./apps/indexer/
COPY apps/indexer/env.ts apps/indexer/tsconfig.json ./apps/indexer/
COPY apps/indexer/abis ./apps/indexer/abis
RUN rm -rf apps/indexer/src/__tests__
COPY packages/abis/ ./packages/abis/
COPY deployments/ ./deployments/

WORKDIR /app/apps/indexer

EXPOSE 42069

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:42069/health || exit 1

CMD ["pnpm", "start"]
