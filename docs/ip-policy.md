# LOAR — IP & Content Policy

## Overview

LOAR enables creators to build and monetize AI-generated cinematic universes. Because monetization involves real economic value — NFT sales, token trading, subscriptions, licensing — the platform enforces clear intellectual property rules.

**Core principle:** You can create anything for fun. You can only monetize what you own.

---

## Content Classification

All uploaded content must be classified into one of two categories:

### Fun (Non-Commercial)

- **Purpose:** Creative expression, fan works, experimentation, learning
- **IP Rules:** Relaxed — may include copyrighted characters, settings, music references
- **Monetization:** NOT eligible. Cannot be listed as NFT, included in subscriptions, or licensed
- **Use cases:** Fan fiction universes, remix culture, parody, educational projects
- **Visibility:** Public, private, or unlisted

### Monetized (Commercial)

- **Purpose:** Revenue-generating content
- **IP Rules:** Strict — must meet ALL requirements below
- **Monetization:** Eligible for all 10 revenue streams
- **Visibility:** Public or unlisted (private content cannot be monetized)

---

## Monetized Content Requirements

Content classified as "Monetized" must satisfy ALL of the following:

| Requirement                 | What It Means                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------- |
| **Must be original**        | Created by you or with explicit documented permission                                 |
| **No copyrighted material** | Cannot include third-party characters, music, logos, or settings without a license    |
| **Not a fan work**          | Cannot be derivative of existing copyrighted franchises (no "Star Wars but on-chain") |
| **License must be set**     | You must choose a license for your content                                            |
| **AI-generated is fine**    | AI-generated content using LOAR's tools is considered original for platform purposes  |

### Examples

| Content                                               | Classification | Why                                    |
| ----------------------------------------------------- | -------------- | -------------------------------------- |
| Original sci-fi universe with AI-generated characters | Monetized      | Original IP, AI tools are fine         |
| "What if Batman met Naruto" crossover                 | Fun only       | Uses copyrighted characters            |
| Fan-made Game of Thrones alternate timeline           | Fun only       | Derivative of copyrighted franchise    |
| Original universe that _happens to resemble_ a genre  | Monetized      | Genre conventions aren't copyrightable |
| Remix of public domain works (Shakespeare, mythology) | Monetized      | Public domain is fair game             |

---

## IP Declaration

At upload time, creators declare:

| Field                     | Type              | Description                                     |
| ------------------------- | ----------------- | ----------------------------------------------- |
| `isOriginal`              | boolean           | "I created this or have documented permission"  |
| `usesCopyrightedMaterial` | boolean           | "This includes third-party copyrighted content" |
| `copyrightNotes`          | string (optional) | Explain any third-party usage                   |
| `license`                 | enum              | Rights grant for this content                   |

**Enforcement:** The upload flow (`/upload`) and content API (`content.create`) programmatically reject monetized content that fails these checks. You cannot set `classification: "monetized"` if `usesCopyrightedMaterial: true` and `isOriginal: false`.

### Available Licenses

| License               | Meaning                                                         |
| --------------------- | --------------------------------------------------------------- |
| `all-rights-reserved` | You retain all rights. Others cannot use without permission     |
| `cc-by`               | Others can use with attribution                                 |
| `cc-by-sa`            | Others can use with attribution + must share under same license |
| `cc-by-nc`            | Others can use with attribution, non-commercial only            |
| `cc0`                 | Public domain dedication — anyone can use for anything          |
| `fan-work`            | Derivative work (Fun classification only)                       |

---

## AI-Generated Content IP

LOAR uses third-party AI models (FAL, Gemini, OpenAI) for generation. Important considerations:

1. **AI output ownership:** Under current law (as of 2026), AI-generated content has uncertain copyright status in many jurisdictions. LOAR treats AI-generated content as belonging to the creator who prompted it, but this is a platform policy, not a legal guarantee.

2. **AI training data:** The AI models used by LOAR were trained on third-party data. LOAR does not control or warrant the training data composition.

3. **Creator responsibility:** If AI generates content that closely resembles copyrighted material, the creator is responsible for not monetizing it.

4. **Platform position:** LOAR provides the tools. The creator accepts responsibility for what they generate and how they classify it.

---

## Prohibited Content

Regardless of classification, the following is prohibited:

1. **Infringing monetized content** — Copyrighted material sold as NFTs, in subscriptions, or licensed
2. **Identity misrepresentation** — Universes or characters impersonating real people without consent
3. **Illegal content** — Content that violates applicable law in the creator's or platform's jurisdiction
4. **Malicious content** — Content designed to harm, harass, defraud, or incite violence
5. **CSAM** — Zero tolerance. Immediate removal and reporting

---

## Canon Submissions

Community-submitted canon entries (characters, plot arcs, locations, lore rules):

- Submissions to a monetized universe must be original
- The submitter retains IP rights to their submission
- If accepted and licensed, the submitter earns royalties
- The universe creator controls licensing of accepted canon
- Rejected submissions remain the submitter's property

---

## Cross-Universe Collaborations

When two universes collaborate:

- Both creators must confirm IP ownership of contributed content
- Revenue sharing is defined in basis points at collaboration creation
- Both parties must explicitly agree before activation
- Either party can cancel, ending future episode creation

---

## IP Licensing Deals

When licensing to third parties (studios, publishers, game developers):

- Only the universe creator (contract owner) can authorize licenses
- Licenses specify: type, scope, upfront fee, royalty rate, duration
- Royalty payments are tracked on-chain
- **Creator responsibility:** You warrant that you have rights to license all content in your universe
- **Platform role:** LOAR facilitates the deal structure. LOAR does not verify IP ownership claims beyond the declaration system

---

## Dispute Resolution

### Current State (Testnet)

LOAR does not yet have an automated dispute resolution system. Since all activity is on testnet with no real economic value, disputes are handled informally.

### Planned (Before Mainnet)

| Capability             | Description                                                |
| ---------------------- | ---------------------------------------------------------- |
| **DMCA Takedown**      | Request form, 72-hour review, counter-notice support       |
| **Content Flagging**   | Community reports with review queue                        |
| **Creator Appeals**    | Contest classification changes or removals                 |
| **Arbitration**        | For licensing disputes above a value threshold             |
| **Proactive Scanning** | Automated similarity detection for known copyrighted works |

### Interim Process

Disputes should be reported to the platform team. Infringing monetized content will be reclassified to "Fun" (disabling monetization) pending review.

---

## Creator Responsibilities

By creating monetized content on LOAR, you represent that:

1. You own or have documented rights to all content in your universe
2. You have the right to mint, sell, and license that content
3. You will respond to legitimate IP complaints within 7 days
4. You understand that on-chain data (hashes, transactions) is permanent and cannot be deleted from the blockchain
5. You accept that reclassification or removal may occur if IP violations are found
6. You accept that AI-generated content carries inherent IP uncertainty

---

## Platform Position

LOAR is a tool platform, not a content publisher. The platform:

- **Does enforce** IP classification rules at the application layer
- **Does track** IP declarations for all content
- **Does prevent** monetization of improperly classified content
- **Does not** guarantee that all content is properly licensed (creator responsibility)
- **Does not** perform proactive content scanning (planned before mainnet)
- **Does not** provide legal advice on IP ownership
- **Will implement** DMCA compliance and moderation tooling before mainnet launch
