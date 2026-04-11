/**
 * Terms of Service page.
 *
 * Covers: acceptance, service description, user content & IP classification,
 * blockchain immutability, AI-generated content, payments & credits,
 * prohibited conduct, DMCA, disclaimers, liability, and termination.
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
        <p className="text-sm text-muted-foreground mb-8">Last updated: April 10, 2026</p>

        <div className="prose prose-invert max-w-none space-y-6 text-muted-foreground">
          <section>
            <h2 className="text-xl font-semibold text-foreground">1. Acceptance of Terms</h2>
            <p>
              By accessing or using LOAR at loar.fun (&quot;the Platform&quot;), you agree to be
              bound by these Terms of Service (&quot;Terms&quot;). If you do not agree to all of
              these Terms, do not access or use the Platform. We may update these Terms from time to
              time; continued use after changes constitutes acceptance.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">2. Description of Service</h2>
            <p>
              LOAR is a decentralized narrative platform that enables creation, ownership, and
              monetization of AI-generated and user-created content, including but not limited to
              videos, images, 3D models, voice, and story universes. The Platform operates on
              Ethereum and Base blockchains and uses smart contracts for governance, token
              economics, and content registration.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">3. Eligibility</h2>
            <p>
              You must be at least 18 years of age (or the age of majority in your jurisdiction) to
              use the Platform. By using the Platform, you represent that you meet this requirement
              and that you are not prohibited by applicable law from using blockchain-based
              services.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">
              4. User Content &amp; Intellectual Property
            </h2>
            <p>
              Content uploaded to LOAR is classified into one of three lanes: Non-Commercial (fan
              works), Creator-Owned (original IP), or Rights-Cleared (licensed from third parties).
              You are solely responsible for the accurate classification of your content.
            </p>
            <p>
              You retain ownership of original content you create. By uploading content, you grant
              LOAR a non-exclusive, worldwide license to display, distribute, and index your content
              on the Platform. Misclassification of rights status may result in content removal,
              account suspension, or legal liability.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">5. Blockchain Transactions</h2>
            <p>
              Certain actions on the Platform involve blockchain transactions that are irreversible
              once confirmed. Content hashes, NFT metadata, and transaction records stored on-chain
              cannot be deleted or modified. You are solely responsible for securing your wallet
              credentials and private keys. LOAR cannot recover lost wallets or reverse on-chain
              transactions.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">6. AI-Generated Content</h2>
            <p>
              The Platform uses third-party AI services (including but not limited to FAL, OpenAI,
              ElevenLabs, and Meshy) to generate content. AI-generated outputs may be imperfect,
              unexpected, or potentially offensive. LOAR does not guarantee the accuracy, quality,
              or appropriateness of AI-generated content. You are responsible for reviewing all
              generated content before publishing.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">7. Payments &amp; Credits</h2>
            <p>
              Credit purchases are non-refundable. Credits are consumed when you use AI generation
              features. Payment methods include cryptocurrency (ETH, $LOAR tokens) and, when
              available, card payments via Stripe. All prices are in USD unless otherwise stated.
              Cryptocurrency payments are verified on-chain before credits are issued.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">8. Prohibited Conduct</h2>
            <p>You agree not to:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>Upload content that infringes third-party intellectual property rights</li>
              <li>Misclassify content rights to circumvent licensing or commercial restrictions</li>
              <li>
                Manipulate governance votes, token prices, or marketplace rankings through
                fraudulent means
              </li>
              <li>Attempt to exploit smart contract vulnerabilities</li>
              <li>Use the Platform to generate illegal, harmful, or abusive content</li>
              <li>Circumvent rate limits, access controls, or moderation decisions</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">9. DMCA &amp; Takedowns</h2>
            <p>
              LOAR complies with the Digital Millennium Copyright Act (DMCA). To submit a copyright
              takedown request, visit our{' '}
              <Link to="/dmca" className="text-primary underline">
                DMCA page
              </Link>
              . Upon receipt of a valid takedown notice, we will remove or disable access to the
              allegedly infringing content. On-chain content hashes cannot be removed from the
              blockchain, but associated content will be hidden from the Platform interface.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">10. Disclaimers</h2>
            <p>
              THE PLATFORM IS PROVIDED &quot;AS IS&quot; AND &quot;AS AVAILABLE&quot; WITHOUT
              WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED. LOAR DOES NOT WARRANT THAT THE PLATFORM
              WILL BE UNINTERRUPTED, ERROR-FREE, OR SECURE. SMART CONTRACTS ARE EXPERIMENTAL
              SOFTWARE AND MAY CONTAIN BUGS. USE AT YOUR OWN RISK.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">11. Limitation of Liability</h2>
            <p>
              TO THE MAXIMUM EXTENT PERMITTED BY LAW, LOAR AND ITS OPERATORS SHALL NOT BE LIABLE FOR
              ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING BUT
              NOT LIMITED TO LOSS OF FUNDS, DATA, OR REVENUE, ARISING FROM YOUR USE OF THE PLATFORM
              OR SMART CONTRACTS.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">12. Termination</h2>
            <p>
              We may suspend or terminate your access to the Platform at any time for violation of
              these Terms or for any reason at our discretion. On-chain assets and data persist
              independently of Platform access.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">13. Governing Law</h2>
            <p>
              These Terms shall be governed by and construed in accordance with the laws of the
              State of Delaware, United States, without regard to conflict of law principles.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">14. Contact</h2>
            <p>
              For questions about these Terms, contact:{' '}
              <a href="mailto:legal@loar.fun" className="text-primary underline">
                legal@loar.fun
              </a>
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
