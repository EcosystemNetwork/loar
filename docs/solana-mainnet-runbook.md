# Solana Mainnet Runbook

Migration path from devnet (where everything is live today) to `mainnet-beta`.
Devnet program IDs + addresses are committed in
[packages/abis/src/solana-addresses.ts](../packages/abis/src/solana-addresses.ts);
mainnet entries are currently empty and get filled in by following this doc.

## Pre-mainnet blockers

These need real time and/or money to clear — they are not code changes and
must be resolved **before** flipping any production switch.

### 🚫 Hard blockers (do not deploy until cleared)

| Item                                                                           | Status                                                | What it takes                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------ | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| External audit of the three Anchor programs (`universe`, `episode`, `payment`) | not started                                           | Engage a Solana-native firm (OtterSec, Neodyme, Sec3, Halborn). 2-4 week lead time + report. The contracts have an audit tracker with 111 findings; the Solana programs have had zero external eyes.                                    |
| Move program upgrade authority off deployer EOA → Squads multisig              | devnet still on `7pawxCZ8...`                         | Create Squads v4 multisig on mainnet, derive vault PDA, run `apps/programs/scripts/transfer-upgrade-authority.ts <vault>` then `--verify`. Also covered in step 6.                                                                      |
| $LOAR mint authority off deployer EOA → Squads                                 | devnet still on `7pawxCZ8...` (freeze already nulled) | `spl-token --program-id <Token2022> authorize $LOAR_MINT mint <squads-vault>`. Verify with `apps/server/scripts/solana/check-loar-mint.ts`.                                                                                             |
| Custodial bridge → Wormhole NTT migration                                      | code path exists, contracts not deployed              | Deploy NTT manager + transceiver on Solana and Sepolia/Base. ~3-5 days of on-chain setup + integration. Bridge `wormhole-bridge.ts` auto-picks the new backend when manager addresses land. Custodial v1 stays available as a fallback. |

### ⚠️ Soft blockers (deploy without, but expect operational pain)

| Item                                                        | Status                                       | Why it matters                                                                                                                                              |
| ----------------------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| End-to-end dry-run of this runbook on a fresh devnet wallet | never done                                   | Catches missing scripts, env vars, ordering bugs before they hit mainnet. Steps 1-9 have only ever been executed piecemeal.                                 |
| Bridge round-trip e2e test (real EVM ↔ Solana with real $)  | never done                                   | Custodial bridge ran one-direction tests on devnet. Round-trip + the failure-recovery `/retry` path are untested.                                           |
| Bridge reconciliation cron in production                    | ✅ GH Actions workflow ready                 | `.github/workflows/bridge-reconcile.yml` polls hourly. Set `BRIDGE_RECONCILE_URL` (+ optional `SLACK_WEBHOOK_URL`) repo secrets and enable the workflow.    |
| Firestore TTL on `bridgeIntents.expiresAt`                  | configure in console once                    | Setup in [docs/solana-bridge.md → Operational setup](./solana-bridge.md#operational-setup). Without it, intent docs accumulate forever.                     |
| Program `.so` + `*-keypair.json` backups                    | ✅ script written, run before deploy         | `apps/programs/scripts/backup-keypairs.sh <gpg-recipient> [out-dir]` produces a GPG-encrypted tarball + SHA256. Run after every `anchor build` for mainnet. |
| Web app `iOS Solana wallet UX`                              | ✅ Phantom/Solflare/Backpack universal links | `SolanaPayButton` now uses universal-link buttons on iOS + a copy-link fallback. Still doesn't cover every wallet, but the three majors route cleanly.      |
| `apps/programs/scripts/transfer-payment-ownership.ts`       | ✅ written — needs Squads run                | Two-step propose/accept ownership transfer. Run once mainnet Squads vault is live.                                                                          |
| `scripts/solana/create-loar-mint.ts`                        | ✅ written — needs mainnet run               | Token-2022 mint creation with MetadataPointer + supply mint to authority. Run once on mainnet with `TOKEN_AUTHORITY_KEYPAIR` set.                           |
| Solana programs in CI                                       | ✅ workflow added                            | `.github/workflows/anchor-tests.yml` spins solana-test-validator + runs all suites on every PR touching `apps/programs/`. First run on next PR.             |
| Bridge config UI gate                                       | ✅ done                                      | `/api/bridge/health` returns `fullyConfigured` + `missing[]`; `/bridge` shows a yellow banner when partial.                                                 |

### ℹ️ Recommended before public launch

- Run `npx slither` + `mythril` on `apps/contracts/` (EVM side — separate from Solana audit).
- Tighten the bridge daily caps from the defaults (`BRIDGE_MAX_PER_USER_PER_DAY_LOAR=5000000`, `BRIDGE_MAX_GLOBAL_PER_DAY_LOAR=20000000`) to whatever the audit/insurance partner is comfortable with.
- Wire `/api/bridge/reconcile` drift detection into the same alerting that pages on indexer staleness.
- Re-run `auditBridgeConfig()` after every Railway/Fly env update — partial-config is the most common foot-gun.

---

## Prerequisites

| Item                                              | Cost                                     | Source                                               |
| ------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------- |
| Mainnet-beta SOL on deployer wallet               | ~12 SOL (deploy 3 programs + mint setup) | [coinbase.com](https://coinbase.com), DEX swap, etc. |
| Helius mainnet API key (or Triton / QuickNode)    | $0 free tier OK to start                 | [helius.dev](https://helius.dev)                     |
| Domain for the indexer                            | (optional) ~$10/year                     | Namecheap / Cloudflare                               |
| Squads v4 mainnet upgrade authority (recommended) | free                                     | [v4.squads.so](https://v4.squads.so)                 |

The deployer keypair `~/.config/solana/id.json` becomes the **upgrade
authority** + **mint authority** for the production deploys. Before mainnet,
**transfer upgrade authority to a Squads multisig** (step 6 below) — never
run mainnet with an EOA upgrade authority.

## Step 1 — Switch the CLI cluster

```sh
solana config set --url mainnet-beta
solana balance      # confirm funded
solana address      # confirm correct deployer
```

## Step 2 — Deploy the programs

```sh
cd apps/programs

# Program keypairs are deterministic — same .so binary produces the same
# program ID on mainnet as on devnet. The keypair files in target/deploy/
# ARE the upgrade authority for that program ID. Back them up FIRST.
cp target/deploy/*-keypair.json ~/loar-mainnet-program-keypairs-$(date +%F)/

anchor build
anchor deploy --provider.cluster mainnet
```

Costs ~3.25 SOL × 3 programs in temporary buffer rent (reclaimed). Net cost:
~0.02 SOL fees.

Copy the printed program IDs into:

- [packages/abis/src/solana-addresses.ts](../packages/abis/src/solana-addresses.ts) `mainnet-beta` keys
- `.env`: `UNIVERSE_PROGRAM_ID`, `EPISODE_PROGRAM_ID`, `PAYMENT_PROGRAM_ID`
  (production env, NOT the devnet ones)

> The keypair file decides the program ID. If you want different IDs on
> mainnet vs devnet (rare; complicates address registries), generate fresh
> keypairs via `solana-keygen new --outfile target/deploy/X-keypair.json`,
> run `anchor keys sync`, then `anchor build && anchor deploy`.

## Step 3 — Deploy the $LOAR Token-2022 mint

The Token-2022 mint is independent of the Anchor programs. Use the same
script you ran on devnet but pointed at mainnet:

```sh
# (assumes you have a scripts/solana/create-loar-mint.ts — recreate from the
# devnet mint creation if missing)
SOLANA_CLUSTER=mainnet-beta \
SOLANA_RPC_URL=$HELIUS_MAINNET_RPC \
TOKEN_AUTHORITY_KEYPAIR=~/.config/solana/id.json \
  pnpm tsx scripts/solana/create-loar-mint.ts
```

After deploy, transfer the mint authority to the Squads multisig (step 6).

Copy the mint address into:

- `LoarMint['mainnet-beta']` in [solana-addresses.ts](../packages/abis/src/solana-addresses.ts)
- `.env`: `LOAR_MINT_MAINNET`

## Step 4 — Create the Bubblegum tree

Devnet uses depth=14 / buffer=64 / canopy=0 (16k cNFTs, ~$0.2 rent). For
mainnet plan for scale:

| Slots     | Depth | Buffer | Canopy | Approx. rent |
| --------- | ----- | ------ | ------ | ------------ |
| 16,384    | 14    | 64     | 0      | ~0.2 SOL     |
| 131,072   | 17    | 64     | 8      | ~5 SOL       |
| 1,048,576 | 20    | 64     | 12     | **~240 SOL** |

Canopy depth must be high enough that the mint tx fits under Solana's
1232-byte size limit. depth=20 needs canopy≥12.

```sh
TREE_CREATOR_KEYPAIR=~/.config/solana/id.json \
SOLANA_CLUSTER=mainnet-beta \
SOLANA_RPC_URL=$HELIUS_MAINNET_RPC \
  pnpm tsx apps/server/scripts/solana/create-merkle-tree.ts
```

Defaults are cluster-aware: devnet → depth=14/buffer=64/canopy=0; mainnet →
depth=17/buffer=64/canopy=8 (~5 SOL, 131K slots). To go bigger, set
`BUBBLEGUM_MAX_DEPTH=20 BUBBLEGUM_CANOPY_DEPTH=12` (~240 SOL, 1M slots) —
the script enforces canopy≥12 when depth≥20 so mint txs fit under the
1232-byte limit.

Copy the tree address into:

- `BubblegumTree['mainnet-beta']`
- `.env`: `BUBBLEGUM_TREE_MAINNET`

## Step 5 — Initialize the payment program

```sh
SOLANA_CLUSTER=mainnet-beta \
SOLANA_RPC_URL_MAINNET=$HELIUS_MAINNET_RPC \
LOAR_MINT_MAINNET=$LOAR_MINT_MAINNET \
PAYMENT_TREASURY=$MAINNET_TREASURY_PUBKEY \
DEFAULT_FEE_BPS=250 \
  pnpm tsx apps/programs/scripts/init-payment.ts
```

The script branches on `SOLANA_CLUSTER`:

- `mainnet-beta` → reads `LOAR_MINT_MAINNET` + `SOLANA_RPC_URL_MAINNET`
- `devnet` (default) → reads `LOAR_MINT_DEVNET` + `SOLANA_RPC_URL_DEVNET`
- `SOLANA_RPC_URL` is the cross-cluster fallback for either.

Once verified, leave the mint locked (the script does this by default).

## Step 6 — Move upgrade authorities to a Squads multisig

Before publicly minting cNFTs:

```sh
# Create a Squads multisig on mainnet (https://v4.squads.so, or via SDK)
# Then transfer authorities to the multisig PDA:

solana program set-upgrade-authority \
  $UNIVERSE_PROGRAM_ID --new-upgrade-authority $SQUADS_VAULT_PDA
solana program set-upgrade-authority \
  $EPISODE_PROGRAM_ID --new-upgrade-authority $SQUADS_VAULT_PDA
solana program set-upgrade-authority \
  $PAYMENT_PROGRAM_ID --new-upgrade-authority $SQUADS_VAULT_PDA

# Transfer LOAR mint authority + freeze authority:
spl-token authorize $LOAR_MINT_MAINNET mint $SQUADS_VAULT_PDA
spl-token authorize $LOAR_MINT_MAINNET freeze $SQUADS_VAULT_PDA

# Payment program ownership transfer (two-step propose/accept already in program):
pnpm tsx apps/programs/scripts/transfer-payment-ownership.ts $SQUADS_VAULT_PDA
```

After this, the EOA deployer keypair can be archived offline. All future
upgrades require a Squads-multisig-approved tx.

## Step 7 — Server env (production)

Update `.env` (or platform env vars on Railway/Fly/Vercel):

```env
SOLANA_CLUSTER=mainnet-beta
SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=...
HELIUS_API_KEY=<mainnet key>
HELIUS_WEBHOOK_SECRET=<openssl rand -hex 32>

UNIVERSE_PROGRAM_ID=<mainnet>
EPISODE_PROGRAM_ID=<mainnet>
PAYMENT_PROGRAM_ID=<mainnet>
LOAR_MINT_MAINNET=<mainnet mint>
BUBBLEGUM_TREE_MAINNET=<mainnet tree>

SOLANA_PAY_RECIPIENT=<production treasury Solana address>

# Web
VITE_SOLANA_CLUSTER=mainnet-beta
VITE_SOLANA_RPC_URL=<public mainnet RPC for browser>
VITE_LOAR_MINT_MAINNET=<mint>
VITE_UNIVERSE_PROGRAM_ID=<mainnet>
VITE_EPISODE_PROGRAM_ID=<mainnet>
VITE_BUBBLEGUM_TREE_MAINNET=<tree>
VITE_SOLANA_DEMO_UNIVERSE=  # leave empty for production — users create their own
```

The server env-validator (`apps/server/src/lib/env.ts`) will fail boot in
production if `SOLANA_RPC_URL` is missing when `CIRCLE_API_KEY` is set.

## Step 8 — Deploy the indexer

```sh
fly deploy --config apps/solana-indexer/fly.toml \
           --dockerfile apps/solana-indexer/Dockerfile

# Or Railway:
railway up --service loar-solana-indexer
```

After the indexer has a public URL, register the Helius webhook:

```sh
HELIUS_API_KEY=$MAINNET_HELIUS_KEY \
SOLANA_INDEXER_PUBLIC_URL=https://idx-solana.loar.fun \
HELIUS_WEBHOOK_SECRET=$WEBHOOK_SECRET \
UNIVERSE_PROGRAM_ID=$MAINNET_UNIVERSE \
EPISODE_PROGRAM_ID=$MAINNET_EPISODE \
PAYMENT_PROGRAM_ID=$MAINNET_PAYMENT \
SOLANA_CLUSTER=mainnet-beta \
  pnpm -F @loar/solana-indexer register
```

## Step 9 — Verify

- `solana program show <PROGRAM_ID>` for each program → upgrade authority is the Squads vault PDA.
- `spl-token display $LOAR_MINT_MAINNET` → mint + freeze authority both = Squads vault.
- Fetch `config` PDA from payment program → owner = Squads vault, treasury = production treasury, `loar_mint` = mainnet mint, `loar_locked = true`.
- Helius webhook delivers test event to indexer `/healthz` returns 200.
- Mint one production episode via `apps/programs/scripts/demo-mint.ts` (with mainnet env vars) to confirm full path.

## Post-mainnet operational checks

- Monitor `solanaEvents` Firestore collection growth — indexer is the bottleneck if writes slow.
- Watch `config.paused` — if compromised, an admin tx can pause routing (claims stay open as an escape hatch).
- Rotate `HELIUS_WEBHOOK_SECRET` quarterly: update the value, redeploy the indexer, re-register the webhook with the new auth-header.

## Rollback

There's no "rollback" for an on-chain program upgrade — but each
`anchor upgrade` is reversible by `anchor upgrade` with the previous .so:

```sh
git checkout <pre-upgrade-commit> -- apps/programs/programs
anchor build
# Then propose an `upgrade` via Squads against the multisig-owned upgrade authority.
```

Keep `target/deploy/*.so` and the commit SHA pair (binary + source) for every
mainnet upgrade so you can rebuild a known-good binary if needed.
