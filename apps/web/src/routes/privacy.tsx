/**
 * Privacy Policy page.
 *
 * Covers: data collection, usage, blockchain data, storage, third-party
 * services, data retention, cookies, children, rights, and contact.
 */
import { createFileRoute, Link } from '@tanstack/react-router';

export const Route = createFileRoute('/privacy')({
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-6 py-16">
        <h1 className="text-3xl font-bold mb-2">Privacy Policy</h1>
        <p className="text-sm text-muted-foreground mb-8">Last updated: April 10, 2026</p>

        <div className="prose prose-invert max-w-none space-y-6 text-muted-foreground">
          <section>
            <p>
              This Privacy Policy describes how LOAR (&quot;we&quot;, &quot;us&quot;, &quot;the
              Platform&quot;) collects, uses, and shares information when you use loar.fun.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">1. Information We Collect</h2>
            <p>
              <strong>Information you provide:</strong>
            </p>
            <ul className="list-disc pl-6 space-y-1">
              <li>Wallet addresses (via Sign-In with Ethereum authentication)</li>
              <li>Content you upload (videos, images, 3D models, text, voice)</li>
              <li>Profile information (username, bio, social links)</li>
              <li>Payment information (transaction hashes, credit purchase records)</li>
            </ul>
            <p className="mt-3">
              <strong>Information collected automatically:</strong>
            </p>
            <ul className="list-disc pl-6 space-y-1">
              <li>Usage data (generation history, feature interactions, page views)</li>
              <li>Device and browser information (user agent, screen size)</li>
              <li>IP address (used for rate limiting and abuse prevention)</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">2. How We Use Your Data</h2>
            <ul className="list-disc pl-6 space-y-1">
              <li>Authenticate your identity via wallet signature (SIWE)</li>
              <li>Process payments and credit transactions</li>
              <li>Store, serve, and index your content</li>
              <li>Enforce content moderation and rights classification policies</li>
              <li>Prevent abuse through rate limiting and fraud detection</li>
              <li>Improve platform functionality and user experience</li>
              <li>Communicate important updates about the Platform or your account</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">3. Blockchain Data</h2>
            <p>
              Certain data is stored on public blockchains (Ethereum, Base) and{' '}
              <strong>cannot be deleted or modified</strong>. This includes content hashes, NFT
              metadata, token transactions, and governance records. This data is publicly visible by
              design and is not controlled by LOAR. We cannot fulfill deletion requests for on-chain
              data.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">4. Data Storage</h2>
            <p>
              Off-chain data is stored in Firebase (Google Cloud, US regions). Content may be
              distributed across decentralized storage providers for redundancy and permanence:
            </p>
            <ul className="list-disc pl-6 space-y-1">
              <li>Pinata (IPFS) for public content delivery</li>
              <li>Lighthouse (Filecoin) for permanent and encrypted storage</li>
              <li>Firebase Storage as availability fallback</li>
            </ul>
            <p className="mt-2">
              Content stored on decentralized networks may be cached or replicated by third-party
              nodes beyond our control.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">5. Third-Party Services</h2>
            <p>We share data with the following categories of service providers:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>
                <strong>AI generation providers</strong> (FAL, OpenAI, ElevenLabs, Meshy) — receive
                your prompts and content to generate outputs
              </li>
              <li>
                <strong>Payment processor</strong> (Stripe) — processes card payment information
                when available
              </li>
              <li>
                <strong>Wallet connection</strong> (Dynamic Labs) — facilitates wallet
                authentication
              </li>
              <li>
                <strong>Infrastructure</strong> (Google Cloud / Firebase) — hosts backend services
                and databases
              </li>
              <li>
                <strong>Blockchain RPC providers</strong> (Alchemy) — relay on-chain transactions
              </li>
            </ul>
            <p className="mt-2">
              Each provider processes data according to their own privacy policies. We do not sell
              your personal data to third parties.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">6. Data Retention</h2>
            <p>
              We retain your off-chain data for as long as your account is active or as needed to
              provide services. Content you upload may persist on decentralized storage networks
              indefinitely. Credit transaction records are retained for accounting and audit
              purposes.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">
              7. Cookies &amp; Local Storage
            </h2>
            <p>
              The Platform uses browser local storage to maintain your authentication session (JWT
              token) and UI preferences. We do not use third-party tracking cookies.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">8. Children</h2>
            <p>
              The Platform is not intended for use by anyone under the age of 18. We do not
              knowingly collect personal information from children. If you believe a child has
              provided us with personal data, please contact us.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">9. Your Rights</h2>
            <p>
              Depending on your jurisdiction, you may have the right to access, correct, or delete
              your personal data. You may request deletion of your off-chain data by contacting us.
              On-chain data (transaction hashes, content hashes, NFT records) cannot be removed from
              public blockchains.
            </p>
            <p className="mt-2">
              To exercise your rights, contact:{' '}
              <a href="mailto:privacy@loar.fun" className="text-primary underline">
                privacy@loar.fun
              </a>
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">10. Changes to This Policy</h2>
            <p>
              We may update this Privacy Policy from time to time. We will notify users of material
              changes by updating the &quot;Last updated&quot; date at the top of this page.
              Continued use of the Platform after changes constitutes acceptance.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">11. Contact</h2>
            <p>
              For privacy inquiries:{' '}
              <a href="mailto:privacy@loar.fun" className="text-primary underline">
                privacy@loar.fun
              </a>
              <br />
              For legal questions:{' '}
              <a href="mailto:legal@loar.fun" className="text-primary underline">
                legal@loar.fun
              </a>
              <br />
              DMCA requests:{' '}
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
