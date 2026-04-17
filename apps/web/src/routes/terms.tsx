/**
 * Terms of Service page.
 *
 * Covers: acceptance, eligibility, accounts, service description, user content & IP classification,
 * AI-generated content, blockchain transactions, marketplace & fees, prohibited conduct,
 * content moderation, DMCA, disclaimers, limitation of liability, indemnification,
 * termination, governing law, dispute resolution, changes, severability, and contact.
 */
import { createFileRoute, Link } from '@tanstack/react-router';

export const Route = createFileRoute('/terms')({
  component: TermsPage,
});

function TermsPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-6 py-16">
        <h1 className="text-3xl font-bold mb-2">Terms of Service</h1>
        <p className="text-sm text-muted-foreground mb-8">Last updated: April 17, 2026</p>

        <div className="prose prose-invert max-w-none space-y-6 text-muted-foreground">
          <section>
            <h2 className="text-xl font-semibold text-foreground">1. Acceptance of Terms</h2>
            <p>
              By accessing or using LOAR at loar.fun (&quot;the Platform&quot;), operated by LOAR
              (&quot;the Company,&quot; &quot;we,&quot; &quot;us,&quot; or &quot;our&quot;), you
              agree to be bound by these Terms of Service (&quot;Terms&quot;). These Terms
              constitute a legally binding agreement between you and the Company. If you do not
              agree to all of these Terms, you must immediately cease using the Platform.
            </p>
            <p>
              Your use of the Platform is also governed by our{' '}
              <Link to="/privacy" className="text-primary underline">
                Privacy Policy
              </Link>
              , which is incorporated into these Terms by reference. By using the Platform, you
              acknowledge that you have read and understood both documents.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">2. Eligibility</h2>
            <p>
              You must be at least 18 years of age (or the age of majority in your jurisdiction,
              whichever is greater) to use the Platform. By using the Platform, you represent and
              warrant that: (a) you meet the minimum age requirement; (b) you have the legal
              capacity to enter into a binding agreement; (c) you are not prohibited by applicable
              law from using blockchain-based services, digital assets, or cryptocurrency; and (d)
              you are not located in, or a citizen or resident of, any jurisdiction subject to
              comprehensive sanctions by the United States, European Union, or United Nations.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">
              3. Account &amp; Wallet Authentication
            </h2>
            <p>
              Access to the Platform requires authentication via an Ethereum-compatible wallet using
              Sign-In with Ethereum (SIWE). Your wallet address serves as your account identifier.
              The Platform does not collect or store passwords, email addresses, or other
              traditional account credentials.
            </p>
            <p>
              You are solely responsible for: (a) maintaining the security of your wallet private
              keys and seed phrases; (b) all activity that occurs through your wallet on the
              Platform; and (c) ensuring that no unauthorized person has access to your wallet. The
              Company cannot recover lost wallet credentials, reset wallet access, or reverse
              transactions initiated from your wallet. If you suspect unauthorized use of your
              wallet on the Platform, notify us immediately at{' '}
              <a href="mailto:support@loar.fun" className="text-primary underline">
                support@loar.fun
              </a>
              .
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">4. Description of Service</h2>
            <p>
              LOAR is a decentralized narrative control suite that enables the creation, ownership,
              governance, and monetization of AI-generated and user-created content, including but
              not limited to images, videos, 3D models, voice content, and story universes. The
              Platform operates on the Base Layer 2 network (an Ethereum rollup) and uses smart
              contracts deployed on-chain for content registration, intellectual property
              management, governance token mechanics, and NFT minting and trading.
            </p>
            <p>
              The Platform integrates third-party AI model providers (including but not limited to
              FAL, OpenAI, ElevenLabs, and Meshy) to generate content based on user prompts and
              parameters. Content is stored using a combination of centralized infrastructure
              (Firebase/Google Cloud) and decentralized storage networks (Pinata/IPFS,
              Lighthouse/Filecoin).
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">
              5. User Content &amp; Intellectual Property
            </h2>
            <p>
              Content on the Platform is classified into one of three intellectual property lanes.
              You are solely responsible for accurately classifying your content at the time of
              upload or creation:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                <strong>Non-Commercial (Fan Works):</strong> Content that references, is inspired
                by, or derives from existing third-party intellectual property. This content may not
                be sold, licensed, or commercially exploited on the Platform. It is shared for
                personal, creative, and community purposes only.
              </li>
              <li>
                <strong>Creator-Owned (Original IP):</strong> Content that is wholly original to you
                or for which you hold all necessary rights. You retain full ownership of your
                original content. By publishing Creator-Owned content, you may sell, license, or
                mint it as NFTs on the Platform.
              </li>
              <li>
                <strong>Rights-Cleared (Licensed):</strong> Content that incorporates third-party
                intellectual property for which you have obtained explicit, documented permission or
                a valid license. You must be able to demonstrate proof of licensing upon request.
              </li>
            </ul>
            <p>
              By uploading or creating content on the Platform, you grant the Company a
              non-exclusive, worldwide, royalty-free, sublicensable license to display, distribute,
              reproduce, cache, index, and make available your content solely for the purpose of
              operating, promoting, and improving the Platform. This license continues for as long
              as your content remains on the Platform and for a reasonable period thereafter to
              allow for removal from caches and backups.
            </p>
            <p>
              Misclassification of content rights — whether intentional or negligent — may result in
              content removal, suspension of Platform access, forfeiture of associated revenue, and
              potential legal liability.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">6. AI-Generated Content</h2>
            <p>
              Content generated through the Platform&apos;s AI tools is produced by third-party
              machine learning models. The ownership and rights associated with AI-generated content
              depend on applicable law in your jurisdiction, which may vary and is evolving. The
              Company makes no representations or warranties regarding your ownership rights in
              AI-generated content.
            </p>
            <p>
              You acknowledge and agree that: (a) AI-generated outputs may be imperfect, factually
              inaccurate, unexpected, or potentially offensive; (b) similar prompts submitted by
              different users may produce similar or identical outputs; (c) the Company does not
              guarantee the uniqueness, originality, or non-infringement of any AI-generated
              content; (d) you are solely responsible for reviewing, editing, and approving all
              AI-generated content before publishing or minting it; and (e) AI model providers may
              retain the right to use prompts and outputs for model improvement as described in
              their respective terms of service.
            </p>
            <p>
              Generation parameters, prompts, and model selections are logged for moderation,
              billing, and quality assurance purposes.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">
              7. On-Chain Transactions &amp; Smart Contracts
            </h2>
            <p>
              Certain Platform features involve interactions with smart contracts deployed on the
              Base L2 blockchain network. You acknowledge and agree that:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                <strong>Irreversibility:</strong> Blockchain transactions, once confirmed, are
                permanent and cannot be reversed, cancelled, or modified by the Company or any third
                party. This includes but is not limited to NFT mints, token transfers, governance
                votes, and content hash registrations.
              </li>
              <li>
                <strong>Gas Fees:</strong> You are responsible for paying all network gas fees
                associated with on-chain transactions. Gas fees are paid to network validators, not
                to the Company, and are non-refundable regardless of whether the transaction
                succeeds or fails.
              </li>
              <li>
                <strong>Smart Contract Risk:</strong> Smart contracts are experimental software that
                may contain bugs, vulnerabilities, or unexpected behaviors. The Company has made
                reasonable efforts to test and audit its contracts but does not guarantee their
                flawless operation. You interact with smart contracts at your own risk.
              </li>
              <li>
                <strong>On-Chain Data Permanence:</strong> Content hashes, NFT metadata, transaction
                records, and governance actions recorded on-chain are publicly visible and
                permanent. Even if content is removed from the Platform interface, on-chain records
                will persist on the blockchain indefinitely.
              </li>
              <li>
                <strong>Network Conditions:</strong> Transaction confirmation times, gas prices, and
                network availability are determined by the underlying blockchain network and are
                outside the Company&apos;s control. The Company is not liable for delayed, failed,
                or stuck transactions due to network congestion or outages.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">
              8. Marketplace, NFTs &amp; Platform Fees
            </h2>
            <p>
              The Platform provides marketplace features for listing, buying, selling, and trading
              NFTs. When you engage in marketplace transactions, you agree that:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                The Company charges a platform fee on marketplace transactions, which is deducted
                automatically by the smart contract at the time of sale. Platform fees are
                configurable and are capped at 50% as enforced by the smart contract. Current fee
                rates are displayed at the time of each transaction.
              </li>
              <li>
                NFT purchases are final. Due to the nature of blockchain transactions, the Company
                cannot issue refunds for completed NFT purchases.
              </li>
              <li>
                Ownership of an NFT does not necessarily confer intellectual property rights in the
                underlying content unless explicitly stated in the associated license terms.
              </li>
              <li>
                The Company does not guarantee the value, liquidity, or future marketability of any
                NFT or token purchased or minted on the Platform.
              </li>
            </ul>
            <p>
              Credit purchases for AI generation features are non-refundable. Credits are consumed
              upon use of generation services regardless of whether you are satisfied with the
              output. Payment methods include cryptocurrency (ETH, $LOAR tokens) and, when
              available, card payments processed by third-party payment providers.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">9. $LOAR Token</h2>
            <p>
              The $LOAR token is a utility token used within the Platform for AI generation credits,
              governance participation, marketplace transactions, and ecosystem incentives. $LOAR is{' '}
              <strong>not a security, investment contract, or financial instrument</strong>. The
              Company makes no representations regarding the future value, price appreciation, or
              return on purchase of $LOAR tokens. Purchasing or holding $LOAR tokens does not
              entitle you to equity, dividends, profit sharing, or any ownership interest in the
              Company.
            </p>
            <p>You acknowledge and agree to the following token mechanics:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                <strong>Fee-on-Transfer:</strong> $LOAR token transfers may include a protocol fee
                that is automatically deducted by the smart contract on each transfer. This means
                the amount received by the recipient may be less than the amount sent by the sender.
                The fee rate is configurable by governance and is disclosed in the token contract.
                You are responsible for accounting for this fee when initiating transfers.
              </li>
              <li>
                <strong>Bonding Curve:</strong> $LOAR tokens may be bought and sold through an
                automated bonding curve smart contract, where the token price increases with supply
                and decreases with redemptions. Bonding curves carry inherent risk: early
                participants may receive lower prices while later participants pay higher prices,
                and large sell orders can significantly impact the price. The Company does not
                guarantee liquidity, price stability, or the ability to sell tokens at any
                particular price.
              </li>
              <li>
                <strong>Governance:</strong> $LOAR token holders may participate in Platform
                governance by voting on proposals. Governance votes are recorded on-chain and are
                permanent. Governance rights are limited to Platform parameters and do not confer
                corporate governance rights over the Company.
              </li>
            </ul>
            <p>
              Regulatory treatment of utility tokens varies by jurisdiction. You are solely
              responsible for determining whether your purchase, possession, or use of $LOAR tokens
              complies with applicable laws in your jurisdiction, including securities, tax, and
              money transmission regulations.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">10. Prohibited Conduct</h2>
            <p>You agree not to use the Platform to:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>
                Generate, upload, or distribute content depicting child sexual abuse material (CSAM)
                or the sexual exploitation of minors in any form
              </li>
              <li>
                Generate, upload, or distribute content that promotes or incites violence,
                terrorism, or hatred against individuals or groups based on race, ethnicity,
                religion, gender, sexual orientation, disability, or national origin
              </li>
              <li>
                Upload content that infringes third-party intellectual property rights, including
                copyrights, trademarks, or trade secrets
              </li>
              <li>
                Misclassify content rights to circumvent licensing, commercial restrictions, or
                rights enforcement
              </li>
              <li>
                Manipulate governance votes, token prices, marketplace rankings, or platform metrics
                through sybil attacks, wash trading, or other fraudulent means
              </li>
              <li>
                Attempt to exploit, attack, or probe vulnerabilities in smart contracts, APIs, or
                Platform infrastructure
              </li>
              <li>
                Circumvent rate limits, access controls, content filters, or moderation decisions
              </li>
              <li>
                Use automated tools (bots, scrapers, crawlers) to access the Platform without prior
                written permission
              </li>
              <li>Impersonate other users, creators, or Company representatives</li>
              <li>
                Use the Platform for money laundering, sanctions evasion, or any activity prohibited
                by applicable law
              </li>
              <li>
                Generate content that constitutes non-consensual intimate imagery of real persons
              </li>
            </ul>
            <p>
              Violation of these prohibitions may result in immediate content removal, account
              suspension, forfeiture of credits and revenue, and referral to law enforcement where
              appropriate.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">11. Content Moderation</h2>
            <p>
              The Company reserves the right to review, flag, hide, or remove any content on the
              Platform that violates these Terms or applicable law. Content may be assigned one of
              the following moderation statuses: active, flagged, under review, hidden, removed, or
              reinstated. Content that is flagged, under review, or hidden may be temporarily or
              permanently restricted from commercial transactions (including minting, listing, and
              licensing).
            </p>
            <p>
              Users may report content they believe violates these Terms by using the flag feature
              available on content pages. The Company will review flagged content and take
              appropriate action. Moderation decisions are logged in an immutable audit trail.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">
              12. DMCA &amp; Copyright Takedowns
            </h2>
            <p>
              The Company respects intellectual property rights and complies with the Digital
              Millennium Copyright Act (DMCA). If you believe that content on the Platform infringes
              your copyright, you may submit a takedown notice through our{' '}
              <Link to={'/dmca' as any} className="text-primary underline">
                DMCA page
              </Link>{' '}
              or by emailing{' '}
              <a href="mailto:legal@loar.fun" className="text-primary underline">
                legal@loar.fun
              </a>
              .
            </p>
            <p>
              A valid DMCA notice must include: (a) identification of the copyrighted work; (b)
              identification of the infringing material and its location on the Platform; (c) your
              contact information; (d) a statement of good faith belief that the use is not
              authorized; (e) a statement under penalty of perjury that the information is accurate
              and that you are the copyright owner or authorized to act on their behalf; and (f)
              your physical or electronic signature.
            </p>
            <p>
              Upon receipt of a valid takedown notice, the Company will remove or disable access to
              the allegedly infringing content from the Platform interface. Please note that content
              hashes recorded on the blockchain cannot be removed or modified, as they exist on a
              decentralized public ledger outside the Company&apos;s control. This limitation is
              disclosed in the takedown submission process.
            </p>
            <p>
              Repeat infringers will have their Platform access terminated in accordance with DMCA
              requirements.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">13. Disclaimers</h2>
            <p>
              THE PLATFORM IS PROVIDED &quot;AS IS&quot; AND &quot;AS AVAILABLE&quot; WITHOUT
              WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO
              IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE,
              NON-INFRINGEMENT, AND TITLE. THE COMPANY DOES NOT WARRANT THAT: (A) THE PLATFORM WILL
              BE UNINTERRUPTED, TIMELY, SECURE, OR ERROR-FREE; (B) THE RESULTS OBTAINED FROM USE OF
              THE PLATFORM WILL BE ACCURATE OR RELIABLE; (C) SMART CONTRACTS WILL FUNCTION WITHOUT
              BUGS OR VULNERABILITIES; (D) AI-GENERATED CONTENT WILL BE FREE FROM ERRORS, BIAS, OR
              OFFENSIVE MATERIAL; OR (E) ANY DEFECTS IN THE PLATFORM WILL BE CORRECTED.
            </p>
            <p>
              THE COMPANY MAKES NO REPRESENTATIONS REGARDING THE VALUE, FUTURE VALUE, OR INVESTMENT
              POTENTIAL OF ANY TOKEN, NFT, OR DIGITAL ASSET AVAILABLE ON THE PLATFORM. DIGITAL
              ASSETS ARE INHERENTLY VOLATILE AND SPECULATIVE. NOTHING ON THE PLATFORM CONSTITUTES
              FINANCIAL, INVESTMENT, LEGAL, OR TAX ADVICE.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">14. Limitation of Liability</h2>
            <p>
              TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, THE COMPANY, ITS OFFICERS,
              DIRECTORS, EMPLOYEES, AGENTS, AND AFFILIATES SHALL NOT BE LIABLE FOR ANY INDIRECT,
              INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY, OR PUNITIVE DAMAGES, INCLUDING BUT NOT
              LIMITED TO: (A) LOSS OF FUNDS, TOKENS, OR DIGITAL ASSETS; (B) LOSS OF DATA OR CONTENT;
              (C) LOSS OF REVENUE, PROFITS, OR BUSINESS OPPORTUNITIES; (D) DAMAGES ARISING FROM
              SMART CONTRACT BUGS, EXPLOITS, OR VULNERABILITIES; (E) DAMAGES ARISING FROM BLOCKCHAIN
              NETWORK FAILURES, FORKS, OR REORGANIZATIONS; (F) DAMAGES ARISING FROM UNAUTHORIZED
              ACCESS TO YOUR WALLET; (G) DAMAGES ARISING FROM THE ACTIONS OR OMISSIONS OF
              THIRD-PARTY SERVICE PROVIDERS; OR (H) DAMAGES ARISING FROM THE PERMANENT AND
              IRREVOCABLE NATURE OF BLOCKCHAIN TRANSACTIONS.
            </p>
            <p>
              IN NO EVENT SHALL THE COMPANY&apos;S TOTAL AGGREGATE LIABILITY TO YOU FOR ALL CLAIMS
              ARISING FROM OR RELATING TO THESE TERMS OR YOUR USE OF THE PLATFORM EXCEED THE GREATER
              OF: (A) THE TOTAL FEES PAID BY YOU TO THE COMPANY IN THE TWELVE (12) MONTHS PRECEDING
              THE EVENT GIVING RISE TO THE CLAIM; OR (B) ONE HUNDRED US DOLLARS ($100).
            </p>
            <p>
              SOME JURISDICTIONS DO NOT ALLOW THE EXCLUSION OR LIMITATION OF CERTAIN DAMAGES. IN
              SUCH JURISDICTIONS, THE ABOVE LIMITATIONS SHALL APPLY TO THE MAXIMUM EXTENT PERMITTED
              BY LAW.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">15. Indemnification</h2>
            <p>
              You agree to indemnify, defend, and hold harmless the Company and its officers,
              directors, employees, agents, and affiliates from and against any and all claims,
              liabilities, damages, losses, costs, and expenses (including reasonable
              attorneys&apos; fees) arising from or related to: (a) your use of the Platform; (b)
              your violation of these Terms; (c) your content, including any intellectual property
              claims related to content you upload or generate; (d) your violation of any applicable
              law or regulation; or (e) your interaction with smart contracts deployed on the
              Platform.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">16. Termination</h2>
            <p>
              The Company may suspend or terminate your access to the Platform at any time, with or
              without notice, for violation of these Terms, suspected fraudulent activity, legal
              requirements, or at our sole discretion. You may discontinue use of the Platform at
              any time.
            </p>
            <p>
              Upon termination: (a) your license to use the Platform ceases immediately; (b)
              on-chain assets, NFTs, and tokens in your wallet remain in your possession as they
              exist on the blockchain independently of the Platform; (c) off-chain content may be
              retained or deleted at the Company&apos;s discretion; (d) any accrued and unpaid fees
              remain payable; and (e) provisions of these Terms that by their nature should survive
              termination (including Sections 5, 6, 7, 9, 13, 14, 15, and 17) shall survive.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">
              17. Governing Law &amp; Dispute Resolution
            </h2>
            <p>
              These Terms shall be governed by and construed in accordance with the laws of the
              State of Delaware, United States, without regard to its conflict of law principles.
            </p>
            <p>
              Any dispute, controversy, or claim arising out of or relating to these Terms or the
              Platform shall first be attempted to be resolved through good-faith negotiation. If
              negotiation is unsuccessful within thirty (30) days, either party may initiate binding
              arbitration administered under the rules of the American Arbitration Association. The
              arbitration shall be conducted in English, and the seat of arbitration shall be
              Wilmington, Delaware. Judgment on the arbitration award may be entered in any court of
              competent jurisdiction.
            </p>
            <p>
              YOU AND THE COMPANY AGREE THAT ANY DISPUTE RESOLUTION PROCEEDINGS WILL BE CONDUCTED
              ONLY ON AN INDIVIDUAL BASIS AND NOT IN A CLASS, CONSOLIDATED, OR REPRESENTATIVE
              ACTION. YOU WAIVE YOUR RIGHT TO PARTICIPATE IN A CLASS ACTION LAWSUIT OR CLASS-WIDE
              ARBITRATION.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">18. Changes to These Terms</h2>
            <p>
              The Company reserves the right to modify these Terms at any time. Material changes
              will be communicated by updating the &quot;Last updated&quot; date at the top of this
              page and, where practicable, through a notice on the Platform. Your continued use of
              the Platform following any changes constitutes acceptance of the revised Terms. If you
              do not agree to the updated Terms, you must discontinue use of the Platform.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">19. Severability</h2>
            <p>
              If any provision of these Terms is held to be invalid, illegal, or unenforceable, the
              remaining provisions shall continue in full force and effect. The invalid provision
              shall be modified to the minimum extent necessary to make it valid and enforceable
              while preserving its original intent.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">20. Entire Agreement</h2>
            <p>
              These Terms, together with the Privacy Policy and any additional terms applicable to
              specific Platform features, constitute the entire agreement between you and the
              Company regarding your use of the Platform and supersede all prior agreements,
              representations, and understandings.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">21. Contact</h2>
            <p>For questions about these Terms, contact us at:</p>
            <p>
              <strong>General inquiries:</strong>{' '}
              <a href="mailto:support@loar.fun" className="text-primary underline">
                support@loar.fun
              </a>
              <br />
              <strong>Legal matters:</strong>{' '}
              <a href="mailto:legal@loar.fun" className="text-primary underline">
                legal@loar.fun
              </a>
              <br />
              <strong>DMCA / Copyright:</strong>{' '}
              <Link to={'/dmca' as any} className="text-primary underline">
                /dmca
              </Link>
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
