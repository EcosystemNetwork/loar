# Solana Mainnet Runbook

Migration path from devnet (where everything is live today) to `mainnet-beta`.
Devnet program IDs + addresses are committed in
[packages/abis/src/solana-addresses.ts](../packages/abis/src/solana-addresses.ts);
mainnet entries are currently empty and get filled in by following this doc.

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

(The script's `maxDepth` / `maxBufferSize` constants currently hardcode
devnet sizing — bump them for production.)

Copy the tree address into:

- `BubblegumTree['mainnet-beta']`
- `.env`: `BUBBLEGUM_TREE_MAINNET`

## Step 5 — Initialize the payment program

```sh
SOLANA_CLUSTER=mainnet-beta \
SOLANA_RPC_URL=$HELIUS_MAINNET_RPC \
LOAR_MINT_DEVNET=$LOAR_MINT_MAINNET \
PAYMENT_TREASURY=$MAINNET_TREASURY_PUBKEY \
DEFAULT_FEE_BPS=250 \
  pnpm tsx apps/programs/scripts/init-payment.ts
```

Variable note: the script reads `LOAR_MINT_DEVNET` regardless of cluster —
ensure the env var holds the mainnet mint when running for mainnet, or
update the script to branch on `SOLANA_CLUSTER`.

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
