# LOAR Platform -- Privacy Policy

> **Status**: Draft scaffold for legal review. All sections marked [LEGAL REVIEW REQUIRED] need attorney sign-off before publication.
>
> **Last updated**: 2026-04-17
>
> **Effective date**: [TO BE SET ON PUBLICATION]
>
> **Platform**: loar.fun

---

## 1. Introduction

This Privacy Policy describes how LOAR ("we", "us", "our") collects, uses, shares, and protects information when you use the LOAR platform at loar.fun, including our website, smart contracts, APIs, and related services (collectively, "the Platform").

By using the Platform, you acknowledge that you have read and understood this Privacy Policy. If you do not agree with our practices, do not use the Platform.

---

## 2. What We Collect

### 2.1 Information You Provide

| Data Type                        | When Collected                                        | Purpose                                     |
| -------------------------------- | ----------------------------------------------------- | ------------------------------------------- |
| Ethereum wallet address          | Wallet connection via SIWE authentication             | Account identity, transaction association   |
| Email address (optional)         | If provided during profile setup or newsletter signup | Communications, account recovery assistance |
| Content prompts and descriptions | AI content generation requests                        | Generating requested content                |
| Universe/entity metadata         | Creating universes, characters, storylines            | Platform content management                 |
| DMCA takedown requests           | Submitted via /dmca form                              | Intellectual property dispute resolution    |
| Support correspondence           | When you contact us                                   | Responding to inquiries                     |

### 2.2 Information Collected Automatically

| Data Type                    | Collection Method                  | Purpose                                            |
| ---------------------------- | ---------------------------------- | -------------------------------------------------- |
| On-chain transaction history | Blockchain indexer (Ponder)        | Displaying your content, tokens, and activity      |
| Content generation history   | Server-side logging (Firestore)    | Credit tracking, content gallery, abuse prevention |
| Usage analytics              | Client-side analytics              | Platform improvement, feature usage metrics        |
| IP address                   | Server access logs                 | Security, rate limiting, abuse prevention          |
| Browser/device information   | HTTP headers, client metadata      | Compatibility, debugging                           |
| Session tokens (JWT)         | Generated upon SIWE authentication | Session management                                 |

### 2.3 Information from Third Parties

| Source                                  | Data Received                                                       | Purpose                                            |
| --------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------- |
| Blockchain networks (Ethereum, Base L2) | Public transaction data, token balances, smart contract events      | Indexing on-chain activity related to your address |
| thirdweb                                | Wallet connection metadata, in-app wallet session data              | Authentication and wallet management               |
| Stripe (if card payments enabled)       | Payment confirmation (we do not receive or store full card numbers) | Credit purchase fulfillment                        |

[LEGAL REVIEW REQUIRED] Verify completeness of data inventory. Conduct formal data mapping exercise. Determine whether any collected data qualifies as "sensitive" under GDPR Article 9 or equivalent frameworks.

---

## 3. How We Use Your Information

We use collected information for the following purposes:

1. **Platform operation**: Authenticating your identity, processing transactions, managing credits, displaying your content and assets.
2. **AI content generation**: Processing your prompts through AI model providers to generate requested content (images, video, stories).
3. **Content integrity**: Hashing content (SHA-256) for provenance verification, embedding metadata for attribution.
4. **Security and abuse prevention**: Detecting and preventing fraud, unauthorized access, market manipulation, and content policy violations. Enforcing the moderation system (content flagging, admin review, takedowns).
5. **Communication**: Sending transaction confirmations, Platform updates, and responding to support requests. We will not send marketing communications without your opt-in consent.
6. **Platform improvement**: Analyzing usage patterns to improve features, fix bugs, and optimize performance.
7. **Legal compliance**: Responding to legal requests, enforcing our Terms of Service, and meeting regulatory obligations.

[LEGAL REVIEW REQUIRED] Establish and document the lawful basis for each processing activity under GDPR (consent, contract performance, legitimate interest, or legal obligation). Ensure purpose limitation is maintained.

---

## 4. Third-Party Services

We use the following third-party services that may process your data:

### 4.1 Infrastructure and Storage

| Service                         | Data Shared                                                                       | Purpose                                                                   | Data Location                                     |
| ------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------- |
| **Google Firebase (Firestore)** | User profiles, content metadata, credit balances, entity data, moderation records | Primary database for off-chain Platform data                              | Google Cloud (region per Firebase project config) |
| **Pinata**                      | AI-generated content files, metadata JSON                                         | Hot storage and public IPFS gateway for content                           | Pinata infrastructure / IPFS network              |
| **Lighthouse**                  | AI-generated content files (permanent storage)                                    | Permanent storage on Filecoin, token-gated encryption for premium content | Filecoin network (decentralized)                  |

### 4.2 AI Content Generation

| Service    | Data Shared                                                         | Purpose                       |
| ---------- | ------------------------------------------------------------------- | ----------------------------- |
| **FAL AI** | Text prompts, generation parameters, reference images (if provided) | AI image and video generation |

FAL AI processes your prompts to generate content. We recommend reviewing FAL AI's privacy policy for their data handling practices. We do not control how FAL AI uses prompt data beyond our contractual agreements with them.

### 4.3 Authentication and Payments

| Service      | Data Shared                                                                       | Purpose                                   |
| ------------ | --------------------------------------------------------------------------------- | ----------------------------------------- |
| **thirdweb** | Wallet address, connection metadata, session data for in-app wallets              | Wallet connection and SIWE authentication |
| **Stripe**   | Email (if provided), payment amount, transaction metadata (not full card details) | Credit/debit card payment processing      |

### 4.4 Blockchain Networks

| Network                                     | Data Published                                                                 | Nature                       |
| ------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------- |
| **Ethereum (Sepolia testnet)**              | Transaction data, smart contract interactions, token transfers, content hashes | Public, permanent, immutable |
| **Base L2 (Base Sepolia / future mainnet)** | Same as above                                                                  | Public, permanent, immutable |

See Section 5 for important disclosures about on-chain data.

[LEGAL REVIEW REQUIRED] Execute Data Processing Agreements (DPAs) with all third-party processors. Verify each provider's GDPR compliance status. Conduct transfer impact assessments for any data transferred outside the EEA. Review FAL AI's data retention and training policies to ensure user prompts are not used to train models without consent.

---

## 5. On-Chain Data Disclosure

**Blockchain data is public and permanent by design.** This is a fundamental characteristic of the technology, not a Platform choice. You should understand the following before using the Platform:

### 5.1 What Goes On-Chain

The following data is recorded on public blockchain networks when you interact with Platform smart contracts:

- Your wallet address and all transaction history associated with it.
- Content hashes (SHA-256 digests of generated content).
- NFT minting, transfer, and ownership records.
- Token purchase, transfer, and governance voting records.
- Smart contract event data (universe creation, entity registration, subscription records, licensing transactions).
- Canon marketplace submissions, votes, and outcomes.

### 5.2 Permanence and Immutability

**On-chain data cannot be deleted, modified, or hidden.** This applies regardless of:

- DMCA takedown requests (which affect only off-chain content served by the Platform).
- Account deletion requests.
- GDPR right-to-erasure requests (see Section 7.1).
- Platform bans or content moderation actions.

### 5.3 Pseudonymity, Not Anonymity

Your wallet address is pseudonymous. However, blockchain analytics, correlation with other services, or your own public disclosures may link your wallet address to your real-world identity. We do not control third-party blockchain analytics services.

[LEGAL REVIEW REQUIRED] Review whether on-chain permanence disclosures satisfy GDPR transparency requirements. Assess whether "right to be forgotten" obligations can be met through off-chain data deletion alone. Consider adding a pre-transaction consent mechanism for first-time on-chain interactions.

---

## 6. Data Retention

### 6.1 Off-Chain Data

| Data Category                            | Retention Period                                     | Deletion Method                                          |
| ---------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------- |
| User profiles (Firestore)                | Duration of account + 90 days after deletion request | Firestore document deletion                              |
| Content metadata                         | Duration of account + 90 days                        | Firestore document deletion                              |
| AI-generated content (Pinata/Lighthouse) | Indefinite (decentralized storage)                   | IPFS unpinning (Pinata); Filecoin deals expire naturally |
| Credit purchase history                  | 7 years (financial record-keeping)                   | Anonymization after retention period                     |
| Moderation records (flags, audit log)    | Indefinite (append-only audit trail)                 | Cannot be deleted (by design for integrity)              |
| Server access logs                       | 90 days                                              | Automatic rotation                                       |
| Session tokens (JWT)                     | Until expiration (configurable, typically 24 hours)  | Automatic expiry                                         |

### 6.2 On-Chain Data

On-chain data is retained permanently on the blockchain. We have no ability to delete or modify it. See Section 5.

[LEGAL REVIEW REQUIRED] Verify retention periods comply with applicable data protection laws. Ensure financial record retention meets jurisdictional requirements. Document justification for indefinite retention of moderation records. Implement automated data deletion workflows.

---

## 7. Your Rights

### 7.1 GDPR Rights (EEA/UK Users)

If you are located in the European Economic Area or United Kingdom, you have the following rights under the General Data Protection Regulation:

| Right                                 | How to Exercise                                                  | Limitations                                                                                                                                                                           |
| ------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Access**                            | Request a copy of all personal data we hold about you            | We will provide off-chain data; on-chain data is publicly accessible via block explorers                                                                                              |
| **Rectification**                     | Request correction of inaccurate data                            | Applies to off-chain data only (profile information, metadata). On-chain data cannot be corrected                                                                                     |
| **Erasure ("Right to be Forgotten")** | Request deletion of your personal data                           | We will delete off-chain data. **On-chain data cannot be deleted** (see Section 5). Content hashes, transaction records, and token history will persist permanently on the blockchain |
| **Restriction**                       | Request restriction of processing                                | We can restrict off-chain processing; on-chain transactions are processed by the network, not by us                                                                                   |
| **Portability**                       | Request your data in a portable format                           | We will provide off-chain data in JSON format. On-chain data is inherently portable (any block explorer or indexer can read it)                                                       |
| **Objection**                         | Object to processing based on legitimate interest                | We will cease processing unless we demonstrate compelling legitimate grounds                                                                                                          |
| **Automated decision-making**         | Not be subject to decisions based solely on automated processing | AI content generation is user-initiated; content moderation may involve automated flagging followed by human review                                                                   |

To exercise any of these rights, contact privacy@loar.fun. We will respond within 30 days.

### 7.2 CCPA Rights (California Users)

If you are a California resident, you have the following rights under the California Consumer Privacy Act:

- **Right to know**: What personal information we collect, use, and disclose.
- **Right to delete**: Request deletion of personal information (subject to the on-chain limitations described above).
- **Right to opt out of sale**: We do not sell personal information. If this changes, we will provide an opt-out mechanism.
- **Non-discrimination**: We will not discriminate against you for exercising your CCPA rights.

To exercise CCPA rights, contact privacy@loar.fun or use the mechanisms provided on the Platform.

### 7.3 Other Jurisdictions

Users in other jurisdictions may have additional rights under local data protection laws. Contact privacy@loar.fun for jurisdiction-specific inquiries.

[LEGAL REVIEW REQUIRED] Appoint a Data Protection Officer if required. Register with applicable data protection authorities. Establish formal data subject request handling procedures with response tracking. Determine whether a GDPR representative in the EEA is required (Article 27). Review CCPA "sale" definition against analytics and advertising practices. Assess applicability of other state privacy laws (Virginia CDPA, Colorado CPA, etc.).

---

## 8. Children's Privacy

The Platform is not intended for use by anyone under the age of 18. We do not knowingly collect personal information from children under 18.

If we become aware that we have collected personal information from a child under 18, we will take steps to delete that information promptly. If you believe a child under 18 has provided us with personal information, please contact privacy@loar.fun.

Due to the blockchain-based nature of the Platform, on-chain data generated by an underage user cannot be deleted (see Section 5). We will delete all off-chain data and restrict the associated wallet address from further Platform access.

[LEGAL REVIEW REQUIRED] Review obligations under COPPA (US), UK Age Appropriate Design Code, and EU Digital Services Act regarding minors. Determine whether age verification beyond self-declaration is required.

---

## 9. Security

We implement reasonable technical and organizational measures to protect your information, including:

- **Authentication**: Cryptographic wallet-based authentication (SIWE) -- no passwords stored.
- **Transport encryption**: HTTPS/TLS for all client-server communication.
- **Access controls**: Role-based access control for admin functions; Firebase security rules for database access.
- **Smart contract security**: Upgradeable contracts (UUPS proxy) with owner-only upgrade authorization; reentrancy guards; pausable functionality on critical contracts.
- **Pull-payment pattern**: Creator earnings accrue in the PaymentRouter contract and are claimed by the creator, reducing fund-in-transit risk.
- **Audit trail**: Append-only content audit log for moderation actions.

### Limitations

- The Platform is currently in testnet beta and has not undergone a comprehensive third-party security audit of all smart contracts.
- Blockchain transactions are public and observable by anyone.
- We cannot guarantee absolute security. No system is immune to all attacks.

If you discover a security vulnerability, please report it to security@loar.fun. Do not publicly disclose vulnerabilities before they are addressed.

[LEGAL REVIEW REQUIRED] Develop and document a formal incident response plan. Determine breach notification obligations under GDPR (72 hours), state breach notification laws, and other applicable frameworks. Schedule a third-party security audit before mainnet launch.

---

## 10. International Data Transfers

Your information may be processed in countries other than your country of residence, including the United States, where our service providers operate. When transferring data outside the EEA/UK, we rely on:

- Standard Contractual Clauses (SCCs) approved by the European Commission.
- Adequacy decisions where applicable.
- Contractual safeguards with data processors.

Blockchain data, by its nature, is replicated across a globally distributed network of nodes and is accessible from any jurisdiction.

[LEGAL REVIEW REQUIRED] Execute SCCs with all relevant processors. Conduct Transfer Impact Assessments (TIAs) for transfers to countries without adequacy decisions. Document supplementary measures where required.

---

## 11. Cookies and Tracking

The Platform uses:

- **Essential cookies/storage**: Session tokens (localStorage/sessionStorage) for authentication state. These are necessary for the Platform to function.
- **Analytics**: Usage analytics to understand Platform engagement. No cross-site tracking.

We do not use advertising cookies or share data with advertising networks.

[LEGAL REVIEW REQUIRED] Implement cookie consent mechanism compliant with ePrivacy Directive (EU) and applicable cookie laws. Document all cookies and tracking technologies in a cookie policy. Determine whether analytics implementation requires opt-in consent.

---

## 12. Changes to This Policy

We may update this Privacy Policy from time to time. Material changes will be communicated via the Platform interface. The "Last updated" date at the top of this document indicates when the latest revision was made.

We encourage you to review this Privacy Policy periodically.

---

## 13. Contact Us

For questions, concerns, or requests related to this Privacy Policy or your personal data:

- **Privacy inquiries**: privacy@loar.fun
- **Security reports**: security@loar.fun
- **General support**: support@loar.fun
- **DMCA/takedown**: dmca@loar.fun or loar.fun/dmca
- **Platform**: loar.fun

[LEGAL REVIEW REQUIRED] Establish a physical mailing address for privacy correspondence if required by applicable law. Determine whether a DPO designation is necessary and publish DPO contact details if so.
