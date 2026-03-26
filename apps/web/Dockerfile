FROM node:20-alpine AS builder

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

# Copy workspace root files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/
COPY apps/server/package.json ./apps/server/
COPY apps/indexer/package.json ./apps/indexer/
COPY packages/abis/package.json ./packages/abis/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY apps/web/ ./apps/web/
COPY packages/abis/src/ ./packages/abis/src/
COPY apps/server/tsconfig.json ./apps/server/tsconfig.json

# Build
RUN cd apps/web && pnpm run build

# Production — lightweight static file server
FROM node:20-alpine AS production

RUN npm i -g serve@14
COPY --from=builder /app/apps/web/dist /app/dist

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget -q --spider http://localhost:3001 || exit 1

CMD ["serve", "-s", "/app/dist", "-l", "3001"]
