# PRD: Verified Likeness Licensing Marketplace

> Status: Spec
> Date: 2026-03-28

## Problem

A "sell your likeness" feature without proper legal rails is a liability, not a product. California right-of-publicity law (§3344 + digital replica amendments), Illinois BIPA, and Texas biometric law each impose consent, notice, and anti-sale requirements that govern every step from capture to payout.

## Core Rule

KYC alone is not enough.

Minimum safe stack: **KYC/KYB + consent verification + biometric/likeness release + liveness checks + age/guardian controls + payout/tax onboarding + provenance/audit logs + takedown/freeze controls.**

---

## Legal Rails

### California Right of Publicity (§3344 / §3344.1)
- Prior written consent required for commercial use of name, voice, photograph, or likeness in products, merchandise, or advertising.
- §3344.1 covers postmortem rights (deceased personalities).
- Digital replica amendments explicitly extend these protections to synthetic outputs.

### Illinois BIPA
- Voiceprints and face geometry scans = biometric identifiers.
- Requires: written notice, disclosure of purpose/retention policy, written release before collection.
- **Critical**: private entities may not sell, lease, trade, or otherwise profit from a biometric identifier or biometric information.

### Texas Biometric Law
- Notice and consent required before capturing a biometric identifier for a commercial purpose.

### FTC / Federal
- Proposed rules against individual impersonation (extending government/business impersonation rules).
- Voice cloning explicitly flagged as a fraud vector.

---

## What LOAR Licenses (Not Sells)

**Structure the business around:**
- Approved outputs
- Approved model uses
- Approved synthetic performances
- Controlled access to a verified likeness model

**Never:**
- Sell, trade, or profit from the raw biometric/training corpus itself
- Allow raw biometric data to leave LOAR's protected vault

---

## Compliance Status Model

Every likeness asset has a status that gates all generation API calls:

| Status | Meaning | Allowed Operations |
|--------|---------|-------------------|
| `unverified` | Default | None |
| `identity_verified` | KYC passed, likeness not yet verified | Private use only |
| `likeness_verified` | Likeness ownership confirmed | Private projects |
| `market_eligible` | Full compliance passed | Public marketplace listing |
| `restricted` | Approved for specific counterparties only | Contracted access |
| `frozen` | Dispute or abuse hold | Generation + licensing suspended |

---

## Seller Onboarding Flow (6 Steps)

### Step 1 — Identity
- Government ID upload
- Selfie / liveness check (anti-spoofing)
- Sanctions screening
- Age verification (minor → guardian consent gate)
- Tax onboarding: W-9/TIN for U.S. payouts

### Step 2 — Rights Grant
- Sign likeness license agreement (docusign-equivalent, stored as consent artifact)
- Choose exclusivity: exclusive / non-exclusive
- Choose royalty split
- Choose allowed modalities: voice · image · video · 3D
- Choose allowed use cases: ads · films · games · NFTs · subscriptions · training · merch
- Define restricted uses

### Step 3 — Data Capture
- Voice samples (guided phrases)
- Still images (multiple angles, lighting conditions)
- Guided facial expressions
- Guided motion / video clips
- Optional: reference scans / 3D capture
- Metadata: accent, style, wardrobe, signature phrases, etc.

### Step 4 — Verification
- Biometric matching: identity docs vs. submitted assets
- Human review queue for premium / high-value sellers
- Consent artifact stored with timestamp + IP
- Immutable audit/event log entry

### Step 5 — Model Creation
- Generate verified asset pack
- Status transitions: Draft → Verified → Market Eligible
- Model Registry entry: which provider/model trained on what, when

### Step 6 — Listing
- Set per-use pricing tiers
- Choose license types (one-time, subscription, per-project)
- Publish marketplace card
- Enable API access or project-based licensing

---

## Architecture Layers

```
Identity Layer       KYC/KYB, sanctions screening, tax onboarding
Consent Layer        Signed contracts, usage scopes, revocation, parental consent
Capture Layer        Upload audio/images/video + liveness verification
Training Vault       Encrypted raw source data, retention clock, access logs
Model Registry       Provider, model ID, training date, consent reference
Usage Engine         Generate voice/image/video/3D outputs (status-gated)
Licensing Engine     Who can use what, term, territory, medium, royalty split
Audit Layer          Provenance, watermarking, traceability, dispute freeze
```

---

## Provider Reality

### Current constraint (ElevenLabs example)
- Professional Voice Clone: only for your own voice on your own account
- Even with consent, you cannot create another person's PVC on your account
- Voice owner must create + verify on their account, then share

### Option A — Provider-native verified voices
- Require talent to create/verify their own provider-side clone, then connect/share into LOAR
- Faster to launch, limited to providers that support sharing

### Option B — LOAR-owned cloning pipeline (recommended long-term)
- Run consented training/orchestration internally
- Use providers only where their terms allow it
- Full control over compliance layer

**Recommended: Option B + selective Option A integrations**

---

## Special Cases

### Minors
- California commercial-use consent → parent/legal guardian must sign
- Age verification gates the entire onboarding until guardian consent is complete

### Deceased personalities
- California §3344.1: postmortem rights persist
- Estate/authorized representative must complete onboarding as the rights holder

### Revocation
- Support revocation in the consent layer
- Define clearly: revocation stops future uses only, OR triggers takedown of existing licenses
- All revocation events are immutable audit log entries

---

## Fraud & Impersonation Controls

Hosted voice/video likeness tools are a fraud magnet. Ship with:

- Output watermarking (where provider allows)
- Provenance metadata on every generated output
- Abuse reporting flow (takedown requests)
- Automated risk scoring on generation requests
- Manual review queue for high-risk or high-volume likeness uses
- Hard ban: cannot impersonate a real person unless that person is `market_eligible` in LOAR

---

## Self-Host Policy

| Context | Rule |
|---------|------|
| Hosted LOAR | Full KYC/consent/compliance required for all marketplace features |
| Self-hosted LOAR | User can run private models locally; marketplace publication still requires compliance review |

Self-hosting gives power users freedom without contaminating the hosted marketplace's compliance posture.

---

## Framing

**Do not say:** "upload your face and we sell your biometric clone"

**Do say:**
- Verified Likeness Licensing
- Talent-owned AI doubles
- Consent-based voice, image, video, and 3D licensing
- Creator-controlled synthetic performance rights

---

## One-Sentence Rule

> Require KYC + verified consent + modality-specific likeness verification + payouts/tax onboarding, and structure the business around licensing approved likeness uses — not selling raw biometric data.
