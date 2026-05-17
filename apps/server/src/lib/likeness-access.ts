/**
 * Likeness Marketplace — access enforcement.
 *
 * Generation endpoints (voice.synthesize, image.generate when conditioned on
 * a likeness entity, etc.) must call into these helpers BEFORE doing any
 * billable work, to ensure that a buyer who is using a third party's listed
 * voice / likeness actually holds an active license.
 *
 * Rules:
 *   - Creator can always use their own entity.
 *   - If the entity is not listed on the marketplace (no active listing),
 *     no access check is needed (assets that haven't been listed are
 *     creator-private — they were never offered for sale, so the only
 *     person calling generation against them is the creator anyway, and
 *     the creator check above lets them through).
 *   - If the entity IS listed, the caller must have an ACTIVE deal in
 *     `likenessDeals` for it (BUY, or unexpired LEASE / LICENSE).
 */
import { TRPCError } from '@trpc/server';
import { db } from './firebase';
import type { LikenessDeal, LikenessUseCase } from '../routers/entities/entities.types';

interface VoiceEntityLookup {
  entityId: string;
  creatorAddress: string;
}

/** Resolve the marketplace `voice` entity (if any) that wraps a given ElevenLabs voice_id. */
async function findVoiceEntityByElevenLabsId(
  elevenLabsVoiceId: string
): Promise<VoiceEntityLookup | null> {
  if (!db) return null;
  // Backed by the composite index `entities (kind ASC, metadata.elevenLabsVoiceId ASC)`
  // declared in firestore.indexes.json. Scales O(1) regardless of total
  // voice-entity count — the previous 1000-doc scan + in-memory filter would
  // silently fail closed (return null) past the limit, leaving listed voices
  // usable without a license.
  const snap = await db
    .collection('entities')
    .where('kind', '==', 'voice')
    .where('metadata.elevenLabsVoiceId', '==', elevenLabsVoiceId)
    .limit(1)
    .get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  const data = doc.data();
  return {
    entityId: doc.id,
    creatorAddress: ((data?.creator as string | undefined) ?? '').toLowerCase(),
  };
}

/** True if there is at least one active listing for this entity. */
async function entityIsListed(entityId: string): Promise<boolean> {
  if (!db) return false;
  const snap = await db
    .collection('likenessListings')
    .where('entityId', '==', entityId)
    .where('active', '==', true)
    .limit(1)
    .get();
  return !snap.empty;
}

/** Locate the buyer's most-recent active deal (auto-expires past-endTime deals). */
async function findActiveDeal(
  entityId: string,
  buyerUid: string,
  useCase?: LikenessUseCase
): Promise<{ dealId: string; deal: LikenessDeal } | null> {
  if (!db) return null;
  const snap = await db
    .collection('likenessDeals')
    .where('entityId', '==', entityId)
    .where('buyerUid', '==', buyerUid)
    .where('status', '==', 'ACTIVE')
    .orderBy('startTime', 'desc')
    .limit(10)
    .get();
  if (snap.empty) return null;

  const now = Date.now();
  for (const doc of snap.docs) {
    const deal = doc.data() as LikenessDeal;
    if (useCase && deal.declaredUseCase !== useCase) continue;
    if (deal.dealType === 'BUY') {
      return { dealId: doc.id, deal };
    }
    const endRaw = deal.endTime as unknown;
    const endMs =
      endRaw instanceof Date
        ? endRaw.getTime()
        : typeof endRaw === 'string'
          ? new Date(endRaw).getTime()
          : endRaw && typeof endRaw === 'object' && 'toDate' in endRaw
            ? (endRaw as { toDate: () => Date }).toDate().getTime()
            : null;
    if (endMs !== null && endMs < now) {
      // Past expiry — sweep it state-changing so future checks are O(1).
      await db.collection('likenessDeals').doc(doc.id).update({ status: 'EXPIRED' });
      continue;
    }
    return { dealId: doc.id, deal };
  }
  return null;
}

/**
 * Assert the caller is allowed to invoke a generation against the given
 * ElevenLabs voice_id. Throws TRPCError on denial; returns silently on success.
 *
 * Use case is optional — if provided we also check that the caller's deal
 * was scoped to that use case (gives the rights holder finer control).
 */
export async function assertVoiceUsageAllowed(opts: {
  elevenLabsVoiceId: string;
  callerUid: string;
  callerAddress: string | null | undefined;
  useCase?: LikenessUseCase;
}): Promise<void> {
  const lookup = await findVoiceEntityByElevenLabsId(opts.elevenLabsVoiceId);
  if (!lookup) return; // Not a marketplace-listed voice — no constraint.

  // Creator can always use their own.
  if (opts.callerAddress && opts.callerAddress.toLowerCase() === lookup.creatorAddress) {
    return;
  }

  // Only enforce if there is an active listing — pre-listing entities are
  // creator-private; an entity that was once listed but is currently inactive
  // also blocks new third-party access (so revoked consent immediately stops
  // new generations even before existing deals expire).
  const listed = await entityIsListed(lookup.entityId);
  if (!listed) {
    // Not listed and caller isn't the creator — block. The voice was
    // promoted to an entity by its rights holder but never offered; using it
    // without permission would defeat the consent model.
    throw new TRPCError({
      code: 'FORBIDDEN',
      message:
        'This voice belongs to a rights holder and is not available for use. Ask the rights holder to list it on the Likeness Marketplace.',
    });
  }

  const active = await findActiveDeal(lookup.entityId, opts.callerUid, opts.useCase);
  if (!active) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message:
        opts.useCase !== undefined
          ? `You need an active marketplace deal scoped to "${opts.useCase}" to use this voice.`
          : 'This voice is listed on the Likeness Marketplace — purchase, lease, or license it to use it.',
    });
  }
}
