# Credits → Points migration

Status as of 2026-08-29. "Credits" are being retired as a **gate** on generation —
every user brings their own provider keys (BYOK), so the platform no longer needs
to meter or charge for generation. The internal ledger stays (renamed "points" in
the UI) purely for usage display and analytics.

## Done (server + web)

Generation is no longer blocked by balance. Spend is still recorded, the balance
is clamped at 0, and no call path throws "insufficient credits":

| Area                                                      | Change                                                                                                                                                  |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `services/credits/reserve.ts`                             | `reserve()` never throws `InsufficientCreditsError`; `newBalance = max(0, balance - est)`. Feeds `withReservation` → audio/voice/tts/3d/editing routes. |
| `routers/generation/image.routes.ts`                      | `deductLegacyCredits` + main-handler + legacy-handler tx: no balance check, `set(merge)`, clamp at 0.                                                   |
| `routers/generation/generation.routes.ts`                 | `deductCredits` + inline `generate` tx.                                                                                                                 |
| `routers/generation/{outpaint,sceneAudio,lora}.routes.ts` | balance checks removed.                                                                                                                                 |
| `routers/{episodes,clipLibrary,studio,editJobs}`          | local `deductCredits` helpers.                                                                                                                          |
| `routers/credits/credits.routes.ts`                       | `credits.spend` — personal balance + universe-pool floors removed.                                                                                      |
| `hooks/useCreditCheck.ts` (web)                           | `checkCredits()` is now a no-op that always returns `true`.                                                                                             |
| `hooks/useFeatureFlags.ts` + `services/platformConfig.ts` | `purchaseEnabled` forced `false` → all "Buy points" UI hidden. Stripe webhook + `order-reconciliation.ts` left intact for in-flight orders.             |
| UI copy                                                   | `/credits` page, header nav, `LoarBalance` chip, generation-panel cost labels, `pricing.tsx`, `settings/usage` → "points" / "pts".                      |

### Deliberately left intact (not paywalls — owner/abuse controls)

- Kill-switch + monthly USD spend cap (`assertGenerationAllowed` / `spend-cap.ts`).
- Universe-pool team-member monthly allowance (`credits.spend` universe path).
- AI-agent budgets (`services/aiAgentCredits.ts`) — owner-set spend limit for autonomous agents.

Remove these too only on an explicit decision.

## Not done — UI copy long tail

Mechanical "credits → points" copy pass still outstanding in ~30 files: `CreditStore.tsx`
(dead path while `purchaseEnabled=false`), `dashboard.tsx`, `dashboard.revenue.tsx`,
treasury components, `AllocateCreditsForm.tsx`, admin cost/usage dashboards,
`web3-vocab.ts` (partly done), e2e specs (`apps/web/e2e/pricing-credits.spec.ts`).
None affect behaviour.

## Not done — on-chain (needs its own PR + deploy)

Nothing on-chain gates generation — the server meters against Firestore, which is
already neutralised. The on-chain credit system is only a crypto **purchase** path,
and the buy UI is already hidden. So this is low-urgency.

Components:

- **`apps/contracts/src/revenue/CreditManager.sol`** — deployed EVM contract.
- **`apps/programs/programs/credit_manager/`** — deployed Anchor program;
  `apps/solana-indexer/idl/credit_manager.json` + `apps/server/src/lib/solana-credit-manager.ts`
  are its client side.
- **`packages/abis`** — generated bindings (`generated.ts` / `.d.ts`).
- Server endpoints `POST /solana/credits/*` in `apps/server/src/routes/solana.ts`
  (`purchaseWithSol`, `purchaseWithLoar`, `readUserCredits`) — dead-but-harmless
  now (require `CREDIT_MANAGER_PROGRAM_ID`, no UI path).

### Recommended sequence (separate PR)

1. **Server decoupling (safe, no redeploy).** Make `lib/solana-credit-manager.ts`
   purchase fns and the `/solana/credits/*` routes return a `410 Gone` /
   `PRECONDITION_FAILED "points are not purchasable"`. Keep `readUserCredits`.
2. **Freeze the contracts.** Leave `CreditManager.sol` / `credit_manager` deployed
   but call `pause()` (EVM) / equivalent admin flag if present, so no new
   on-chain purchases land. Do **not** self-destruct — existing balances stay readable.
3. **Optional rename.** If a literal `PointsLedger` rename is wanted:
   - new contract + Anchor program, no `purchase*` entrypoints, `record_spend` +
     `read_balance` only;
   - migration script to copy balances;
   - regenerate `packages/abis` (`pnpm --filter @loar/abis build` / wagmi codegen);
   - update `apps/solana-indexer` IDL + registry;
   - testnet (Sepolia + devnet) pass before mainnet;
   - update `docs/launch-readiness.md` + `docs/pre-launch-checklist.md` rows.
4. **Do not** touch generated ABI files by hand — they're codegen output.

## Follow-ups / loose ends

- 5 imageless Cyber War entity stubs (`Vector`, `Sister Grid`, `Package`,
  `Warden Kobe`, `The Cartographer`) created during a credits-blocked run, owned by
  Solana wallet `7TSUVM2Q13P9B1swVmjxQJNXrAwR9sZ4oeeHy5nbJcVv`. Delete with
  `scripts/delete-entities.ts` or backfill covers via the populate script's
  `--covers` phase.
- `scripts/lib/wiki-auth.ts` + `scripts/delete-entities.ts` are new — chain-agnostic
  (EVM SIWE / Solana SIWS) script auth.
