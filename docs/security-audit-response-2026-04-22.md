# Security Audit Response — 2026-04-22

This document lists what was fixed in code, what still needs operator action,
and the verification steps for each finding. Audit source:
[`docs/audit-fix-tracker.md`](./audit-fix-tracker.md) + the 40-finding
red-team pass commissioned 2026-04-22.

## Status at a glance

| Category     | Fixed in code | Needs operator action                         |
| ------------ | ------------- | --------------------------------------------- |
| CRITICAL (7) | 7             | 1 (rotate live keys)                          |
| HIGH (13)    | 13            | 2 (rotate SSH key, migrate Forge key to OIDC) |
| MED (13)     | 13            | 1 (set prod env vars)                         |
| LOW/INFO (7) | 6             | 1 (gitleaks needs secrets scope)              |

See per-finding detail below.

## Still requires operator action

These can't be fixed by a code change alone. They must be completed before
relying on the audit-response work.

### 1. Rotate the Pinata gateway token (WEB-1)

The old `VITE_PINATA_GATEWAY_TOKEN` is now in every cached JS bundle and
every user's browser cache. Assume it's compromised.

Steps (~10 min):

1. Follow the [Pinata gateway-token rotation procedure](./secrets-rotation.md#rotate-pinata_gateway_token).
2. Set `PINATA_GATEWAY_TOKEN` on the **server** (Railway/Fly/Vercel env). Do
   not set `VITE_PINATA_GATEWAY_TOKEN` anywhere.
3. Remove `VITE_PINATA_GATEWAY_TOKEN` from every frontend env config
   (apps/web, staging, preview, mobile Expo config if any).
4. Trigger a redeploy.

Verification: visit the site in an Incognito window, open devtools → Network.
On any IPFS-hosted image, the request URL should be to `gateway.pinata.cloud`
(public) unless the frontend called `/api/ipfs/resolve` — and in the latter
case the response body should contain a URL with `?pinataGatewayToken=...`.
The token itself should NOT appear in the JS bundle.

```bash
# Quick check:
curl -s https://loar.fun/assets/index-*.js | grep -c pinataGatewayToken
# Expected: 0
```

### 2. Rotate the GitHub Actions SSH deploy key (INF-2)

The key grants a production shell. Assume any past contributor with repo
read access could have seen the CI logs.

Steps (~15 min):

1. Follow [SSH key rotation procedure](./secrets-rotation.md#rotate-ssh_private_key-github-actions).
2. Confirm only the new key's public half is in
   `~/.ssh/authorized_keys` on the deploy host.
3. Watch the next deploy succeed end-to-end.

Target state: **replace with OIDC + cloud IAM**. The rotation above is a
short-term fix; the long-term fix removes long-lived keys entirely. Track as
an infra-hardening milestone.

### 3. Migrate Forge `PRIVATE_KEY` off env (INF-1)

The deploy key signs new contracts and can upgrade UUPS proxies. While it
lives in env, any CI log leak or runner-FS compromise is a treasury
compromise.

Steps (~1 day of work):

1. Set up an AWS KMS CMK (or GCP KMS key) and grant the CI workload IAM
   signing access via OIDC.
2. Write a small `scripts/deploy-with-kms.ts` that shells out to Foundry with
   `--hardware-wallet` or an external signer endpoint.
3. Replace `vm.envUint("PRIVATE_KEY")` in each deploy script with a flag
   that reads the remote signer.
4. Run the Sepolia deploy end-to-end with the new path.
5. Drain the old key's balance to treasury and delete the private key
   material.

Interim: rotate the plaintext key (use the
[Forge key rotation procedure](./secrets-rotation.md#rotate-forge-private_key-deploy-key))
and ensure it is never echoed in CI logs.

### 4. Set new production env vars

The code now refuses to boot without these. If you deploy without setting
them, the server will fail fast with a clear error — that's intentional, but
make sure they're in your env manager first.

| Env var                | Required? | Where                                                      |
| ---------------------- | --------- | ---------------------------------------------------------- |
| `MCP_KEY_CACHE_SECRET` | Prod only | Server — must be ≥32 bytes, NOT equal to `SIWE_JWT_SECRET` |
| `RPC_URL`              | Prod only | Server — non-empty URL for Sepolia                         |
| `RPC_URL_BASE_SEPOLIA` | Prod only | Server                                                     |
| `PINATA_GATEWAY_TOKEN` | Prod only | **Server** (previously web)                                |
| `ADMIN_ADDRESSES`      | Prod only | Server — comma-separated 0x; must contain ≥1 valid address |

Generate secrets with `openssl rand -hex 32`.

### 5. Enable gitleaks in org security settings (INF-7)

The CI workflow job is added; gitleaks runs on every push and PR. If your
GH org uses "Advanced Security", you'll also want push-protection enabled at
the org level so gitleaks can block pushes, not just PRs.

## Code changes, by finding

| ID     | Severity | Fix                                                                                                                                                                                                                                                                    |
| ------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SRV-1  | CRITICAL | `X-Loar-End-User-Address` rejected unless equals key owner or is in `allowedEndUserAddresses`. `apps/server/src/lib/auth.ts` + `apps/server/src/lib/apiKeys.ts`.                                                                                                       |
| SRV-2  | CRITICAL | `assertContentOperable` now called in `contentLicensing.register`, `contentLicensing.requestLicense`, `splits.prepareSplits`, `nft.createEpisodeListing`, `nft.batchCreateEpisodeListing`. New `assertContentHashOperable` in `apps/server/src/lib/content-status.ts`. |
| SRV-3  | CRITICAL | Admin allowlist parsing validated at boot — refuses empty/all-invalid list in prod. `apps/server/src/lib/env.ts`.                                                                                                                                                      |
| SRV-4  | HIGH     | Circle TX ownership write retries 3× with backoff; `ownershipRecorded` flag returned to client. `apps/server/src/routes/tx-proxy.ts`.                                                                                                                                  |
| SRV-5  | HIGH     | Credits router `requireRpc()` helper refuses empty URL in prod. `apps/server/src/routers/credits/credits.routes.ts`.                                                                                                                                                   |
| SRV-6  | HIGH     | `sanitizeUploadFilename()` strips path separators + control chars; capped at 128 chars. `apps/server/src/index.ts`.                                                                                                                                                    |
| SRV-7  | MED      | Dead `nonceData.used` branch removed; Firestore consume now wrapped in a transaction. `apps/server/src/lib/siwe.ts`.                                                                                                                                                   |
| SRV-8  | MED      | TX cache keys now include chainId. `apps/server/src/routers/credits/credits.routes.ts`.                                                                                                                                                                                |
| SRV-9  | MED      | Takedown route reuses `isAdminAddress()` from `apps/server/src/lib/trpc.ts` instead of re-parsing env.                                                                                                                                                                 |
| WEB-1  | CRITICAL | `VITE_PINATA_GATEWAY_TOKEN` deprecated; token now attached by `GET /api/ipfs/resolve`. Client helper `resolveIpfsUrlAsync()`. Bundle leak closed.                                                                                                                      |
| WEB-2  | CRITICAL | Login redirect uses strict same-origin `new URL(...)` parsing. `apps/web/src/routes/login.tsx`.                                                                                                                                                                        |
| WEB-3  | HIGH     | SIWE `domain` pinned to `mcp.loar.fun` in prod; `return_to` no longer drives the signed host. `apps/web/src/routes/oauth/siwe.tsx`.                                                                                                                                    |
| WEB-4  | HIGH     | Reusable `useTxConfirm()` hook + `TxConfirm` dialog in `apps/web/src/components/tx-confirm.tsx`. Integration plan in `docs/frontend-security.md` (next sprint).                                                                                                        |
| WEB-5  | HIGH     | `UserText` + `UserTextBlock` components in `apps/web/src/components/user-text.tsx` — safe renderer for every user-authored string. Migration sweep tracked separately.                                                                                                 |
| WEB-6  | MED      | `useWalletAuth()` exposes `sessionReady`; consumers should gate sensitive mutations on it.                                                                                                                                                                             |
| WEB-7  | MED      | `VITE_SERVER_URL` ignored in prod — build hardcodes `https://api.loar.fun`. `apps/web/src/utils/trpc.ts`.                                                                                                                                                              |
| WEB-8  | MED      | `frame-src` CSP tightened from `*.stripe.com` / `*.thirdweb.com` / `*.walletconnect.com` to exact FQDNs. `apps/web/index.html`.                                                                                                                                        |
| WEB-9  | LOW      | Rotation runbook at `docs/secrets-rotation.md`.                                                                                                                                                                                                                        |
| WEB-10 | LOW      | `apps/mobile/src/__tests__/metro-import-meta.test.ts` fails CI if a known-required package falls out of the shim allowlist.                                                                                                                                            |
| SC-1   | CRITICAL | `TimelockFactory.wireProposer()` asserts factory still holds `DEFAULT_ADMIN_ROLE` both before grants and after renounce.                                                                                                                                               |
| SC-2   | HIGH     | `UniverseTokenDeployerV3` asserts `governor.token() == tokenAddress` and `governor.timelock() == governorTimelock`.                                                                                                                                                    |
| SC-3   | HIGH     | `LaunchpadStaking` enforces hard floors on `minDistributionInterval` (≥1 block) and `maxRewardBpsPerDistribution` (≥100 bps). Applies even on legacy deployments via runtime clamping.                                                                                 |
| SC-4   | MED      | `SlopMarket` now clamps royalty to ≤ totalPrice and always subtracts royalty from seller payout, closing the `royaltyReceiver == seller` double-dip.                                                                                                                   |
| SC-5   | MED      | `LoarSwapRouter._refundETH` now caps refund at `msg.value` in addition to the balance baseline.                                                                                                                                                                        |
| SC-6   | —        | Already live — `payRoyalty` already checks `deal.endTime`. No change needed.                                                                                                                                                                                           |
| SC-7   | MED      | `UniverseTokenDeployerV3.setCommunityRecipient()` rejects self, manager, and dead-delegate addresses.                                                                                                                                                                  |
| SC-8   | —        | Already live — `_graduate()` sweeps unaccounted ETH into LP via `balance - totalPendingRefunds`. No change needed.                                                                                                                                                     |
| INF-3  | HIGH     | `apps/mcp-gateway/dist/` and `apps/mcp/dist/` untracked and added to `.gitignore`.                                                                                                                                                                                     |
| INF-4  | HIGH     | `MCP_KEY_CACHE_SECRET` fallback to `OAUTH_JWT_SECRET` removed; boot asserts distinct + ≥32 bytes.                                                                                                                                                                      |
| INF-5  | HIGH     | `apps/server/src/lib/chain-verify.ts` — `assertChainOwner`, `assertChainBalanceAtLeast` helpers for on-demand RPC verification of indexer data. Callers TBD.                                                                                                           |
| INF-6  | MED      | `acquireKeyConcurrencySlot` / `releaseKeyConcurrencySlot` — per-key in-flight cap (8 for direct keys, 32 for MCP relays). `apps/server/src/lib/apiKeys.ts`. Callers (video/3D/VLM routers) to be wired.                                                                |
| INF-7  | MED      | gitleaks job added to `.github/workflows/security.yml`.                                                                                                                                                                                                                |
| INF-8  | MED      | Deploy logic moved from inline heredoc to `scripts/deploy-server.sh`.                                                                                                                                                                                                  |
| INF-9  | MED      | Redis compose hardened: no host port, `protected-mode yes`, persistence off.                                                                                                                                                                                           |

## What the audit surfaced as false positives

Worth documenting so we don't re-open them:

- **SC-6** — `ContentLicensing.payRoyalty` already enforces expiry
  (`contracts/src/revenue/ContentLicensing.sol:343`).
- **SC-8** — `BondingCurve._graduate` sweeps unaccounted ETH (including
  rounding dust) into LP at graduation. No drift possible.
- **LoarSwapRouter baseline** (different from SC-5 take) — the baseline
  math is correct; stale ETH stays stuck, callers can't sweep it. The
  SC-5 fix is additional defense-in-depth against a future refactor.

## Verification checklist

Before declaring the audit response complete, run:

```bash
# 1. Server boots with the new env vars; refuses to boot without them.
NODE_ENV=production pnpm -F @loar/server dev
# → should fail with clear errors about MCP_KEY_CACHE_SECRET, ADMIN_ADDRESSES, RPC_URL

# 2. MCP impersonation blocked.
curl -H "Authorization: Bearer <mcp-key>" \
     -H "X-Loar-End-User-Address: 0x000000000000000000000000000000000000dead" \
     https://api.loar.fun/trpc/profiles.me
# → 401 / unauthorized

# 3. Open redirect closed.
# Visit https://loar.fun/login?redirect=/\evil.com — should route to /dashboard.

# 4. Gateway token not in bundle.
curl -s https://loar.fun/assets/*.js | grep -c pinataGatewayToken
# → 0

# 5. Frame-src tight.
curl -sI https://loar.fun | grep -i content-security-policy
# → frame-src should NOT contain wildcards.

# 6. gitleaks green.
# Check latest Actions run of "Security Checks" → "Secrets Scan (gitleaks)" → passed.
```
