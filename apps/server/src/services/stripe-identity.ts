/**
 * Stripe Identity — Phase 4 KYC + liveness verification for real-person
 * likeness/voice listings.
 *
 * Reuses the platform's existing Stripe account (same `STRIPE_SECRET_KEY` as
 * `credits/stripe.routes.ts` and `routes/stripe-webhook.ts`) rather than
 * onboarding a separate identity-verification vendor. A verification session
 * is a Stripe-hosted document + selfie liveness check; the result lands on
 * `stripe-webhook.ts` via `identity.verification_session.*` events, which
 * must be added to the existing webhook endpoint's event subscription in the
 * Stripe Dashboard (no new signing secret needed — same endpoint).
 */
import type Stripe from 'stripe';
import { getStripe } from '../routers/credits/stripe.routes';

export interface CreateVerificationSessionParams {
  uid: string;
  entityId: string;
  consentId: string;
  /** Where Stripe redirects the seller after the hosted flow completes. */
  returnUrl: string;
}

export interface VerificationSessionResult {
  sessionId: string;
  url: string;
}

/**
 * Create a Stripe Identity verification session for a rights holder. Throws
 * if Stripe isn't configured — callers should surface this as a clear
 * "verification is not available" error rather than letting it 500 opaquely.
 */
export async function createVerificationSession(
  params: CreateVerificationSessionParams
): Promise<VerificationSessionResult> {
  const stripeClient = getStripe();
  if (!stripeClient) {
    throw new Error('Identity verification is not available — Stripe is not configured.');
  }

  const session = await stripeClient.identity.verificationSessions.create({
    type: 'document',
    options: {
      document: {
        require_matching_selfie: true,
      },
    },
    metadata: {
      entityId: params.entityId,
      consentId: params.consentId,
      uid: params.uid,
    },
    return_url: params.returnUrl,
  });

  if (!session.url) {
    throw new Error('Stripe did not return a hosted verification URL.');
  }
  return { sessionId: session.id, url: session.url };
}

/** Metadata shape read back off `identity.verification_session.*` webhook events. */
export interface VerificationSessionMetadata {
  entityId: string;
  consentId: string;
  uid: string;
}

export function readVerificationSessionMetadata(
  session: Stripe.Identity.VerificationSession
): VerificationSessionMetadata | null {
  const { entityId, consentId, uid } = session.metadata ?? {};
  if (!entityId || !consentId || !uid) return null;
  return { entityId, consentId, uid };
}
