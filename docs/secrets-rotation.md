# Secrets Rotation Runbook

> Scope: every non-public credential the platform depends on. Written as part
> of the 2026-04-22 security audit response (WEB-9 + USER-ACTION).

## Threat model

A leaked secret is only as dangerous as how long it lives. This runbook exists
so every secret has a documented expected-lifetime, a documented rotation
procedure, and a documented blast-radius if leaked. When we find a
suspected leak, we don't want to invent the rotation steps under pressure.

## Inventory

| Secret                                                                | Lives in                       | Expected lifetime               | Blast radius if leaked                                  | Rotation procedure                |
| --------------------------------------------------------------------- | ------------------------------ | ------------------------------- | ------------------------------------------------------- | --------------------------------- |
| `SIWE_JWT_SECRET`                                                     | Server env                     | 90 days                         | Full user impersonation for token TTL (24h)             | §Rotate `SIWE_JWT_SECRET`         |
| `SIWE_JWT_SECRET_PREVIOUS`                                            | Server env                     | 24h (dual-key window only)      | Same as above                                           | §Rotate `SIWE_JWT_SECRET`         |
| `MCP_KEY_CACHE_SECRET`                                                | Server env                     | 90 days                         | Decrypts cached `loar_*` MCP keys                       | §Rotate `MCP_KEY_CACHE_SECRET`    |
| `MCP_GATEWAY_SERVICE_KEY`                                             | Server env + mcp-gateway env   | 90 days                         | Mints per-wallet MCP API keys                           | §Rotate `MCP_GATEWAY_SERVICE_KEY` |
| `OAUTH_JWT_SECRET`                                                    | mcp-gateway env                | 90 days                         | Forges OAuth tokens issued to MCP clients               | §Rotate `OAUTH_JWT_SECRET`        |
| `PINATA_JWT`                                                          | Server env                     | 180 days                        | Upload/delete on our Pinata account                     | §Rotate `PINATA_JWT`              |
| `PINATA_GATEWAY_TOKEN`                                                | Server env                     | 90 days                         | Unlimited reads through our dedicated gateway           | §Rotate `PINATA_GATEWAY_TOKEN`    |
| `LIGHTHOUSE_API_KEY`                                                  | Server env                     | 180 days                        | Upload to our Lighthouse account                        | §Rotate `LIGHTHOUSE_API_KEY`      |
| `CIRCLE_API_KEY` + entity secret                                      | Server env                     | 90 days                         | Signs server-custodied transactions                     | §Rotate `CIRCLE_*`                |
| `FIREBASE_SERVICE_ACCOUNT`                                            | Server env                     | 180 days or on personnel change | Full Firestore admin                                    | §Rotate Firebase                  |
| `STRIPE_SECRET_KEY`                                                   | Server env                     | 90 days (rolling keys)          | Refund, create charges, read customers                  | §Rotate Stripe                    |
| `STRIPE_WEBHOOK_SECRET`                                               | Server env                     | 180 days                        | Forge webhook events (issue credits)                    | §Rotate Stripe                    |
| `PRIVATE_KEY` (Forge deploy)                                          | ONLY via KMS / hardware wallet | see below                       | Redeploy contracts, drain treasury                      | §Rotate deploy key                |
| `SSH_PRIVATE_KEY` (GitHub Actions deploy)                             | GH Actions secret              | 30 days                         | Full production shell                                   | §Rotate SSH key                   |
| `REDIS_PASSWORD`                                                      | Server env + compose           | 90 days                         | Access to queues, rate-limit state, cached session data | §Rotate Redis                     |
| `ADMIN_ADDRESSES`                                                     | Server env                     | On personnel change             | Admin role on tRPC routes                               | §Rotate admin allowlist           |
| External API keys (OpenAI, Fal, Google, Meshy, ElevenLabs, ByteDance) | Server env                     | 180 days                        | Billed spend                                            | Per-vendor rotation               |

## Standard procedure

All secrets share these requirements:

1. **Generate** on an air-gapped or trusted machine. Use `openssl rand -hex 32`
   for arbitrary secrets (≥32 bytes of entropy). Never use password generators
   that seed from predictable sources.
2. **Stage the new value** in the target environment (Railway / Fly /
   GitHub Actions) as a _new_ env var next to the current one. Do not
   overwrite yet.
3. **Deploy** a change that reads either the new or old value (see dual-key
   procedures below). Verify the new env var is loaded by inspecting
   `/metrics` or the boot log.
4. **Cut over**: rename the new value to the canonical name, remove the old.
   Deploy again.
5. **Revoke** the old secret at the issuer (vendor portal, KMS key, etc.).
6. **Record** rotation in `docs/audit-fix-tracker.md` or the secure ops log
   with timestamp, rotator, reason.

If you skip step 5 (revoke), the leak is still live. This is the most common
mistake.

## Dual-key procedures

### Rotate `SIWE_JWT_SECRET`

JWTs in flight will remain valid until their 24h TTL expires. A naive rotate
instantly logs every user out.

```
# Step 1 — copy current secret aside
SIWE_JWT_SECRET_PREVIOUS=<current value>
SIWE_JWT_SECRET=<new value — openssl rand -hex 32>
# Deploy. Old tokens verify against _PREVIOUS; new tokens sign with the new.

# Step 2 — wait 24h for existing tokens to expire.

# Step 3 — remove SIWE_JWT_SECRET_PREVIOUS. Deploy.
```

Verify `getJwtVerifiers()` in `apps/server/src/lib/siwe.ts` still tries both
during the overlap.

### Rotate `MCP_KEY_CACHE_SECRET`

Cached `loar_*` keys are encrypted with AES-256-GCM keyed off this secret.
Rotating it invalidates every cache entry — users' next MCP request will
re-mint their per-wallet key (no user-facing downtime).

1. Generate a new 32-byte secret.
2. Set `MCP_KEY_CACHE_SECRET` to the new value.
3. Deploy. Cache entries encrypted with the old key fail their GCM tag check
   and are treated as missing (`decryptCachedKey` returns `null`).
4. No dual-key window required; cache miss path is fast.
5. **Never** share or alias with `OAUTH_JWT_SECRET` — this is enforced by
   boot-time validation (see [apps/server/src/lib/env.ts](../apps/server/src/lib/env.ts)).

### Rotate `MCP_GATEWAY_SERVICE_KEY`

This key authenticates server ↔ mcp-gateway. Coordinate both sides or the
gateway will 401 until they match.

1. Generate new 32-byte secret.
2. Update **both** the server and the mcp-gateway env with the new value.
3. Redeploy server first, then mcp-gateway (so a brief window of failed
   pings is on the gateway side, not the server).
4. Revoke old value.

### Rotate `OAUTH_JWT_SECRET`

Rotating invalidates every outstanding MCP OAuth token. Gateway will re-auth
on the next request.

1. Generate a new 32-byte secret.
2. Set `OAUTH_JWT_SECRET` in the mcp-gateway env.
3. Deploy.
4. Ensure `MCP_KEY_CACHE_SECRET !== OAUTH_JWT_SECRET` (the server boot-time
   assertion will trip if equal — see INF-4 fix).

## Per-vendor procedures

### Rotate `PINATA_JWT`

1. In Pinata dashboard → API Keys → _Rotate_ existing key (issues a new
   secret, preserves permissions).
2. Copy new JWT into server env, deploy.
3. **Revoke** the previous key in the Pinata dashboard. Missing this step
   is the entire point of the rotation.

### Rotate `PINATA_GATEWAY_TOKEN`

This is the "free-IPFS-for-anyone" leak vector. Rotate whenever you see
Pinata bandwidth alerts.

1. Pinata dashboard → Gateway → _Rotate dedicated gateway token_.
2. Update `PINATA_GATEWAY_TOKEN` in **server** env only. (WEB-1: never set
   `VITE_PINATA_GATEWAY_TOKEN` in any frontend env.)
3. Deploy.
4. Confirm `/api/ipfs/resolve?url=...` returns a URL with the new token
   query param.

### Rotate `CIRCLE_*` (API key + entity secret)

Server-custodied signing — full fund-control potential. Rotation is annual
or on suspicion.

1. Circle dashboard → API Keys → create new API key with same permissions.
2. Regenerate entity secret (requires re-entering admin passphrase).
3. Update server env.
4. Verify a single test signature via `/api/tx/...` before considering the
   rotation complete.
5. Delete old API key in Circle dashboard.

### Rotate Firebase service account

1. GCP IAM & Admin → Service Accounts → find the LOAR app service account.
2. Keys → _Add key_ → JSON. Download the new file (do not commit).
3. Update `FIREBASE_SERVICE_ACCOUNT` (JSON string) or
   `FIREBASE_SERVICE_ACCOUNT_PATH` in server env.
4. Deploy.
5. Keys → delete the old key.

### Rotate Stripe

Stripe supports "rolling" API keys that both work during a window.

1. Stripe dashboard → Developers → API keys → create rolling secret.
2. Deploy server with new `STRIPE_SECRET_KEY`.
3. Stripe dashboard → revoke old key after 24h.
4. For `STRIPE_WEBHOOK_SECRET`: edit the webhook endpoint → _Rotate signing
   secret_ → overlap for 24h.

## Deploy-path credentials

### Rotate Forge `PRIVATE_KEY` (deploy key)

**Do not leave plaintext deploy keys in env long-term.** The right state is
Foundry `--ledger` for prod deploys or an OIDC-gated remote signer. Until
that's done:

1. Generate a new key via `cast wallet new`.
2. Fund it from treasury (minimum sustained balance, not working balance).
3. Re-run `scripts/deploy-*.sh` to verify the new key works against a
   staging RPC before touching prod.
4. Transfer any owner roles that were assigned to the old key to the new
   key (every contract that has an `owner` or `DEFAULT_ADMIN_ROLE`
   assigned to the old EOA).
5. Drain the old key's balance to treasury.
6. Delete the private key material.

### Rotate `SSH_PRIVATE_KEY` (GitHub Actions)

Authorized_keys on the deploy host must be updated in the same operation.

1. On a trusted laptop: `ssh-keygen -t ed25519 -f ~/.ssh/loar-deploy-new -C "loar-deploy-$(date +%F)"`.
2. SSH into the deploy host with the **existing** key. Append the new
   public key to `~/.ssh/authorized_keys`.
3. Update `SSH_PRIVATE_KEY` secret in GitHub Actions with the new
   private key.
4. Trigger a deploy. Verify it succeeds.
5. Remove the old public key from `authorized_keys` on the deploy host.
6. Delete the old private key material.

Target state: replace with OIDC + cloud IAM, so the workflow never holds a
long-lived key.

### Rotate Redis

Redis is backed by a single password. No overlap window — a moment of 503
is normal.

1. Generate new password (`openssl rand -hex 32`).
2. Update `REDIS_PASSWORD` in server env **and** compose env.
3. `docker compose up -d --force-recreate redis` during a maintenance
   window.
4. Clients reconnect with the new password on next request.

### Rotate admin allowlist

`ADMIN_ADDRESSES` is the source of truth for who can hit
`adminProcedure` routes. Update on any personnel change.

1. Edit `ADMIN_ADDRESSES` env (comma-separated checksummed 0x addresses).
2. Deploy. Server boot-time validation (SRV-3) refuses to start with an
   empty list in production.
3. Immediately verify at least one trusted admin can still reach
   `/admin/moderation` — lockout is the biggest failure mode.

## Detection

Set up the following so we find leaks fast:

- `gitleaks` CI job (see `.github/workflows/security.yml`, INF-7).
- Pinata bandwidth alerts at 2× normal baseline.
- Stripe "Suspicious API usage" email alerts enabled.
- Sentry alert on any `InvalidJwt` / `ExpiredNonce` burst.

## Incident response

If a leak is confirmed:

1. Rotate the affected secret _first_, worry about root cause second.
2. File an entry in `docs/audit-fix-tracker.md` with date, secret name,
   leak source, rotation completion time, evidence.
3. Revoke every dependent credential (see the Inventory table above for
   chains — e.g. `OAUTH_JWT_SECRET` compromise implies rotating every
   cached MCP key as well).
4. Run `git log -S '<leaked-fragment>'` (NOT the full secret) across full
   history to find the commit that introduced it. Do not paste the secret
   value into any log or diff.
