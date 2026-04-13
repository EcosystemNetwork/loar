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

- [ ] **#19 Terms of Service** — Replace placeholder at `/terms` with reviewed legal text
  - Platform-specific sections already scaffolded (IP classification, blockchain immutability, DMCA)
  - Have legal counsel review before going live
  - Fill in [DATE] and [EMAIL] placeholders

- [ ] **#19 Privacy Policy** — Replace placeholder at `/privacy` with reviewed legal text
  - Data collection summary already drafted (wallet addresses, content, transactions)
  - Third-party service disclosures included (FAL, OpenAI, Stripe, thirdweb, Firebase)
  - Fill in [DATE] and [EMAIL] placeholders

- [ ] **#4 DMCA Agent** — Register a designated DMCA agent with the US Copyright Office
  - The `/dmca` intake form exists but registration is required for 512(c) safe harbor
  - Register at https://www.copyright.gov/dmca-directory/
  - Publish designated agent info on the `/dmca` page after registration
  - Cost: ~$6 filing fee

- [ ] **#4 Counter-Notice Flow** — Implement 10-14 day hold + putback for DMCA
  - Without this, cannot complete the 512(g) safe harbor loop
  - Requires: server-side timer, email notification to claimant, auto-reinstate after hold

- [ ] **#7 Placeholder Contracts** — Pause or gate unused Sepolia contracts
  - IP Licensing and Collabs have deployed contracts but NO public UI
  - Someone could interact directly with:
    - `AdPlacement: 0x972bD30...`
    - `LicensingRegistry: 0xbF0Fed6...`
    - `CollabManager: 0xE981454...`
  - **Action**: Call `pause()` on each (if Pausable) or transfer ownership to a burn address
  - **Note**: These contracts do NOT inherit Pausable — see #2 below

- [ ] **#11 Firebase SA Scope** — Restrict service account IAM
  - Currently uses default permissions (likely `roles/editor`)
  - App only needs: **Firestore read/write** + **Cloud Storage read/write**
  - Minimum IAM roles: `roles/datastore.user` + `roles/storage.objectAdmin`
  - Does NOT need: Firebase Auth, Realtime Database, Cloud Functions, Messaging
  - **Action**: Create custom IAM role, assign to SA, rotate key, update env

- [ ] **#13 Release Tag** — Create `v0.1.0-beta` before first public deployment
  - `git tag -a v0.1.0-beta -m "Pre-launch testnet beta" && git push --tags`
  - Enables `git revert` to known-good state if needed

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

- [ ] **#6 Per-User Rate Limits** — Add wallet-address-based limits on AI generation
  - Current: per-IP only. Multiple wallets from same IP share limit.
  - Add: per-authenticated-user limit (extract from SIWE JWT in tRPC middleware)

- [ ] **#8 Multi-Chain Cleanup** — Remove dead scaffolding if not planning multi-chain
  - `apps/bridge/`, `apps/contracts-sol/`, `apps/contracts-sui/` are excluded from workspace
  - Safe to delete if multi-chain is deferred to v2+

---

## Already Done (No Action Needed)

| Item                 | Status                                                      |
| -------------------- | ----------------------------------------------------------- |
| #14 CI hygiene       | Full pipeline: lint, typecheck, test, forge, Slither, audit |
| #15 Deploy SSH       | Rollback + smoke tests + health checks                      |
| #20 Mobile links     | No App Store/Play Store URLs in codebase                    |
| #5 Private key scope | Filecoin only, no EVM signing authority                     |
