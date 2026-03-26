FROM node:20-alpine

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

# Copy workspace root files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/indexer/package.json ./apps/indexer/
COPY apps/server/package.json ./apps/server/
COPY apps/web/package.json ./apps/web/
COPY packages/abis/package.json ./packages/abis/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy indexer source
COPY apps/indexer/ ./apps/indexer/

WORKDIR /app/apps/indexer

EXPOSE 42069

CMD ["pnpm", "start"]
