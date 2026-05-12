# LOAR Platform -- Terms of Service

> **Status**: Draft scaffold for legal review. All clauses marked [LEGAL REVIEW REQUIRED] need attorney sign-off before publication.
>
> **Last updated**: 2026-04-17
>
> **Effective date**: [TO BE SET ON PUBLICATION]
>
> **Platform**: loar.fun

---

## 1. Acceptance of Terms

By accessing or using the LOAR platform ("Platform"), including the website at loar.fun, any associated smart contracts deployed on the Base L2 blockchain or testnets, and any APIs or services provided by LOAR ("Services"), you ("User", "you") agree to be bound by these Terms of Service ("Terms").

If you do not agree to these Terms, you must not access or use the Platform.

We reserve the right to modify these Terms at any time. Material changes will be communicated via the Platform interface at least 30 days before taking effect. Your continued use of the Platform after changes take effect constitutes acceptance of the revised Terms.

[LEGAL REVIEW REQUIRED] Determine appropriate change notification mechanism and whether affirmative re-consent is required for material changes.

---

## 2. Eligibility

To use the Platform, you must:

- Be at least 18 years of age (or the age of majority in your jurisdiction, whichever is higher).
- Not be a resident of, or located in, any jurisdiction where use of blockchain-based services or AI content generation is prohibited by applicable law.
- Not be listed on any sanctions list maintained by the United States (OFAC), the European Union, the United Kingdom, or any other applicable jurisdiction.
- Not have been previously banned from the Platform for violations of these Terms.

By using the Platform, you represent and warrant that you meet all eligibility requirements.

[LEGAL REVIEW REQUIRED] Enumerate specific sanctioned jurisdictions. Determine whether KYC/KYB verification is required at any usage threshold. Review age verification obligations under applicable child protection laws.

---

## 3. Account and Wallet Authentication

### 3.1 Wallet-Based Authentication

The Platform uses Sign-In with Ethereum (SIWE) for authentication. When you sign in with email, Google, Apple, or passkey, the Platform provisions a Developer-Controlled Wallet through our wallet-infrastructure provider (Circle). The Platform may also accept external wallets you connect yourself (such as MetaMask, Coinbase Wallet, or WalletConnect-compatible wallets) where supported.

### 3.2 Custody and Account Security

For Developer-Controlled Wallets, private keys are generated and stored inside Circle's hardware-backed key management infrastructure and are never exposed to the Platform or to you. The Platform requests signatures on your behalf only when you initiate an authenticated action through your account. You are responsible for:

- Protecting the email address, social login, or passkey used to access your account.
- All activity conducted through your authenticated session.
- Any losses resulting from unauthorized access to the credentials that unlock your account.

For external wallets you connect yourself, you remain solely responsible for the security of your private keys and seed phrase.

### 3.3 Session Tokens

Upon successful SIWE authentication, the Platform issues a JSON Web Token (JWT) for session management. Sessions may expire and require re-authentication. The Platform does not store passwords or wallet credentials.

[LEGAL REVIEW REQUIRED] Determine liability allocation for wallet compromise scenarios. Review whether session token handling meets applicable data protection requirements.

---

## 4. AI-Generated Content

### 4.1 Content Generation

The Platform provides AI-powered content generation services, including but not limited to image generation, video generation, story generation, and character creation. These services are powered by third-party AI models and are accessed through the Platform's credit system.

### 4.2 Ownership of Prompts

You retain ownership of the text prompts, descriptions, and creative direction you provide to the AI generation system. Your prompts are your original creative input.

### 4.3 AI Output Ownership and Limitations

The legal status of copyright in AI-generated content is evolving and varies by jurisdiction. You acknowledge that:

- AI-generated outputs may not qualify for copyright protection in all jurisdictions.
- The Platform makes no representation or warranty that AI-generated content is copyrightable, unique, or free from similarity to existing works.
- Multiple users may generate similar or identical outputs from similar prompts.
- The Platform may embed provenance metadata (including generation parameters, timestamps, and content hashes) in AI-generated content for attribution and integrity purposes.

### 4.4 Content Hashing

AI-generated content may be hashed (SHA-256) and the hash stored on-chain for provenance verification. The content itself is stored via decentralized storage providers (Pinata, Lighthouse) and may be publicly accessible.

### 4.5 No Guarantee of Availability

AI model providers may change, become unavailable, or modify their outputs. The Platform does not guarantee continuous availability of any specific AI model or generation capability.

[LEGAL REVIEW REQUIRED] Review AI output ownership claims under current copyright guidance (US Copyright Office, EU AI Act). Determine whether additional disclaimers are needed regarding AI training data provenance. Assess liability for AI-generated content that infringes third-party rights.

---

## 5. User-Generated Content and Intellectual Property

### 5.1 Rights Classification

The Platform classifies content into three categories:

- **Fan Content**: Derivative works based on existing third-party IP. The Platform does not grant rights to underlying IP. Fan content may have limited commercial use.
- **Original Content**: Content created from scratch by the User. The User retains full intellectual property rights to original content.
- **Licensed Content**: Content that incorporates IP licensed from other creators on the Platform. Usage rights are governed by the specific license terms.

### 5.2 Creator IP Retention

Creators retain ownership of their original intellectual property, including universe concepts, character designs, storylines, and world-building elements. By using the Platform, you grant LOAR a non-exclusive, worldwide license to display, distribute, and promote your content within the Platform ecosystem, including for marketing purposes.

### 5.3 On-Chain Representation

Content may be represented on-chain as NFTs (ERC-721 tokens) or referenced via content hashes in smart contract events. On-chain records are immutable and cannot be deleted (see Section 7).

### 5.4 License to Platform

By uploading or generating content on the Platform, you grant LOAR a non-exclusive, royalty-free, worldwide license to:

- Store and display your content on the Platform.
- Create thumbnails, previews, and metadata for discovery purposes.
- Include your content in Platform marketing materials (with attribution).
- Process your content through AI systems for features you initiate (e.g., style transfer, character extraction).

This license does not transfer ownership. You may request removal of off-chain content at any time (subject to Section 7 regarding on-chain data).

[LEGAL REVIEW REQUIRED] Define scope of platform license precisely. Review enforceability of fan content limitations. Determine whether DMCA safe harbor provisions apply to AI-generated derivative works.

---

## 6. On-Chain Transactions

### 6.1 Irreversibility

Blockchain transactions are irreversible by design. Once a transaction is confirmed on the Ethereum network or Base L2, it cannot be undone, reversed, or modified. This includes but is not limited to:

- NFT minting and transfers
- Token purchases and swaps
- Governance votes
- Content hash submissions
- Smart contract interactions

### 6.2 Gas Fees

You are responsible for all gas fees (network transaction costs) incurred when interacting with the Platform's smart contracts. Gas fees are paid to network validators, not to LOAR, and are non-refundable.

### 6.3 Testnet vs. Mainnet

The Platform currently operates on Ethereum Sepolia and Base Sepolia testnets. Testnet tokens and assets have no monetary value. When the Platform migrates to Base L2 mainnet:

- Testnet assets will not automatically transfer to mainnet.
- All mainnet transactions will involve real assets with monetary value.
- The Platform will provide advance notice of the mainnet migration timeline.

### 6.4 Smart Contract Risk

Smart contracts are software and may contain bugs, vulnerabilities, or unexpected behaviors. You acknowledge that interacting with smart contracts carries inherent risk, including potential loss of funds. The Platform's contracts are upgradeable (UUPS proxy pattern) and may be modified by the contract owner.

[LEGAL REVIEW REQUIRED] Review liability limitations for smart contract failures. Determine disclosure requirements for upgradeable contracts. Assess whether testnet-to-mainnet migration creates any obligation to users.

---

## 7. DMCA and Content Takedowns

### 7.1 Reporting Infringement

If you believe content on the Platform infringes your copyright or other intellectual property rights, you may submit a takedown request through the Platform's DMCA form at loar.fun/dmca, or by contacting us at the address listed in Section 15.

### 7.2 Takedown Process

Upon receiving a valid takedown request, LOAR will:

1. Review the request for completeness and validity.
2. If valid, restrict access to the identified off-chain content (images, videos, metadata) by marking it as hidden or removed.
3. Notify the content creator of the takedown and provide an opportunity to respond.

### 7.3 On-Chain Data Limitation

**You acknowledge that on-chain data, including content hashes, transaction records, token ownership history, and smart contract events, cannot be deleted or modified.** Takedown actions apply only to off-chain content served by the Platform. On-chain references (hashes, metadata URIs, token records) will persist on the blockchain permanently regardless of any takedown action.

### 7.4 Counter-Notice

If you believe your content was wrongly taken down, you may submit a counter-notice. The counter-notice process will be made available in a future Platform update.

### 7.5 Repeat Infringers

LOAR reserves the right to terminate the accounts of users who are repeat infringers.

[LEGAL REVIEW REQUIRED] Ensure DMCA compliance (17 U.S.C. Section 512). Designate DMCA agent with the Copyright Office. Review whether blockchain permanence disclosures satisfy legal obligations. Establish counter-notice timeline and procedures. Consider EU Digital Services Act obligations.

---

## 8. Prohibited Conduct

You agree not to:

1. **Illegal activity**: Use the Platform for any activity that violates applicable law, including money laundering, terrorist financing, fraud, or sanctions evasion.
2. **Harmful content**: Generate, upload, or distribute content that depicts child sexual abuse material (CSAM), non-consensual intimate imagery, or content that incites violence against identifiable groups.
3. **Intellectual property abuse**: Systematically generate content that copies or closely imitates specific copyrighted works, trademarks, or the likeness of real individuals without authorization.
4. **Market manipulation**: Engage in wash trading, sockpuppet voting, artificial volume generation, or any form of market manipulation involving Platform tokens or NFTs.
5. **System abuse**: Attempt to exploit, hack, or interfere with Platform smart contracts, APIs, or infrastructure. This includes but is not limited to reentrancy attacks, front-running, sandwich attacks, and denial-of-service.
6. **Circumvention**: Bypass content moderation, access controls, rate limits, or any other Platform restrictions.
7. **Impersonation**: Misrepresent your identity, affiliation, or the origin of content.
8. **Spam**: Flood the Platform with bulk content generation, duplicate submissions, or automated interactions without authorization.
9. **Scraping**: Systematically extract Platform data, AI-generated content, or user information without written permission.

Violation of these prohibitions may result in content removal, account suspension, or permanent ban, at LOAR's sole discretion.

[LEGAL REVIEW REQUIRED] Review prohibited conduct list for completeness under applicable consumer protection and platform liability frameworks. Assess enforcement mechanisms and due process requirements.

---

## 9. Fees and Payments

### 9.1 Credit System

The Platform uses an internal credit system for AI content generation. Credits are purchased in packages and consumed when generating content. Credit costs vary by generation type (e.g., image, video, story, character, scene).

### 9.2 Payment Methods

The Platform accepts:

- **ETH**: Direct cryptocurrency payment via connected wallet.
- **$LOAR**: Platform token payment at a reduced margin (25% vs. 35% for other methods), with bonus credits.
- **Credit/debit card**: Via third-party payment processors (Stripe), where available.

### 9.3 Pricing

All prices are denominated in ETH or $LOAR. Fiat-equivalent prices are approximate and subject to exchange rate fluctuations. The Platform reserves the right to modify credit package pricing at any time.

### 9.4 Platform Fees

The Platform charges fees on certain transactions routed through the PaymentRouter smart contract. Fees are configurable and disclosed at the time of transaction. Current fee structures include:

- Platform fee on NFT mints, subscriptions, and marketplace transactions (percentage disclosed per transaction).
- $LOAR transfer fee of 0.01% routed to the liquidity pool.
- Premium action fees (LoarBurner) disclosed at time of purchase.

### 9.5 Refund Policy

- **On-chain transactions**: Non-refundable. Blockchain transactions cannot be reversed.
- **Unused credits**: Credits do not expire but are non-transferable and non-refundable except where required by applicable law.
- **Failed generations**: If an AI generation fails due to a Platform error (not a user input issue), credits will be automatically refunded to your balance.

[LEGAL REVIEW REQUIRED] Review refund policy for compliance with consumer protection laws (EU Consumer Rights Directive, state-specific refund requirements). Determine whether credits constitute stored value requiring money transmitter licensing. Assess tax implications of credit purchases and token transactions.

---

## 10. Disclaimer of Warranties

THE PLATFORM IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED.

The Platform is currently in **testnet beta**. You acknowledge that:

- The Platform may contain bugs, errors, and incomplete features.
- Smart contracts have not undergone a comprehensive third-party security audit.
- AI generation outputs may be inconsistent, biased, or contain artifacts.
- Uptime, availability, and performance are not guaranteed.
- Token prices and NFT values may fluctuate significantly or decline to zero.
- Third-party services (AI providers, storage providers, blockchain networks) may experience outages or discontinuation.

LOAR disclaims all warranties, including but not limited to implied warranties of merchantability, fitness for a particular purpose, non-infringement, and any warranties arising out of course of dealing or usage of trade.

[LEGAL REVIEW REQUIRED] Ensure disclaimer language meets enforceability requirements in target jurisdictions. Some jurisdictions do not allow exclusion of implied warranties.

---

## 11. Limitation of Liability

TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, LOAR, ITS OFFICERS, DIRECTORS, EMPLOYEES, AGENTS, AND AFFILIATES SHALL NOT BE LIABLE FOR:

- Any indirect, incidental, special, consequential, or punitive damages.
- Loss of profits, data, use, goodwill, or other intangible losses.
- Damages resulting from smart contract vulnerabilities, blockchain network failures, or third-party service outages.
- Damages resulting from unauthorized access to your wallet or account.
- Damages resulting from AI-generated content that infringes third-party rights.
- Any loss of tokens, NFTs, or other digital assets, whether caused by Platform errors, smart contract bugs, or market conditions.

IN NO EVENT SHALL LOAR'S TOTAL LIABILITY EXCEED THE GREATER OF (A) THE AMOUNT YOU PAID TO LOAR IN THE 12 MONTHS PRECEDING THE CLAIM, OR (B) $100 USD.

[LEGAL REVIEW REQUIRED] Review liability cap amount. Ensure enforceability in target jurisdictions. Some jurisdictions do not allow limitation of liability for certain types of damages (e.g., personal injury, fraud).

---

## 12. Indemnification

You agree to indemnify, defend, and hold harmless LOAR and its officers, directors, employees, and agents from any claims, damages, losses, or expenses (including reasonable attorneys' fees) arising out of:

- Your use of the Platform.
- Your violation of these Terms.
- Your violation of any third-party rights, including intellectual property rights.
- Content you generate, upload, or distribute through the Platform.

[LEGAL REVIEW REQUIRED] Review indemnification scope. Some jurisdictions limit enforceability of broad indemnification clauses in consumer contracts.

---

## 13. Dispute Resolution

### 13.1 Informal Resolution

Before initiating formal dispute resolution, you agree to contact LOAR and attempt to resolve any dispute informally for at least 30 days.

### 13.2 Arbitration

Any dispute not resolved informally shall be resolved by binding arbitration, except where prohibited by law. The arbitration shall be conducted under the rules of [ARBITRATION BODY TO BE DETERMINED].

### 13.3 Class Action Waiver

To the extent permitted by law, you agree to resolve disputes on an individual basis and waive any right to participate in a class action, collective action, or representative proceeding.

[LEGAL REVIEW REQUIRED] Select arbitration body and rules. Determine governing jurisdiction. Review enforceability of class action waiver (varies significantly by jurisdiction, particularly in EU). Consider whether mandatory arbitration is appropriate or whether certain claims should be carved out.

---

## 14. Governing Law

These Terms shall be governed by and construed in accordance with the laws of [JURISDICTION TO BE DETERMINED], without regard to its conflict of laws provisions.

[LEGAL REVIEW REQUIRED] Select governing law jurisdiction. Consider implications for users in the EU (mandatory consumer protection applies regardless of choice of law), California (specific consumer protection statutes), and other jurisdictions with strong consumer protection frameworks.

---

## 15. Contact Information

For questions about these Terms, contact:

- **Email**: legal@loar.fun
- **DMCA inquiries**: dmca@loar.fun or via the form at loar.fun/dmca
- **Platform**: loar.fun

---

## 16. Severability

If any provision of these Terms is found to be unenforceable or invalid, that provision shall be limited or eliminated to the minimum extent necessary, and the remaining provisions shall remain in full force and effect.

---

## 17. Entire Agreement

These Terms, together with the Privacy Policy and any other policies referenced herein, constitute the entire agreement between you and LOAR regarding your use of the Platform.
