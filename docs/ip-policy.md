# LOAR — IP & Content Policy

## Overview

LOAR enables creators to build and monetize cinematic universes. Because monetization involves real economic value — NFT sales, subscriptions, licensing deals — the platform enforces clear intellectual property rules to protect creators, fans, and the platform.

---

## Content Classification

All uploaded content must be classified into one of two categories:

### Fun (Non-Commercial)

- **Purpose:** Creative expression, fan works, experimentation
- **IP Rules:** Relaxed — may include copyrighted materials, fan fiction, derivative works
- **Monetization:** Not eligible for commercial monetization
- **Visibility:** Public, private, or unlisted

### Monetized (Commercial)

- **Purpose:** Revenue-generating content
- **IP Rules:** Strict — see requirements below
- **Monetization:** Eligible for all revenue streams (NFTs, subscriptions, licensing, etc.)
- **Visibility:** Public or unlisted (private content cannot be monetized)

---

## Monetized Content Requirements

Content classified as "Monetized" must meet ALL of the following:

1. **Must be original** — Created by the uploader or with explicit permission
2. **No copyrighted material** — Cannot include third-party copyrighted content without a license
3. **Not a fan work** — Cannot be derivative of existing copyrighted franchises
4. **License must be set** — Creator selects from: all-rights-reserved, CC-BY, CC-BY-SA, CC-BY-NC, CC0

**Enforcement:** The upload flow (`/upload`) and content creation API (`content.create`) programmatically reject monetized content that fails these checks.

---

## IP Declaration

At upload time, creators must declare:

| Field                     | Type              | Description                                     |
| ------------------------- | ----------------- | ----------------------------------------------- |
| `isOriginal`              | boolean           | "I created this or have permission to use it"   |
| `usesCopyrightedMaterial` | boolean           | "This includes third-party copyrighted content" |
| `copyrightNotes`          | string (optional) | Explain any third-party content usage           |
| `license`                 | enum              | Rights grant for this content                   |

### Available Licenses

| License               | Meaning                                              |
| --------------------- | ---------------------------------------------------- |
| `all-rights-reserved` | Creator retains all rights                           |
| `cc-by`               | Others can use with attribution                      |
| `cc-by-sa`            | Others can use with attribution + share-alike        |
| `cc-by-nc`            | Others can use with attribution, non-commercial only |
| `cc0`                 | Public domain dedication                             |
| `fan-work`            | Derivative work (Fun classification only)            |

---

## Prohibited Content

The following content is prohibited regardless of classification:

1. **Infringing monetized content** — Copyrighted material sold as NFTs, in subscriptions, or licensed
2. **Identity theft** — Universes or characters impersonating real people without consent
3. **Illegal content** — Content that violates applicable law
4. **Malicious content** — Content designed to harm, harass, or defraud

---

## Canon Submissions

Community-submitted canon entries (characters, plot arcs, locations, lore rules) follow the same IP rules:

- Submissions to a **monetized universe** must be original
- Accepted and licensed submissions generate royalties for the submitter
- The universe creator controls licensing of canon entries

---

## Cross-Universe Collaborations

When two universes collaborate:

- Both creators must have monetization-eligible content (original, properly licensed)
- Revenue sharing is defined in basis points at collaboration creation
- Both parties must agree before activation

---

## IP Licensing Deals

When licensing a universe to third parties (streaming, gaming, merch, etc.):

- Only the universe creator (contract owner) can create licenses
- Licenses specify: type, upfront fee, royalty rate (bps), terms, duration
- The platform records royalty payments for transparency
- Creators are responsible for ensuring they have rights to all content in their universe

---

## Dispute Resolution

**Current state:** LOAR does not yet have an automated dispute resolution system.

**Planned:**

- DMCA takedown request process
- Content flagging and review queue
- Creator appeals process
- Arbitration for licensing disputes

**Interim process:** Disputes should be reported to the platform team. Infringing monetized content will be reclassified to "Fun" (disabling monetization) or removed pending review.

---

## Creator Responsibilities

By creating monetized content on LOAR, you represent that:

1. You own or have licensed all content in your universe
2. You have the right to mint, sell, and license that content
3. You will respond to legitimate IP complaints
4. You understand that on-chain content (hashes, transactions) cannot be deleted from the blockchain
5. You accept that reclassification or removal may occur if IP violations are found

---

## Platform Position

LOAR is a tool for creators. The platform:

- **Does enforce** IP classification rules at the application layer
- **Does track** IP declarations for all content
- **Does prevent** monetization of improperly classified content
- **Does not** guarantee that all content is properly licensed (creator responsibility)
- **Does not** perform proactive content scanning (planned for Phase 5)
- **Will implement** DMCA compliance and moderation tooling before mainnet launch
