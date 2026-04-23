# Pre-Launch Checklist

Audit-driven checklist. Items are grouped by launch phase.

---

## Phase 1: Testnet Beta (loar.fun current form)

### Code Fixes (DONE — Sprint 1-3)

- [x] #1 — Disable direct ETH purchase until escrow/contract integration
- [x] #4a — Profile page synced to fan/original/licensed enum
- [x] #4b — Fan lane blocked from purchase and licensing
- [x] #6a — Provider response validation (video, voice, image)
- [x] #6b — AI generation rate limits (10 req/min per IP per endpoint)
- [x] #9 — Cross-chain credit replay prevention (chain ID in dedup keys)
- [x] #10 — Moderation routes migrated to adminProcedure
- [x] #16 — .firebase/ removed from git tracking
- [x] #18 — CORS supports comma-separated origins

### Non-Code Items (DO BEFORE PUBLIC BETA)

- [x] **#19 Terms of Service** — ~~Replace placeholder~~ Substantive legal text live at `/terms` (dated April 10, 2026)
  - Covers: IP classification, blockchain immutability, AI-generated content, DMCA, payments, prohibited conduct
  - No [DATE] or [EMAIL] placeholders remain
  - **Still recommended**: Have legal counsel do a final review before broad public launch

- [x] **#19 Privacy Policy** — ~~Replace placeholder~~ Substantive legal text live at `/privacy` (dated April 10, 2026)
  - Third-party service disclosures included (FAL, OpenAI, ElevenLabs, Meshy, Stripe, thirdweb, Firebase)
  - Data collection, blockchain persistence, retention, user rights all covered
  - **Still recommended**: Have legal counsel do a final review before broad public launch

- [ ] **#4 DMCA Agent** — Register a designated DMCA agent with the US Copyright Office
  - The `/dmca` intake form exists but registration is required for 512(c) safe harbor
  - Register at https://www.copyright.gov/dmca-directory/
  - Publish designated agent info on the `/dmca` page after registration
  - Cost: ~$6 filing fee

- [x] **#4 Counter-Notice Flow** — § 512(g) safe-harbor loop complete _(2026-04-23)_
  - Public `/counter-notice` form + `POST /api/counter-notice` REST + Firestore `counterNotices` collection
  - `dmca-putback` job restores content after the hold period; **uses business-day arithmetic** (not calendar days) to satisfy § 512(g)(2)(C)'s "≥10 business days" floor even when federal holidays land in the window
  - Email templates for all three statutory notices: takedown-to-subscriber (§ 512(g)(1)), counter-notice-to-claimant (§ 512(g)(2)(B)), putback-to-claimant
  - § 512(g)(1) subscriber notification: when admin transitions content to `hidden`/`removed`, an in-app notification + best-effort email is dispatched to the content creator with a deep-link to the pre-filled counter-notice form
  - **Operational gate before public beta**: set `DMCA_PUTBACK_ENABLED=true` on exactly ONE replica in prod (job is single-writer; the env defaults to off so dev/CI doesn't auto-restore)

- [x] **#7 Placeholder Contracts** — UI gated for unused Sepolia contracts
  - All PARTIAL-feature routes (`/tokens`, `/licensing`, `/collabs`, `/ads`, `/market`, `/sell`, `/staking`, `/bounties`) now redirect to `/coming-soon`
  - Nav links removed from header via `HIDDEN_ROUTES` filter
  - Universe sidebar Govern + Subscribe buttons commented out
  - **Still applies**: On-chain contracts remain callable directly — consider `pause()` or ownership transfer before mainnet
  - **Note**: These contracts do NOT inherit Pausable — see #2 below

- [x] **#11 Firebase SA Scope** — Restrict service account IAM _(completed 2026-04-16)_
  - Currently uses default permissions (likely `roles/editor`)
  - App only needs: **Firestore read/write** + **Cloud Storage read/write**
  - Minimum IAM roles: `roles/datastore.user` + `roles/storage.objectAdmin`
  - Does NOT need: Firebase Auth, Realtime Database, Cloud Functions, Messaging
  - **Action**: Run `bash scripts/narrow-firebase-sa.sh <PROJECT_ID>` — audits roles, strips excess, grants minimum, rotates key
  - Key file pattern added to `.gitignore`

- [ ] **#13 Release Tag** — Create `v0.1.0-beta` before first public deployment
  - `git tag -a v0.1.0-beta -m "Pre-launch testnet beta" && git push --tags`
  - Enables `git revert` to known-good state if needed

- [x] **#21 E2E Test Suite** — Playwright smoke tests added
  - Suite covers: landing, auth guards, create flow, AI sandbox, credits/pricing, moderation/legal, partial-feature redirects, navigation
  - Config: `apps/web/playwright.config.ts`, tests: `apps/web/e2e/smoke.spec.ts`
  - Run: `pnpm --filter web test`

---

## Phase 2: Mainnet Launch

### Contract Governance (CRITICAL — #2)

Current state: **All 14+ contracts owned by single deployer EOA. No timelock, no multisig, no pause.**

Required before any user deposits value:

- [ ] Deploy a **Gnosis Safe multisig** (recommend 3-of-5 signers minimum)
- [ ] Deploy **OpenZeppelin TimelockController** (48-72h delay)
- [ ] Transfer ownership of ALL contracts to the timelock:
  - 9 UUPS proxies: PaymentRouter, RightsRegistry, CanonMarketplace, CreditManager, AdPlacement, SubscriptionManager, LicensingRegistry, CollabManager, AnalyticsRegistry
  - 5 UpgradeableBeacons: episodeBeacon, characterBeacon, entityBeacon, entityEdBeacon, episodeNftBeacon
  - RevenueModuleFactory, UniverseManager, LoarToken, LoarFeeLocker, LoarLpLockerMultiple, SplitRouter
- [ ] Set the multisig as the TimelockController's PROPOSER and EXECUTOR
- [ ] Publish the multisig address and signer set in README
- [ ] Verify: no single key can call `upgradeToAndCall`, `setOwner`, or treasury withdrawal

### LP Lock Documentation (#12)

Current state: `LoarLpLockerMultiple` locks LP **permanently** (no time-based unlock).

- [ ] Document this prominently in README and on the staking/LP UI
- [ ] **Owner escape hatch risk**: `withdrawETH()` and `withdrawERC20()` are `onlyOwner`
  - This lets the owner drain tokens held by the locker
  - After multisig transfer, this is less risky but should be disclosed
- [ ] Verify reward admin rotation cannot be used to redirect fees maliciously
- [ ] Publish: lock parameters, who the reward admins are, fee split percentages

### Security Audit (#3)

- [ ] Run `forge test --gas-report` and publish results
- [ ] Run `slither` locally and fix all high/medium findings (CI already runs this)
- [ ] Engage at least one reputable auditor (estimated 8-12 weeks lead time)
- [ ] Publish audit report before enabling mainnet token liquidity

### Remaining Code Items

- [ ] **#1 Escrow** — Deploy PaymentRouter-based escrow for marketplace purchases
  - Current: buy button disabled for non-contract listings
  - Target: integrate PaymentRouter.route() for all marketplace ETH/LOAR purchases

- [ ] **#5 KMS** — Move Filecoin PRIVATE_KEY to cloud KMS/HSM
  - Current risk is low (Filecoin Calibration testnet only, no EVM signing)
  - For mainnet: use AWS KMS, GCP Cloud KMS, or Hashicorp Vault

- [x] **#6 Per-User Rate Limits** — Wallet-address-based limits already implemented
  - Per-wallet: 10 req/min across all AI endpoints (extracted from SIWE JWT)
  - Daily ceiling: 200 generations per wallet per 24h
  - Per-IP limits still apply as a fallback when JWT parsing fails
  - See: `apps/server/src/middleware/rate-limit.ts`

- [x] **#8 Multi-Chain Cleanup** — Removed Solana, SUI, and bridge scaffolding (Base L2 only)

---

## Already Done (No Action Needed)

| Item                 | Status                                                        |
| -------------------- | ------------------------------------------------------------- |
| #14 CI hygiene       | Full pipeline: lint, typecheck, test, forge, Slither, audit   |
| #15 Deploy SSH       | Rollback + smoke tests + health checks                        |
| #20 Mobile links     | No App Store/Play Store URLs in codebase                      |
| #5 Private key scope | Filecoin only, no EVM signing authority                       |
| #19 Terms & Privacy  | Substantive legal text live (April 10, 2026), no placeholders |
| #6 Per-user limits   | Per-wallet rate limiting in `rate-limit.ts` (10/min, 200/day) |
| #7 UI gating         | Partial features redirect to `/coming-soon`, nav links hidden |
| #21 E2E tests        | Playwright smoke suite: 20+ tests across critical paths       |
