# @loar/programs

Anchor workspace for LOAR's Solana programs — sister contracts to `apps/contracts`.

## Programs

| Program    | Purpose                                                                                | EVM analogue     |
| ---------- | -------------------------------------------------------------------------------------- | ---------------- |
| `universe` | Canonical IP container PDA; tracks creator, content/plot hash, visibility, canon count | `Universe.sol`   |
| `episode`  | Bubblegum cNFT mints; canon promotion path to Metaplex Core                            | `EpisodeNFT.sol` |

Future: `payment` (Solana Pay receiver with on-chain receipts), staking, marketplace integration.

## Setup

```sh
# Anchor + Solana toolchain (one-time)
sh -c "$(curl -sSfL https://release.solana.com/stable/install)"
cargo install --git https://github.com/coral-xyz/anchor avm --locked
avm install 0.31.1 && avm use 0.31.1

# First build — generates program keypairs, then sync them into lib.rs + Anchor.toml.
# Until this runs, declare_id! holds the System program ID (placeholder).
pnpm build                             # generates target/deploy/*-keypair.json
pnpm sync:ids                          # writes real IDs into lib.rs + Anchor.toml
pnpm build                             # rebuild with real IDs
pnpm deploy:devnet
pnpm idl:export                        # → packages/abis/src/idl/*.json
```

After deploy, copy the on-chain program IDs into:

- `packages/abis/src/solana-addresses.ts` (`UniverseProgram`, `EpisodeProgram`)
- `.env`: `UNIVERSE_PROGRAM_ID=<id>`, `EPISODE_PROGRAM_ID=<id>`

## Architecture notes

- **Cross-chain identity**: content hashes are `[u8; 32]`, identical shape to the
  `bytes32` content hashes used by `apps/contracts/src/Universe.sol`. The same
  IP can mint on EVM and Solana sharing the same hash.
- **Fee payer = Circle DCW**: in production the user signs the SIWS message,
  the server builds the tx with the Circle wallet as fee payer, and
  `apps/server/src/lib/circle-solana.ts` submits it. Users never hold private
  keys for the embedded-wallet path.
- **Canon promotion**: episodes start as cNFTs (Bubblegum, ~$0.0001/mint).
  When the universe creator canonizes, the cNFT is decompressed into a
  Metaplex Core NFT — done in a single server-built tx that flips
  `is_canon=true` in the EpisodeRecord and runs the Bubblegum decompress CPI.
