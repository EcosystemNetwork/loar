# Anchor smoke tests

Run against a local `solana-test-validator`:

```sh
cd apps/programs && anchor test
```

Anchor spins up the validator, deploys all three programs from `target/deploy/`,
then runs the mocha suite in this directory.

## Coverage today

- `smoke.test.ts` — universe + episode happy path:
  - `initialize_universe` → `publish_universe` → unauthorized publish rejected
  - `mint_episode` → `canonize` → double-canonize rejected

## Coverage gaps (deferred)

- **Bubblegum cNFT mint** — requires a Merkle tree at the local-validator's
  account, plus the SPL Account Compression + Noop programs cloned from
  devnet. Currently exercised end-to-end via
  `apps/programs/scripts/demo-mint.ts` against real devnet (proves the
  composed (anchor + Bubblegum) tx works in production-shape).
- **Metaplex Core canon-promotion** — `mpl-core` has known issues running
  against local validators with empty account state. Tested implicitly
  through the live devnet path.
- **Payment program** — needs Token-2022 + Associated Token Account programs
  cloned to the local validator. Smoke-tested implicitly via `init-payment.ts`
  against devnet. A full vitest suite is queued for a follow-up.

## Running selectively

```sh
# Only the universe+episode smoke
anchor test -- --grep 'smoke'
```
