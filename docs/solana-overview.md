# Solana on LOAR — Overview

LOAR runs natively on Solana alongside its existing EVM stack. This page is
the umbrella — what's deployed, what each piece does, and where to dive in.

## TL;DR

| Layer                                  | Status               | Devnet address                                                                                                                                    |
| -------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Universe program                       | ✅ live              | [`6YTQVSeauk4x5gycMM2wzkR8mdHEnHAYsz3Ygg26UPtD`](https://explorer.solana.com/address/6YTQVSeauk4x5gycMM2wzkR8mdHEnHAYsz3Ygg26UPtD?cluster=devnet) |
| Episode program (Bubblegum cNFT mints) | ✅ live              | [`voLiAXoYbq8go1CUS9UshQRZnNu9Y44qNBZ6czgn8Bs`](https://explorer.solana.com/address/voLiAXoYbq8go1CUS9UshQRZnNu9Y44qNBZ6czgn8Bs?cluster=devnet)   |
| Payment program (PaymentRouter sister) | ✅ live              | [`9xWo4djcHmGFkJnLQF9phdpsUhj6BQFW6yR8sHUsKVbj`](https://explorer.solana.com/address/9xWo4djcHmGFkJnLQF9phdpsUhj6BQFW6yR8sHUsKVbj?cluster=devnet) |
| $LOAR (Token-2022)                     | ✅ live, mint locked | [`482ScJ9EffmyWRWhVsysrPBw3LPDdUXuRL1rXoAx1tez`](https://explorer.solana.com/address/482ScJ9EffmyWRWhVsysrPBw3LPDdUXuRL1rXoAx1tez?cluster=devnet) |
| Bubblegum merkle tree                  | ✅ live, 16k slots   | [`Dmn6X8ToDwG6VcawQ6prpm6rV3KYBdoV31RQQFrx1Tu2`](https://explorer.solana.com/address/Dmn6X8ToDwG6VcawQ6prpm6rV3KYBdoV31RQQFrx1Tu2?cluster=devnet) |

**Live dashboard:** [`/solana`](../apps/web/src/routes/solana.tsx) on the
web app — auto-refreshes every 10s with totals + recent activity +
treasury balance.

## Architecture

```
                          LOAR — multi-chain identity
                                    │
            ┌───────────────────────┼─────────────────────┐
            │                       │                     │
         EVM ($LOAR ERC20)     Auth + Identity       Solana ($LOAR SPL Token-2022)
        Sepolia + Base SP    SIWE / SIWS / Circle    devnet (mainnet pending)
            │                       │                     │
   ┌────────┴────────┐               │           ┌─────────┴──────────┐
   │ Universe.sol    │       Single JWT carries  │  universe          │
   │ Episode.sol     │       ns + evm + sol      │  episode (cNFTs)   │
   │ PaymentRouter.sol│      claims (linked)     │  payment           │
   │ ...             │                            │  $LOAR Token-2022  │
   └─────────────────┘                            │  Bubblegum tree    │
            │                                     │  Squads multisigs  │
            │                                     │  Solana Pay        │
            │                                     │  Attestation       │
            │                                     └────────┬───────────┘
            │                                              │
            └─── Custodial bridge (lock-and-mint) ─────────┘
                  testnet today, Wormhole NTT planned for mainnet
```

Everything is **server-signed via Circle Developer Controlled Wallets** on
both chains, so users only need email/social/wallet for auth — they never
hold private keys to sign individual txs. This is the same custody model
LOAR uses on EVM, extended to Solana.

## What each component is for

### Anchor programs (`apps/programs/`)

- **`universe`** — Canonical IP container PDA per universe. Tracks creator,
  content hash (matches the EVM `bytes32` hash so cross-chain identity is
  preserved), plot hash, visibility, monotonic canon count.
- **`episode`** — Records of compressed-NFT episode mints. PDA per
  `(universe, contentHash)`. Composes with Bubblegum CPI for the actual
  cNFT mint + with Metaplex Core during canon promotion.
- **`payment`** — Solana sister of `PaymentRouter.sol`. Routes SOL + $LOAR
  with pull-style accumulators per creator, two-step ownership transfer,
  pause, one-way `lock_loar_mint`. All accumulator math is `checked_*` and
  every SPL transfer uses `transfer_checked` (rejects malicious-mint impersonation).

### Auth + identity

- **SIWS** — Sign-In With Solana, parallel to SIWE. JWT carries
  `ns: 'eip155' | 'solana'` + `evm` + `sol` claims so one session can
  represent both chains.
- **Cross-chain linking** — [`/settings/wallets`](../apps/web/src/routes/settings.wallets.tsx) UI
  lets an EVM-primary user attach a Solana wallet via SIWS; server reissues
  the JWT preserving primary identity.
- **Mobile** — [`apps/mobile/SOLANA.md`](../apps/mobile/SOLANA.md) — Android
  Mobile Wallet Adapter (MWA) for Phantom/Solflare/Backpack. iOS falls back
  to universal-link / Solana Pay QR flows.

### Mint flows

- **Bubblegum cNFTs** — [`/api/solana/episode/mint`](../apps/server/src/routes/solana.ts).
  Composes `episode::mint_episode` + Bubblegum `mint_v1` in a single
  Circle-signed tx. ~$0.0001/mint.
- **Canon promotion** — [`/api/solana/episode/canonize`](../apps/server/src/routes/solana.ts).
  Flips `is_canon` + mints a parallel Metaplex Core asset (5% royalty,
  optional Attributes plugin pinning `cnftAssetId`). The Core path keeps the
  cNFT as a historical record while producing a marketplace-tradable artifact.
- **Pay-and-mint composition** — [`PayAndMintButton`](../apps/web/src/components/PayAndMintButton.tsx)
  on the wiki entity page: scan QR → pay 0.01 SOL → auto-mint cNFT with the
  payment tx pinned into lineage. The killer demo flow.

### Solana Pay

- **Intent + status** — [`/api/solana-pay/intent`](../apps/server/src/routes/solana-pay.ts)
  generates a fresh reference key + Solana Pay URL. Polling validates
  recipient/amount/token cryptographically; mismatched payments mark the
  intent `invalid` instead of crediting.
- **UI** — [`SolanaPayButton`](../apps/web/src/components/SolanaPayButton.tsx)
  renders the QR + Phantom deeplink + status polling.

### Squads multisig

[`lib/squads.ts`](../apps/server/src/lib/squads.ts) — Solana parity for
shared Universe ownership. `create`, `propose`, `approve`, `execute` —
deterministic vault PDAs, `createKey` persisted to Firestore so the
multisig is recoverable. Race-retry on `transactionIndex` collisions.

### Cross-chain bridge

Custodial lock-and-mint today, Wormhole NTT for production. Full setup +
trust model in [`docs/solana-bridge.md`](./solana-bridge.md). The bridge
auto-picks the backend at runtime — no UI changes when NTT lands.

**Hardened against** (see [audit](../docs/audit-fix-tracker.md) entries B1-B20):

- Per-tx + per-user-per-day caps
- Idempotency keys (replay protection)
- Source-balance precheck (Solana ATA + EVM `balanceOf`)
- Recipient-shape validation per direction
- Per-user rate limits (5/min)
- Auth-gated status reads
- Crypto-random intent ids
- TTL on intent docs

### Indexer

[`apps/solana-indexer/`](../apps/solana-indexer/) — Helius enhanced webhook
→ Firestore. Anchor event decoder (hand-built borsh against
`sha256("event:<Name>")[..8]` discriminators) decodes
`UniverseCreated` / `EpisodeMinted` / `EpisodeCanonized` events.
Idempotent — Firestore-transaction-gated to prevent counter drift on
webhook retries. Bubblegum mints extract `assetId` for O(1) lookup.

Ships dockerized for Fly.io / Railway — [`Dockerfile`](../apps/solana-indexer/Dockerfile),
[`fly.toml`](../apps/solana-indexer/fly.toml), [`railway.toml`](../apps/solana-indexer/railway.toml).

### Cross-chain attestation

[`lib/attestation.ts`](../apps/server/src/lib/attestation.ts) — Ed25519
signs `{schema, mintedAt, solana, evm, lineage}` for every cNFT mint.
Cryptographically links the Solana cNFT to its EVM Universe. Verifiable
offline against the published signer pubkey at
`GET /api/solana/attestation/key`. Supports key rotation via
`ATTESTATION_PRIVATE_KEY_PREVIOUS`.

### MCP tools

[`apps/mcp/src/tools.ts`](../apps/mcp/src/tools.ts) — 6 Solana tools exposed
to AI agents: `mint_episode`, `canonize_episode`, `pay_intent`,
`pay_status`, `activity`, `get_attestation`. Scope-gated via new API key
permissions: `solana.mint`, `solana.canonize`, `solana.pay`, `solana.bridge`.

## Dev workflow

```sh
# 1. Build + deploy the Anchor programs (one-time per cluster)
cd apps/programs
anchor build
anchor deploy --provider.cluster devnet
pnpm sync:ids
pnpm idl:export

# 2. Initialize payment program (idempotent)
pnpm tsx apps/programs/scripts/init-payment.ts

# 3. Create the Bubblegum merkle tree (one-time per cluster)
TREE_CREATOR_KEYPAIR=./tree.json \
  pnpm tsx apps/server/scripts/solana/create-merkle-tree.ts

# 4. Mint a demo episode end-to-end
SOLANA_RPC_URL_DEVNET=https://api.devnet.solana.com \
  pnpm tsx apps/programs/scripts/demo-mint.ts

# 5. Bridge setup (custodial v1)
pnpm tsx apps/server/scripts/bridge-bootstrap.ts
# Then transfer mint authority on both chains to the printed addresses + set env vars.

# 6. Smoke test
cd apps/programs && anchor test
```

See [`solana-mainnet-runbook.md`](./solana-mainnet-runbook.md) for the
production migration path.

## API surface

Public + auth-gated routes — every Solana endpoint:

```
SIWS:        POST /auth/solana/verify          public
             POST /auth/solana/link            session-authed

Wallet:      GET  /api/solana/wallet           authed (Circle DCW provisioning)
             GET  /api/solana/wallet/balances  authed
             GET  /api/solana/tx/status        authed
             GET  /api/solana/config           public

Activity:    GET  /api/solana/activity         public, cached 5s

Attestation: GET  /api/solana/attestation/key  public — verifier pubkey
             GET  /api/solana/attestation/:pda public — receipt JSON

Episodes:    POST /api/solana/episode/mint     authed + scope solana.mint
             POST /api/solana/episode/canonize authed + scope solana.canonize
             POST /api/solana/cnft/decompress  authed + scope solana.canonize

Pay:         POST /api/solana-pay/intent       authed + scope solana.pay
             GET  /api/solana-pay/status       public (reference is one-time-use)

Squads:      POST /api/squads/create           authed
             POST /api/squads/propose          authed
             POST /api/squads/approve          authed
             POST /api/squads/execute          authed
             GET  /api/squads/vault            public — PDA derivation

Bridge:      POST /api/bridge/quote            public — auto-picks backend
             POST /api/bridge/transfer         authed + scope solana.bridge
                                              + per-user 5/min + amount caps
             GET  /api/bridge/status           public (stripped) / authed (full)
```

## Documentation map

| File                             | What it covers                                            |
| -------------------------------- | --------------------------------------------------------- |
| `docs/solana-overview.md`        | (this file) — umbrella                                    |
| `docs/solana-bridge.md`          | Bridge trust model, setup, decimal scaling, NTT migration |
| `docs/solana-mainnet-runbook.md` | 9-step devnet → mainnet migration with cost estimates     |
| `apps/mobile/SOLANA.md`          | Mobile Wallet Adapter + dev-client requirement            |
| `apps/programs/README.md`        | Anchor workspace build/deploy                             |
| `apps/programs/tests/README.md`  | Smoke-test coverage                                       |
