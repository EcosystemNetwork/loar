# Troubleshooting

## Dependency Issues

### "Cannot find module" errors after install

```bash
# Always install from root (not from app directories)
pnpm install

# If that fails, clean and reinstall
rm -rf node_modules apps/*/node_modules packages/*/node_modules
pnpm install
```

### pnpm version mismatch

The project requires pnpm 9.15.0. If you see lockfile or dependency resolution errors:

```bash
corepack enable
corepack prepare pnpm@9.15.0 --activate
pnpm --version  # should print 9.15.0
```

## Port Conflicts

### "EADDRINUSE: address already in use"

Kill the process occupying the port:

```bash
# Server (port 3000)
lsof -ti:3000 | xargs kill -9

# Web (port 3001)
lsof -ti:3001 | xargs kill -9

# Indexer (port 42069)
lsof -ti:42069 | xargs kill -9
```

## Firebase Errors

> **Note:** LOAR uses SIWE (Sign-In With Ethereum) for authentication, not Firebase Auth. Firebase is used only for Firestore (data storage). There are no `VITE_FIREBASE_*` client-side env vars.

### Server crashes: "Cannot read properties of undefined (reading 'getFirestore')"

The `FIREBASE_SERVICE_ACCOUNT` env var is missing or contains invalid JSON. Verify:

```bash
# Test that the JSON parses correctly
node -e "JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)"
```

Or use a file path instead: set `FIREBASE_SERVICE_ACCOUNT_PATH=./firebase-service-account.json`.

### "PERMISSION_DENIED: Missing or insufficient permissions"

Your Firestore security rules are rejecting the request. For development, go to Firebase Console > Firestore > Rules and set:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
```

**Warning:** Only use permissive rules in development. Lock them down for production.

## tRPC / API Errors

### "Failed to fetch" in the web app

The server is not running or the URL is wrong. Check:

1. Is the server running? `make dev-server`
2. Does `VITE_SERVER_URL` match the server URL exactly? (e.g., `http://localhost:3000`)
3. No trailing slash in the URL.

### "UNAUTHORIZED" error

Your SIWE session token (JWT) has expired. Refresh the page to re-authenticate via wallet signature.

### CORS errors in browser console

`CORS_ORIGIN` in `.env` must exactly match the web app URL:

- Correct: `CORS_ORIGIN=http://localhost:3001`
- Wrong: `CORS_ORIGIN=http://localhost:3001/` (trailing slash)
- Wrong: `CORS_ORIGIN=localhost:3001` (missing protocol)

## Ponder Indexer

### "RPC URL missing" or "Network not configured"

Set `PONDER_RPC_URL_2` in `.env` to a Sepolia RPC endpoint:

```env
PONDER_RPC_URL_2=https://eth-sepolia.g.alchemy.com/v2/YOUR_ALCHEMY_KEY
```

Get a free key from [Alchemy](https://www.alchemy.com/).

### Indexer is slow to sync

Ponder rate-limits RPC calls. This is normal for initial sync. The indexer will catch up and then track new blocks in real time.

### Schema changes not reflected

Delete the Ponder cache and restart:

```bash
rm -rf apps/indexer/.ponder
make dev-indexer
```

## Smart Contracts

### "forge: command not found"

Install Foundry:

```bash
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

### Compilation errors

```bash
cd apps/contracts
forge clean
forge build
```

### Tests failing after contract changes

```bash
cd apps/contracts
forge clean
forge build
forge test -vvv
```

## Docker

### Docker build fails

Ensure `pnpm-lock.yaml` is committed. Dockerfiles use `--frozen-lockfile` which requires the lockfile to be present.

```bash
git add pnpm-lock.yaml
```

### Container can't reach host services

Inside Docker containers, use `host.docker.internal` instead of `localhost` to reach services running on the host machine.

### Docker compose environment

The `docker-compose.yml` uses `env_file: ./.env` for server and indexer. The web app bakes env vars at build time (Vite). To update web env vars, rebuild:

```bash
docker compose build app-web
docker compose up -d app-web
```

## TypeScript Errors

### Pre-existing type errors in web app

The web app has known type errors in these files:

- `GenerativeMedia.tsx`
- `GovernanceSidebar.tsx`
- `cdp-auth-button.tsx`
- Various flow components

These are pre-existing and do not block development. They will not prevent `vite dev` from running — only `tsc --noEmit` will report them.

### `@coinbase/cdp-react` not found

This package is referenced in code but not installed. It's a known issue. Ignore the import error if you're not working on Coinbase integration.

## Build Warnings

### Large bundle size warnings

These are expected due to Web3 dependencies:

- MetaMask SDK: ~558KB
- viem/wagmi core: ~1.8MB

Code splitting improvements are planned. These warnings do not indicate a problem.

## Common "Quick Fixes"

| Problem              | Fix                                                     |
| -------------------- | ------------------------------------------------------- |
| Everything is broken | `rm -rf node_modules && pnpm install`                   |
| Server won't start   | Check `.env` has `FIREBASE_SERVICE_ACCOUNT`             |
| Web shows blank page | Check browser console, verify `VITE_` vars in `.env`    |
| tRPC errors          | Verify server is running + `VITE_SERVER_URL` is correct |
| "Module not found"   | Run `pnpm install` from root                            |
| Stale types          | Run `make check-types` to see current state             |
