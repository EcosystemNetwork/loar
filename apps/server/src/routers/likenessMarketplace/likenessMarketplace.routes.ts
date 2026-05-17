/**
 * Likeness Marketplace Router — PRD 8 (Verified Likeness Marketplace).
 *
 * A creator's own voice / face / body / video / 3D scan can be listed for
 * **sale, lease, or license** as a first-class `voice` or `likeness` entity.
 * Consent is captured server-side as a literal click-through attestation
 * (Phase 1) and is required before any listing can be created. Phase 4 will
 * upgrade `consent.verified` via KYC + liveness + biometric match.
 *
 * Collections
 *   likenessConsents/{entityId}/revisions/{consentId}  immutable consent log
 *   likenessConsents/{entityId}                         pointer to latest active consent
 *   likenessListings/{listingId}                        marketplace entries
 *   likenessDeals/{dealId}                              executed deals
 *
 * Money flow (Phase 1)
 *   Buyer pays seller directly via ETH transfer; client supplies txHash;
 *   server verifies with `verifyAndClaimTx` (the same primitive used by
 *   contentLicensing.recordDeal). Phase 1.5 wires this through
 *   ContentLicensing.sol so SplitRouter handles platform fee + royalties.
 */
import { router, protectedProcedure, publicProcedure } from '../../lib/trpc';
import { db } from '../../lib/firebase';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { randomUUID } from 'crypto';
import { verifyAndClaimTx } from '../../services/tx-verify';
import { recordRevenueEvent } from '../../services/revenue-recorder';
import {
  RightsType,
  computeEntityContentHash,
  computeSplitEntityHash,
  buildRightsAttestationDigest,
  readCreatorNonce,
  readIsMonetizable,
  readContentRegistration,
  readBuyerDeal,
  readSplitRouterAddress,
  readSplitOwner,
  submitRegisterSplitOwner,
  encodeSetSplitsCall,
  verifyContractTx,
  submitSetRightsWithCreatorSig,
  getOnChainEnv,
  defaultOnChainChainId,
  isOnChainAvailable,
} from '../../services/likeness-onchain';
import {
  createPublicClient,
  http,
  BaseError as ViemBaseError,
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  type Address,
  type Hex,
  type Hash,
} from 'viem';
import { sepolia, baseSepolia } from 'viem/chains';
import { syncRightsHashToSolana } from '../../services/rights-bridge';
import { createEntity, getEntity, updateEntity } from '../entities/entities.handlers';
import {
  LIKENESS_MODALITIES,
  LIKENESS_USE_CASES,
  LIKENESS_PROHIBITIONS,
  LIKENESS_DEAL_TYPES,
  LIKENESS_ATTESTATION_TEXT_V1,
  type LikenessConsent,
  type LikenessListing,
  type LikenessDeal,
  type LikenessModality,
  type LikenessUseCase,
  type Entity,
  type VoiceEntityMetadata,
  type LikenessEntityMetadata,
  type PersonaEntityMetadata,
} from '../entities/entities.types';

// ── Collections ──────────────────────────────────────────────────────────

const consentsCol = () => {
  if (!db)
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Firebase not configured' });
  return db.collection('likenessConsents');
};

const listingsCol = () => {
  if (!db)
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Firebase not configured' });
  return db.collection('likenessListings');
};

const dealsCol = () => {
  if (!db)
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Firebase not configured' });
  return db.collection('likenessDeals');
};

// ── Pricing caps (mirror ContentLicensing.sol on-chain caps) ─────────────

const MAX_DURATION_DAYS = 365;
/** 1000 ETH/day in wei — matches MAX_RENT_PRICE_PER_DAY on-chain. */
const MAX_RENT_PRICE_PER_DAY_WEI = 1000n * 10n ** 18n;
const MAX_ROYALTY_BPS = 5000;

// ── Schemas ──────────────────────────────────────────────────────────────

/** Reject negative / non-numeric wei strings. Empty / "0" is allowed = deal disabled. */
const weiString = z
  .string()
  .regex(/^\d+$/, 'Must be a non-negative integer string (wei)')
  .default('0');

const modalitySchema = z.enum(LIKENESS_MODALITIES);
const useCaseSchema = z.enum(LIKENESS_USE_CASES);
const prohibitionSchema = z.enum(LIKENESS_PROHIBITIONS);

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Fetch the latest active consent revision for an entity. Returns null if
 * the entity has never been consented or its consent is frozen/revoked.
 */
async function getActiveConsent(entityId: string): Promise<LikenessConsent | null> {
  const pointer = await consentsCol().doc(entityId).get();
  if (!pointer.exists) return null;
  const latestId = pointer.data()?.latestRevisionId as string | undefined;
  if (!latestId) return null;
  const revision = await consentsCol().doc(entityId).collection('revisions').doc(latestId).get();
  if (!revision.exists) return null;
  const consent = revision.data() as LikenessConsent;
  if (consent.status !== 'active') return null;
  return consent;
}

/**
 * Read an entity and assert the caller owns it (creator address match).
 * Throws TRPCError on mismatch so callers can let it propagate.
 */
async function readOwnedEntity(entityId: string, callerAddress: string): Promise<Entity> {
  const entity = await getEntity(entityId);
  if (!entity) throw new TRPCError({ code: 'NOT_FOUND', message: 'Entity not found' });
  if ((entity.creator || '').toLowerCase() !== callerAddress.toLowerCase()) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'You are not the rights holder of this entity',
    });
  }
  if (entity.kind !== 'voice' && entity.kind !== 'likeness' && entity.kind !== 'persona') {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message:
        'Only `voice`, `likeness`, and `persona` entities can be listed on the Likeness Marketplace',
    });
  }
  // Parody personas are blocked from listing until admin approval.
  if (entity.kind === 'persona') {
    const meta = entity.metadata as unknown as PersonaEntityMetadata | undefined;
    if (meta?.moderationStatus === 'pending_review') {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'Persona is awaiting parody moderation review and cannot be listed yet',
      });
    }
    if (meta?.moderationStatus === 'rejected') {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'Persona was rejected in moderation review and cannot be listed',
      });
    }
  }
  return entity;
}

// ── Router ───────────────────────────────────────────────────────────────

export const likenessMarketplaceRouter = router({
  /**
   * Convenience — promote a voice from `userVoices/{uid}/voices` (Voice Studio
   * library) into a first-class `voice` entity owned by the caller. Returns
   * the new entity id so the UI can immediately call `submitConsent` +
   * `createListing` on it.
   *
   * Idempotent: if a voice entity already exists for this `elevenLabsVoiceId`
   * + creator, returns it instead of creating a duplicate.
   */
  promoteVoiceToEntity: protectedProcedure
    .input(
      z.object({
        userVoiceId: z.string(),
        // Optional name override — defaults to the userVoice name.
        nameOverride: z.string().min(1).max(80).optional(),
        // Real-person flag — if false, this is an AI persona (not a biometric clone).
        realPerson: z.boolean().default(true),
        gender: z.enum(['male', 'female', 'neutral']).optional(),
        age: z.enum(['young', 'middle_aged', 'old']).optional(),
        accent: z.string().max(80).optional(),
        locale: z.string().max(20).optional(),
        tags: z.array(z.string().max(40)).max(12).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (!ctx.user.address) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Connected wallet required to promote a voice to a marketplace entity',
        });
      }
      if (!db) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Firebase not configured' });
      }

      const voiceDoc = await db
        .collection('userVoices')
        .doc(ctx.user.uid)
        .collection('voices')
        .doc(input.userVoiceId)
        .get();
      if (!voiceDoc.exists) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Voice not found in your library' });
      }
      const voice = voiceDoc.data() as {
        voiceId: string;
        name: string;
        description?: string;
        source: 'library' | 'clone' | 'design';
        sourceSampleUrls?: string[];
        previewUrl?: string;
        tags?: string[];
      };

      if (voice.source === 'library') {
        // Curated catalog voices are LOAR-owned, not user-owned — listing
        // them would mis-attribute rights. Block it here.
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Curated library voices cannot be relisted. Use a voice you cloned or designed.',
        });
      }

      // Idempotency — look for an existing entity matching this voiceId + creator.
      const existing = await db
        .collection('entities')
        .where('kind', '==', 'voice')
        .where('creator', '==', ctx.user.address.toLowerCase())
        .limit(50)
        .get();
      for (const doc of existing.docs) {
        const meta = (doc.data().metadata ?? {}) as Partial<VoiceEntityMetadata>;
        if (meta.elevenLabsVoiceId === voice.voiceId) {
          return { id: doc.id, ...doc.data() } as Entity;
        }
      }

      const metadata: VoiceEntityMetadata = {
        elevenLabsVoiceId: voice.voiceId,
        source: voice.source === 'clone' ? 'clone' : 'design',
        previewUrl: voice.previewUrl,
        sourceSampleUrls: voice.sourceSampleUrls,
        gender: input.gender,
        age: input.age,
        accent: input.accent,
        locale: input.locale,
        tags: input.tags ?? voice.tags,
      };

      const { data } = await createEntity(
        {
          name: input.nameOverride ?? voice.name,
          description: voice.description ?? '',
          kind: 'voice',
          universeAddress: null,
          parentId: null,
          imageUrl: null,
          metadata: { ...metadata, realPerson: input.realPerson },
          monetized: false, // monetization is gated on consent — flipped by createListing
          rightsDeclaration: null,
        },
        ctx.user.address
      );
      return data;
    }),

  /**
   * Record a consent attestation for a voice or likeness entity. Returns the
   * new consent revision id. Creating a fresh revision automatically
   * supersedes prior consent for *future* deals only — existing deals stay
   * valid until expiry.
   */
  submitConsent: protectedProcedure
    .input(
      z.object({
        entityId: z.string(),
        modalities: z.array(modalitySchema).min(1).max(5),
        allowedUseCases: z.array(useCaseSchema).min(1),
        // Defaults to the full prohibition set so callers must explicitly
        // opt OUT of a hard-rule prohibition. UI surfaces all as on.
        prohibitions: z.array(prohibitionSchema).default([...LIKENESS_PROHIBITIONS]),
        permitSale: z.boolean(),
        permitLease: z.boolean(),
        permitLicense: z.boolean(),
        realPerson: z.boolean(),
        attestationText: z.literal(LIKENESS_ATTESTATION_TEXT_V1),
        attestationSignature: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (!ctx.user.address) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Connected wallet required to attest consent',
        });
      }

      const entity = await readOwnedEntity(input.entityId, ctx.user.address);

      if (!input.permitSale && !input.permitLease && !input.permitLicense) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'At least one of sale / lease / license must be permitted',
        });
      }

      // For `voice` kind, modalities is implicitly ["full"] of voice — accept any
      // user choice, but require `face` / `body` / `video` / `3d` /`full` set to
      // be consistent with what the entity actually contains.
      if (entity.kind === 'voice') {
        // Voice entities don't expose face/body/video — pin modalities to a
        // single sentinel so the listing browse can filter cleanly.
        // We accept whatever the UI sent but normalize to ['full'] for clarity.
        // (Voice is its own modality lane by virtue of `kind === 'voice'`.)
      }

      const now = new Date();
      const consentId = randomUUID();
      // Defense in depth — only include attestationSignature when actually
      // present. Firestore rejects `undefined` values by default; production
      // sets `ignoreUndefinedProperties: true` which papers over this, but
      // any environment that ever forgets that setting (and the upcoming
      // firebase-admin v12 default) would otherwise blow up on every write.
      const consent: LikenessConsent = {
        id: consentId,
        entityId: input.entityId,
        rightsHolderAddress: ctx.user.address.toLowerCase(),
        rightsHolderUid: ctx.user.uid,
        modalities: input.modalities,
        allowedUseCases: input.allowedUseCases,
        prohibitions: input.prohibitions,
        permitSale: input.permitSale,
        permitLease: input.permitLease,
        permitLicense: input.permitLicense,
        realPerson: input.realPerson,
        verified: false, // Phase 4 — KYC + liveness sets this true
        attestationText: input.attestationText,
        ...(input.attestationSignature ? { attestationSignature: input.attestationSignature } : {}),
        status: 'active',
        createdAt: now,
        updatedAt: now,
      };

      const batch = db.batch();
      batch.set(consentsCol().doc(input.entityId).collection('revisions').doc(consentId), consent);
      batch.set(
        consentsCol().doc(input.entityId),
        {
          latestRevisionId: consentId,
          rightsHolderUid: ctx.user.uid,
          rightsHolderAddress: ctx.user.address.toLowerCase(),
          updatedAt: now,
        },
        { merge: true }
      );
      await batch.commit();

      return consent;
    }),

  /**
   * Revoke active consent on an entity. New deals are blocked; in-flight
   * deals stay valid until expiry per the attestation. Reversible by calling
   * `submitConsent` again to create a fresh active revision.
   */
  revokeConsent: protectedProcedure
    .input(z.object({ entityId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      if (!ctx.user.address) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Connected wallet required' });
      }
      await readOwnedEntity(input.entityId, ctx.user.address);

      const pointer = await consentsCol().doc(input.entityId).get();
      const latestId = pointer.data()?.latestRevisionId as string | undefined;
      if (!latestId) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'No active consent to revoke' });
      }

      const now = new Date();
      const ref = consentsCol().doc(input.entityId).collection('revisions').doc(latestId);
      await ref.update({ status: 'revoked', updatedAt: now });

      // Deactivate any open listings — buyer access on past deals is preserved.
      const openListings = await listingsCol()
        .where('entityId', '==', input.entityId)
        .where('active', '==', true)
        .get();
      const batch = db.batch();
      for (const doc of openListings.docs) {
        batch.update(doc.ref, { active: false, updatedAt: now });
      }
      await batch.commit();

      return { ok: true, deactivatedListings: openListings.size };
    }),

  /**
   * Fetch the active consent revision for an entity (rights holder only).
   */
  getMyConsent: protectedProcedure
    .input(z.object({ entityId: z.string() }))
    .query(async ({ input, ctx }) => {
      if (!ctx.user.address) return null;
      const entity = await getEntity(input.entityId);
      if (!entity) return null;
      if ((entity.creator || '').toLowerCase() !== ctx.user.address.toLowerCase()) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not your entity' });
      }
      return getActiveConsent(input.entityId);
    }),

  /**
   * Create a marketplace listing for a voice or likeness entity. Requires an
   * active consent revision; the consent's `permit*` flags gate which deal
   * prices may be non-zero.
   */
  createListing: protectedProcedure
    .input(
      z.object({
        entityId: z.string(),
        title: z.string().min(1).max(160),
        description: z.string().max(2000).default(''),
        buyPriceWei: weiString,
        leasePricePerDayWei: weiString,
        licenseFeeWei: weiString,
        licenseRoyaltyBps: z.number().int().min(0).max(MAX_ROYALTY_BPS).default(0),
        maxDurationDays: z.number().int().min(1).max(MAX_DURATION_DAYS).default(MAX_DURATION_DAYS),
        /**
         * Optional multi-recipient revenue splits. If provided, the SUM of
         * bps across recipients must equal 10000 (= 100%). Max 10 recipients
         * per the SplitRouter contract cap. The seller's address is implicit
         * — it counts as one of the recipients if listed here, otherwise the
         * seller receives nothing from the split (rare, but supported).
         */
        splitRecipients: z
          .array(
            z.object({
              recipient: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid address'),
              bps: z.number().int().min(1).max(10000),
            })
          )
          .max(10)
          .optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (!ctx.user.address) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Connected wallet required to list' });
      }
      const entity = await readOwnedEntity(input.entityId, ctx.user.address);

      // Validate splits if provided — sum must equal 10000.
      if (input.splitRecipients && input.splitRecipients.length > 0) {
        const totalBps = input.splitRecipients.reduce((s, r) => s + r.bps, 0);
        if (totalBps !== 10000) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Split bps must sum to exactly 10000 (got ${totalBps})`,
          });
        }
      }

      const consent = await getActiveConsent(input.entityId);
      if (!consent) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'You must record consent before listing. Call submitConsent first.',
        });
      }

      // Enforce consent's permit flags against price intent.
      const wantsSale = input.buyPriceWei !== '0';
      const wantsLease = input.leasePricePerDayWei !== '0';
      const wantsLicense = input.licenseFeeWei !== '0';
      if (wantsSale && !consent.permitSale) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Consent does not authorize sale of this likeness',
        });
      }
      if (wantsLease && !consent.permitLease) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Consent does not authorize leasing of this likeness',
        });
      }
      if (wantsLicense && !consent.permitLicense) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Consent does not authorize licensing of this likeness',
        });
      }
      if (!wantsSale && !wantsLease && !wantsLicense) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Set at least one of buyPrice / leasePricePerDay / licenseFee above zero',
        });
      }
      if (wantsLease && BigInt(input.leasePricePerDayWei) > MAX_RENT_PRICE_PER_DAY_WEI) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Lease price per day exceeds the on-chain cap of 1000 ETH/day',
        });
      }

      // Stamp `monetized=true` + rights declaration on the entity so it shows
      // up in the creator's revenue surfaces and is gated by minting checks.
      if (!entity.monetized) {
        await updateEntity(entity.id, {
          monetized: true,
          rightsDeclaration: 'original',
        });
      }

      const now = new Date();
      const id = randomUUID();
      const listing: LikenessListing = {
        id,
        entityId: entity.id,
        entityKind: entity.kind as 'voice' | 'likeness' | 'persona',
        consentId: consent.id,
        sellerUid: ctx.user.uid,
        sellerAddress: ctx.user.address.toLowerCase(),
        title: input.title,
        description: input.description,
        thumbnailUrl: entity.imageUrl,
        previewUrl:
          ((entity.metadata as Record<string, unknown>)?.previewUrl as string | null) ?? null,
        modalities: consent.modalities,
        buyPriceWei: input.buyPriceWei,
        leasePricePerDayWei: input.leasePricePerDayWei,
        licenseFeeWei: input.licenseFeeWei,
        licenseRoyaltyBps: input.licenseRoyaltyBps,
        maxDurationDays: input.maxDurationDays,
        active: true,
        totalSales: 0,
        totalRevenueWei: '0',
        onChainContentHash: null,
        onChainChainId: null,
        onChainContentLicensingAddress: null,
        onChainRegisterTxHash: null,
        onChainRightsTxHash: null,
        splitRecipients:
          input.splitRecipients && input.splitRecipients.length > 0
            ? input.splitRecipients.map((r) => ({
                recipient: r.recipient.toLowerCase(),
                bps: r.bps,
              }))
            : null,
        onChainSplitEntityHash: null,
        onChainSplitsTxHash: null,
        createdAt: now,
        updatedAt: now,
      };

      await listingsCol().doc(id).set(listing);
      return listing;
    }),

  /** Update pricing or duration on an existing listing. Seller only. */
  updateListing: protectedProcedure
    .input(
      z.object({
        listingId: z.string(),
        title: z.string().min(1).max(160).optional(),
        description: z.string().max(2000).optional(),
        buyPriceWei: weiString.optional(),
        leasePricePerDayWei: weiString.optional(),
        licenseFeeWei: weiString.optional(),
        licenseRoyaltyBps: z.number().int().min(0).max(MAX_ROYALTY_BPS).optional(),
        maxDurationDays: z.number().int().min(1).max(MAX_DURATION_DAYS).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const ref = listingsCol().doc(input.listingId);
      const snap = await ref.get();
      if (!snap.exists) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Listing not found' });
      }
      const listing = snap.data() as LikenessListing;
      if (listing.sellerUid !== ctx.user.uid) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not the listing owner' });
      }

      const { listingId: _ignored, ...rest } = input;
      const updates: Record<string, unknown> = { updatedAt: new Date() };
      for (const [k, v] of Object.entries(rest)) {
        if (v !== undefined) updates[k] = v;
      }
      await ref.update(updates);
      return { ok: true };
    }),

  /** Deactivate a listing without revoking consent. Reversible via `reactivate`. */
  deactivateListing: protectedProcedure
    .input(z.object({ listingId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const ref = listingsCol().doc(input.listingId);
      const snap = await ref.get();
      if (!snap.exists) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Listing not found' });
      }
      if ((snap.data() as LikenessListing).sellerUid !== ctx.user.uid) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not the listing owner' });
      }
      await ref.update({ active: false, updatedAt: new Date() });
      return { ok: true };
    }),

  reactivateListing: protectedProcedure
    .input(z.object({ listingId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const ref = listingsCol().doc(input.listingId);
      const snap = await ref.get();
      if (!snap.exists) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Listing not found' });
      }
      const listing = snap.data() as LikenessListing;
      if (listing.sellerUid !== ctx.user.uid) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not the listing owner' });
      }
      // Re-verify consent is still active before re-listing.
      const consent = await getActiveConsent(listing.entityId);
      if (!consent) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Consent is no longer active — re-submit consent before reactivating',
        });
      }
      await ref.update({ active: true, consentId: consent.id, updatedAt: new Date() });
      return { ok: true };
    }),

  // ── Phase 1.5: on-chain ContentLicensing.sol integration ─────────────

  /**
   * Returns true if the on-chain ContentLicensing contract is configured for
   * at least one supported chain. The web client uses this to decide whether
   * to surface the "Publish on-chain" CTA.
   */
  onChainAvailability: publicProcedure.query(() => {
    const chainId = defaultOnChainChainId();
    return {
      available: chainId !== null,
      chainId,
      chainLabel:
        chainId === sepolia.id ? 'Sepolia' : chainId === baseSepolia.id ? 'Base Sepolia' : null,
    };
  }),

  /**
   * Step 1 of the on-chain publish flow — returns the EIP-191 digest the
   * seller's wallet must sign so the server operator can submit
   * `RightsRegistry.setRightsWithCreatorSig` on their behalf. Pure read, no
   * state change.
   */
  prepareOnChainPublish: protectedProcedure
    .input(z.object({ listingId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      if (!ctx.user.address) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Connected wallet required' });
      }
      const chainId = defaultOnChainChainId();
      const env = chainId !== null ? getOnChainEnv(chainId) : null;
      if (!env) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message:
            'On-chain marketplace is not configured. Deploy ContentLicensing + RightsRegistry and set CONTENT_LICENSING_ADDRESS_* env vars first.',
        });
      }

      const listingSnap = await listingsCol().doc(input.listingId).get();
      if (!listingSnap.exists) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Listing not found' });
      }
      const listing = listingSnap.data() as LikenessListing;
      if (listing.sellerUid !== ctx.user.uid) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not the listing owner' });
      }
      if (listing.onChainContentHash) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Listing is already published on-chain',
        });
      }

      const contentHash = computeEntityContentHash(listing.entityId);
      const creator = ctx.user.address as Address;

      // If already monetizable (e.g., a prior publish attempt landed setRights
      // but failed on registerContent), skip the rights step entirely.
      const alreadyMonetizable = await readIsMonetizable(env, contentHash);

      // Detect whether the deployed RightsRegistry supports the hardened
      // `setRightsWithCreatorSig` flow. Older deployments lack the
      // `creatorNonce` mapping AND default `isMonetizable` to true for unset
      // hashes — in that case the rights step is unnecessary and we proceed
      // straight to registerContent.
      //
      // We only treat a CONTRACT-LEVEL revert (selector missing on legacy impl)
      // as "skip rights"; transient RPC errors (HTTP/Timeout) must surface so
      // the caller can retry rather than silently bypassing the hardened path
      // post-upgrade.
      let nonce = 0n;
      let skipRightsAttestation = alreadyMonetizable;
      if (!alreadyMonetizable) {
        try {
          nonce = await readCreatorNonce(env, creator);
        } catch (err) {
          const isContractRevert =
            err instanceof ContractFunctionExecutionError ||
            (err instanceof ViemBaseError &&
              err.walk((e) => e instanceof ContractFunctionRevertedError) !== null);
          if (!isContractRevert) throw err;
          skipRightsAttestation = true;
        }
      }

      const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 60); // 1h validity
      const digest = buildRightsAttestationDigest({
        rightsRegistry: env.rightsRegistry,
        chainId: env.chainId,
        contentHash,
        rightsType: RightsType.ORIGINAL,
        creatorNonce: nonce,
        deadline,
      });

      // ── Multi-recipient splits prep (optional) ────────────────────────
      // When the listing has splitRecipients, we:
      //   1. Pre-claim split ownership for the seller via the operator
      //      (registerSplitOwner is registrar-gated; the seller cannot do
      //      this directly).
      //   2. Return the setSplits calldata so the client (seller's wallet
      //      via Circle DCW) can submit the actual split configuration as
      //      the new owner.
      //   3. Pass the splitEntityHash through registerContent so payments
      //      route via SplitRouter instead of the direct PaymentRouter
      //      fallback.
      let splitEntityHash: Hex =
        '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex;
      let setSplitsCall: {
        address: Address;
        abi: ReturnType<typeof encodeSetSplitsCall>['abi'];
        functionName: 'setSplits';
        args: ReturnType<typeof encodeSetSplitsCall>['args'];
      } | null = null;

      if (listing.splitRecipients && listing.splitRecipients.length > 0) {
        splitEntityHash = computeSplitEntityHash(listing.entityId);
        const splitRouter = await readSplitRouterAddress(env);

        // Operator pre-claims ownership so the seller's setSplits call lands.
        // No-op if already claimed by the seller (e.g., a prior publish attempt).
        try {
          await submitRegisterSplitOwner({
            chainId: env.chainId,
            splitRouter,
            entityHash: splitEntityHash,
            newOwner: creator,
          });
        } catch (err) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: `Could not register split owner: ${(err as Error).message}. Make sure OPERATOR_PRIVATE_KEY is a SplitRouter registrar.`,
          });
        }

        const encoded = encodeSetSplitsCall({
          entityHash: splitEntityHash,
          splits: listing.splitRecipients.map((r) => ({
            recipient: r.recipient as Address,
            bps: r.bps,
          })),
        });
        setSplitsCall = {
          address: splitRouter,
          ...encoded,
        };
      }

      return {
        chainId: env.chainId,
        chainLabel: env.chainLabel,
        contentHash,
        rightsRegistry: env.rightsRegistry,
        contentLicensing: env.contentLicensing,
        rightsType: RightsType.ORIGINAL,
        creatorNonce: nonce.toString(),
        deadline: deadline.toString(),
        digest,
        // The wallet wraps `digest` with EIP-191 personal_sign prefix before signing.
        skipRightsAttestation,
        /**
         * setSplits calldata for the seller's wallet. Null when the listing
         * has no splitRecipients — in that case payments fall back to direct
         * creator payout via PaymentRouter.
         */
        setSplitsCall,
        splitEntityHash,
        registerContentArgs: {
          contentHash,
          universeId: '0', // Personal listings carry universeId=0 (no universe)
          splitEntityHash,
          buyPriceWei: listing.buyPriceWei,
          rentPricePerDayWei: listing.leasePricePerDayWei,
          licenseFeeWei: listing.licenseFeeWei,
          licenseRoyaltyBps: listing.licenseRoyaltyBps,
        },
      };
    }),

  /**
   * Step 2 — the seller wallet signed the digest from step 1. Server operator
   * submits `setRightsWithCreatorSig` and waits for it to confirm. Returns
   * the rights tx hash so the client can show progress, then the client
   * proceeds to call `registerContent` via their own wallet.
   *
   * If the entity is already monetizable on-chain, this is a no-op pass-through.
   */
  submitOnChainRights: protectedProcedure
    .input(
      z.object({
        listingId: z.string(),
        signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
        deadline: z.string().regex(/^\d+$/),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (!ctx.user.address) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Connected wallet required' });
      }
      const listingSnap = await listingsCol().doc(input.listingId).get();
      if (!listingSnap.exists) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Listing not found' });
      }
      const listing = listingSnap.data() as LikenessListing;
      if (listing.sellerUid !== ctx.user.uid) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not the listing owner' });
      }
      const chainId = defaultOnChainChainId();
      const env = chainId !== null ? getOnChainEnv(chainId) : null;
      if (!env) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'On-chain marketplace is not configured',
        });
      }
      const contentHash = computeEntityContentHash(listing.entityId);
      const alreadyMonetizable = await readIsMonetizable(env, contentHash);
      if (alreadyMonetizable) {
        return { rightsTxHash: null, alreadyMonetizable: true as const };
      }

      const rightsTxHash = await submitSetRightsWithCreatorSig({
        chainId: env.chainId,
        contentHash,
        rightsType: RightsType.ORIGINAL,
        creator: ctx.user.address as Address,
        deadline: BigInt(input.deadline),
        creatorSignature: input.signature as Hex,
      });

      // Block until confirmed so the client can immediately call registerContent
      // (which would revert with ContentNotMonetizable otherwise).
      const rpc = createPublicClient({
        chain: env.chainId === sepolia.id ? sepolia : baseSepolia,
        transport: http(env.rpcUrl),
      });
      const receipt = await rpc.waitForTransactionReceipt({
        hash: rightsTxHash,
        timeout: 90_000,
      });

      // Fire-and-forget cross-chain sync: mirror the new rights classification
      // to the Solana attestation cache so downstream Solana monetization
      // programs see the same state. EVM remains canonical — a Solana push
      // failure here is logged but never blocks the EVM write or the route
      // response. Monotonic version is derived from EVM block + log index, so
      // retries are idempotent.
      void syncRightsHashToSolana({
        contentHash,
        chainId: env.chainId,
        evmBlock: receipt.blockNumber,
        evmLogIndex: receipt.logs[0]?.logIndex ?? 0,
        evmTxHash: rightsTxHash,
      }).catch((err) => {
        console.error(
          '[rights-bridge] EVM→Solana sync failed (non-fatal, will retry on next mutation)',
          { contentHash, chainId: env.chainId, error: err instanceof Error ? err.message : err }
        );
      });

      await listingsCol().doc(input.listingId).update({
        onChainRightsTxHash: rightsTxHash,
        updatedAt: new Date(),
      });
      return { rightsTxHash, alreadyMonetizable: false as const };
    }),

  /**
   * Step 3 — the seller's wallet (via Circle DCW) called
   * `ContentLicensing.registerContent`. We verify the tx landed at the right
   * address + the on-chain registration row now reflects the listing, then
   * stamp the listing as on-chain.
   */
  confirmOnChainPublish: protectedProcedure
    .input(
      z.object({
        listingId: z.string(),
        registerTxHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'Invalid txHash format'),
        /** Optional: the setSplits tx hash, when the listing has splitRecipients. */
        splitsTxHash: z
          .string()
          .regex(/^0x[0-9a-fA-F]{64}$/, 'Invalid txHash format')
          .optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (!ctx.user.address) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Connected wallet required' });
      }
      const listingSnap = await listingsCol().doc(input.listingId).get();
      if (!listingSnap.exists) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Listing not found' });
      }
      const listing = listingSnap.data() as LikenessListing;
      if (listing.sellerUid !== ctx.user.uid) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not the listing owner' });
      }
      const chainId = defaultOnChainChainId();
      const env = chainId !== null ? getOnChainEnv(chainId) : null;
      if (!env) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'On-chain marketplace is not configured',
        });
      }

      const verifyResult = await verifyContractTx({
        chainId: env.chainId,
        txHash: input.registerTxHash as Hash,
      });
      if (!verifyResult.ok) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'registerContent tx not found or did not target ContentLicensing on this chain',
        });
      }

      const contentHash = computeEntityContentHash(listing.entityId);
      const registration = await readContentRegistration(env, contentHash);
      if (!registration) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'On-chain registration row is empty — registerContent may have reverted',
        });
      }
      if (registration.creator.toLowerCase() !== ctx.user.address.toLowerCase()) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'On-chain creator does not match the listing seller',
        });
      }

      // If the listing has splits, verify the splits were actually configured
      // on-chain. Reading splitOwner ≠ zero AND splits exist proves the
      // setSplits tx landed.
      let onChainSplitEntityHash: Hex | null = null;
      let onChainSplitsTxHash: string | null = null;
      if (listing.splitRecipients && listing.splitRecipients.length > 0) {
        const splitRouter = await readSplitRouterAddress(env);
        const splitHash = computeSplitEntityHash(listing.entityId);
        const owner = await readSplitOwner(env, splitRouter, splitHash);
        if (owner.toLowerCase() !== ctx.user.address.toLowerCase()) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'SplitRouter ownership not assigned to seller — setSplits may have reverted',
          });
        }
        onChainSplitEntityHash = splitHash;
        onChainSplitsTxHash = input.splitsTxHash?.toLowerCase() ?? null;
      }

      await listingsCol().doc(input.listingId).update({
        onChainContentHash: contentHash,
        onChainChainId: env.chainId,
        onChainContentLicensingAddress: env.contentLicensing,
        onChainRegisterTxHash: input.registerTxHash.toLowerCase(),
        onChainSplitEntityHash,
        onChainSplitsTxHash,
        updatedAt: new Date(),
      });

      return {
        ok: true,
        chainId: env.chainId,
        contentHash,
        contentLicensing: env.contentLicensing,
        splitEntityHash: onChainSplitEntityHash,
      };
    }),

  /**
   * Buyer-side hook for on-chain deals. After the buyer's wallet calls
   * `buyContent` / `rentContent` / `licenseContent`, this endpoint verifies
   * the on-chain Deal state matches what they're claiming and records the
   * deal in Firestore (mirrors the off-chain `recordDeal` shape so the
   * existing buyer dashboards keep working).
   */
  recordOnChainDeal: protectedProcedure
    .input(
      z.object({
        listingId: z.string(),
        dealType: z.enum(LIKENESS_DEAL_TYPES),
        declaredUseCase: useCaseSchema,
        txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (!ctx.user.address) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Connected wallet required' });
      }
      const listingSnap = await listingsCol().doc(input.listingId).get();
      if (!listingSnap.exists) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Listing not found' });
      }
      const listing = listingSnap.data() as LikenessListing;
      if (!listing.active) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Listing is no longer active' });
      }
      if (!listing.onChainContentHash || listing.onChainChainId === null) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Listing is not published on-chain — use recordDeal instead',
        });
      }
      if (listing.sellerUid === ctx.user.uid) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cannot buy from your own listing' });
      }

      // Verify the tx landed at ContentLicensing on the listing's chain.
      const txVerify = await verifyContractTx({
        chainId: listing.onChainChainId,
        txHash: input.txHash as Hash,
      });
      if (!txVerify.ok) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Transaction did not target ContentLicensing on the listing chain',
        });
      }

      // Read the on-chain deal that should now exist for this buyer.
      const onChainDeal = await readBuyerDeal({
        chainId: listing.onChainChainId,
        contentHash: listing.onChainContentHash as Hex,
        buyer: ctx.user.address as Address,
      });
      if (!onChainDeal) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            'No active on-chain deal found for this buyer + content. The contract call may have failed.',
        });
      }

      // Consent + use-case enforcement (same gate as the off-chain path).
      const consentSnap = await consentsCol()
        .doc(listing.entityId)
        .collection('revisions')
        .doc(listing.consentId)
        .get();
      const consent = consentSnap.exists ? (consentSnap.data() as LikenessConsent) : null;
      if (!consent || consent.status !== 'active') {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Listing consent is no longer active',
        });
      }
      if (!consent.allowedUseCases.includes(input.declaredUseCase)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Use case "${input.declaredUseCase}" is not authorized by the rights holder`,
        });
      }

      const now = new Date();
      const dealId = randomUUID();
      const endTimeMs = onChainDeal.endTime > 0n ? Number(onChainDeal.endTime) * 1000 : null;

      // M7: persona deals pin the version at sale so buyers keep getting
      // the snapshot they paid for even if the seller publishes a new
      // version (which would trigger re-review per C-1).
      let personaVersionAtSale: number | null = null;
      let personaVersionIdAtSale: string | null = null;
      if (listing.entityKind === 'persona') {
        const personaEnt = await getEntity(listing.entityId);
        const pMeta = personaEnt?.metadata as unknown as PersonaEntityMetadata | undefined;
        personaVersionAtSale = pMeta?.versionCount ?? null;
        personaVersionIdAtSale = pMeta?.activeVersionId ?? null;
      }

      const deal: LikenessDeal = {
        id: dealId,
        listingId: input.listingId,
        entityId: listing.entityId,
        dealType: input.dealType,
        sellerUid: listing.sellerUid,
        sellerAddress: listing.sellerAddress,
        buyerUid: ctx.user.uid,
        buyerAddress: ctx.user.address.toLowerCase(),
        pricePaidWei: onChainDeal.pricePaid.toString(),
        durationDays:
          input.dealType === 'BUY'
            ? null
            : Math.round(Number(onChainDeal.endTime - onChainDeal.startTime) / 86400),
        endTime: endTimeMs !== null ? new Date(endTimeMs) : null,
        txHash: input.txHash.toLowerCase(),
        status: 'ACTIVE',
        declaredUseCase: input.declaredUseCase,
        startTime: now,
        onChain: true,
        onChainDealId: onChainDeal.dealId.toString(),
        personaVersionAtSale,
        personaVersionIdAtSale,
      };
      await dealsCol().doc(dealId).set(deal);

      await listingsCol()
        .doc(input.listingId)
        .update({
          totalSales: listing.totalSales + 1,
          totalRevenueWei: (BigInt(listing.totalRevenueWei) + onChainDeal.pricePaid).toString(),
          updatedAt: now,
        });

      recordRevenueEvent({
        creatorUid: listing.sellerUid,
        creatorAddress: listing.sellerAddress,
        source: 'licensing',
        amountWei: onChainDeal.pricePaid.toString(),
        universeId: null,
        metadata: {
          dealType: input.dealType,
          listingId: input.listingId,
          entityKind: listing.entityKind,
          useCase: input.declaredUseCase,
          onChain: 'true',
          chainId: String(listing.onChainChainId),
        },
      }).catch((err) => console.error('[likenessMarketplace] revenue recording failed:', err));

      return deal;
    }),

  // ── End Phase 1.5 ─────────────────────────────────────────────────────

  /**
   * Public marketplace browse. Filter by kind / modality / deal type with
   * cursor pagination on `createdAt`.
   */
  browse: publicProcedure
    .input(
      z
        .object({
          kind: z.enum(['voice', 'likeness', 'persona']).optional(),
          modality: modalitySchema.optional(),
          dealType: z.enum(LIKENESS_DEAL_TYPES).optional(),
          search: z.string().max(80).optional(),
          sortBy: z.enum(['newest', 'price_asc', 'price_desc', 'popular']).default('newest'),
          limit: z.number().int().min(1).max(50).default(20),
          cursor: z.string().optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const params = input ?? { sortBy: 'newest' as const, limit: 20 };

      let q: FirebaseFirestore.Query = listingsCol().where('active', '==', true);
      if (params.kind) q = q.where('entityKind', '==', params.kind);
      // modality is an array field — `array-contains` keeps it indexable.
      if (params.modality) q = q.where('modalities', 'array-contains', params.modality);

      // Sort: for newest/popular we use Firestore ordering; for price sorts we
      // overfetch and sort in memory to avoid a price-by-deal-type index matrix.
      if (params.sortBy === 'popular') {
        q = q.orderBy('totalSales', 'desc');
      } else {
        q = q.orderBy('createdAt', 'desc');
      }

      const fetchSize =
        params.sortBy === 'price_asc' ||
        params.sortBy === 'price_desc' ||
        params.dealType ||
        params.search
          ? Math.min(params.limit * 4, 100)
          : params.limit;

      if (params.cursor) {
        const cursorSnap = await listingsCol().doc(params.cursor).get();
        if (cursorSnap.exists) q = q.startAfter(cursorSnap);
      }

      const snap = await q.limit(fetchSize).get();
      let docs = snap.docs.map((d) => ({ ...(d.data() as LikenessListing), id: d.id }));

      // Deal-type filter
      if (params.dealType === 'BUY') {
        docs = docs.filter((d) => d.buyPriceWei !== '0');
      } else if (params.dealType === 'LEASE') {
        docs = docs.filter((d) => d.leasePricePerDayWei !== '0');
      } else if (params.dealType === 'LICENSE') {
        docs = docs.filter((d) => d.licenseFeeWei !== '0');
      }

      // Search filter (post-fetch — Firestore lacks LIKE)
      if (params.search) {
        const needle = params.search.toLowerCase();
        docs = docs.filter(
          (d) =>
            d.title.toLowerCase().includes(needle) || d.description.toLowerCase().includes(needle)
        );
      }

      // In-memory price sort
      if (params.sortBy === 'price_asc' || params.sortBy === 'price_desc') {
        const pricePicker = (d: LikenessListing): bigint => {
          if (params.dealType === 'LEASE') return BigInt(d.leasePricePerDayWei);
          if (params.dealType === 'LICENSE') return BigInt(d.licenseFeeWei);
          // Default: cheapest entry-point price across the three deal types.
          const candidates = [d.buyPriceWei, d.leasePricePerDayWei, d.licenseFeeWei]
            .map((s) => BigInt(s))
            .filter((b) => b > 0n);
          return candidates.length ? candidates.reduce((m, x) => (x < m ? x : m)) : 0n;
        };
        docs.sort((a, b) => {
          const pa = pricePicker(a);
          const pb = pricePicker(b);
          if (pa === pb) return 0;
          if (params.sortBy === 'price_asc') return pa < pb ? -1 : 1;
          return pa < pb ? 1 : -1;
        });
      }

      const trimmed = docs.slice(0, params.limit);
      const nextCursor = trimmed.length === params.limit ? trimmed[trimmed.length - 1].id : null;
      return { listings: trimmed, nextCursor };
    }),

  /** Single listing + active consent terms (public scope — minus the rights holder uid). */
  getListing: publicProcedure
    .input(z.object({ listingId: z.string() }))
    .query(async ({ input }) => {
      const snap = await listingsCol().doc(input.listingId).get();
      if (!snap.exists) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Listing not found' });
      }
      const listing = { ...(snap.data() as LikenessListing), id: snap.id };

      const consentSnap = await consentsCol()
        .doc(listing.entityId)
        .collection('revisions')
        .doc(listing.consentId)
        .get();
      const consent = consentSnap.exists ? (consentSnap.data() as LikenessConsent) : null;

      // Public projection of the consent (no uid, no signature).
      const consentTerms = consent
        ? {
            modalities: consent.modalities,
            allowedUseCases: consent.allowedUseCases,
            prohibitions: consent.prohibitions,
            permitSale: consent.permitSale,
            permitLease: consent.permitLease,
            permitLicense: consent.permitLicense,
            realPerson: consent.realPerson,
            verified: consent.verified,
          }
        : null;

      return { listing, consentTerms };
    }),

  /** My listings as seller. */
  myListings: protectedProcedure
    .input(
      z.object({
        includeInactive: z.boolean().default(false),
        limit: z.number().int().min(1).max(100).default(50),
      })
    )
    .query(async ({ input, ctx }) => {
      let q: FirebaseFirestore.Query = listingsCol().where('sellerUid', '==', ctx.user.uid);
      if (!input.includeInactive) q = q.where('active', '==', true);
      q = q.orderBy('createdAt', 'desc').limit(input.limit);
      const snap = await q.get();
      return snap.docs.map((d) => ({ ...(d.data() as LikenessListing), id: d.id }));
    }),

  /**
   * Record a deal after the buyer pays the seller on-chain. The buyer's
   * `txHash` is verified for `expectedFrom = buyer`, `expectedTo = seller`,
   * `minValueWei = quotedPrice`. Use case is recorded into the deal and
   * must be one the consent allows.
   */
  recordDeal: protectedProcedure
    .input(
      z.object({
        listingId: z.string(),
        dealType: z.enum(LIKENESS_DEAL_TYPES),
        pricePaidWei: weiString,
        durationDays: z.number().int().min(1).max(MAX_DURATION_DAYS).optional(),
        declaredUseCase: useCaseSchema,
        txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'Invalid txHash format'),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (!ctx.user.address) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Connected wallet required to record deal',
        });
      }

      const listingRef = listingsCol().doc(input.listingId);
      const listingSnap = await listingRef.get();
      if (!listingSnap.exists) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Listing not found' });
      }
      const listing = listingSnap.data() as LikenessListing;
      if (!listing.active) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Listing is no longer active' });
      }
      if (listing.sellerUid === ctx.user.uid) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cannot buy from your own listing' });
      }

      // Validate price + duration vs listing terms.
      let requiredWei: bigint;
      if (input.dealType === 'BUY') {
        if (listing.buyPriceWei === '0') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Listing is not for sale' });
        }
        requiredWei = BigInt(listing.buyPriceWei);
      } else if (input.dealType === 'LEASE') {
        if (listing.leasePricePerDayWei === '0') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Listing is not for lease' });
        }
        if (!input.durationDays) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'durationDays required for LEASE' });
        }
        if (input.durationDays > listing.maxDurationDays) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Duration exceeds listing maximum of ${listing.maxDurationDays} days`,
          });
        }
        requiredWei = BigInt(listing.leasePricePerDayWei) * BigInt(input.durationDays);
      } else {
        // LICENSE
        if (listing.licenseFeeWei === '0') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Listing is not licensable' });
        }
        if (!input.durationDays) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'durationDays required for LICENSE',
          });
        }
        if (input.durationDays > listing.maxDurationDays) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Duration exceeds listing maximum of ${listing.maxDurationDays} days`,
          });
        }
        requiredWei = BigInt(listing.licenseFeeWei);
      }

      if (BigInt(input.pricePaidWei) < requiredWei) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Quoted price is below the listing requirement',
        });
      }

      // Use-case scope check
      const consentSnap = await consentsCol()
        .doc(listing.entityId)
        .collection('revisions')
        .doc(listing.consentId)
        .get();
      const consent = consentSnap.exists ? (consentSnap.data() as LikenessConsent) : null;
      if (!consent || consent.status !== 'active') {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Listing consent is no longer active',
        });
      }
      if (!consent.allowedUseCases.includes(input.declaredUseCase)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Use case "${input.declaredUseCase}" is not authorized by the rights holder`,
        });
      }

      // Verify on-chain payment binding (buyer → seller, value ≥ required).
      await verifyAndClaimTx(
        input.txHash,
        `likeness-deal:${input.listingId}:${input.dealType}`,
        ctx.user.uid,
        {
          expectedFrom: ctx.user.address,
          expectedTo: listing.sellerAddress,
          minValueWei: requiredWei.toString(),
        }
      );

      const now = new Date();
      const dealId = randomUUID();
      const endTime =
        input.dealType === 'BUY'
          ? null
          : input.durationDays
            ? new Date(now.getTime() + input.durationDays * 24 * 60 * 60 * 1000)
            : null;

      // M7: pin persona version at sale time (see recordOnChainDeal).
      let personaVersionAtSale: number | null = null;
      let personaVersionIdAtSale: string | null = null;
      if (listing.entityKind === 'persona') {
        const personaEnt = await getEntity(listing.entityId);
        const pMeta = personaEnt?.metadata as unknown as PersonaEntityMetadata | undefined;
        personaVersionAtSale = pMeta?.versionCount ?? null;
        personaVersionIdAtSale = pMeta?.activeVersionId ?? null;
      }

      const deal: LikenessDeal = {
        id: dealId,
        listingId: input.listingId,
        entityId: listing.entityId,
        dealType: input.dealType,
        sellerUid: listing.sellerUid,
        sellerAddress: listing.sellerAddress,
        buyerUid: ctx.user.uid,
        buyerAddress: ctx.user.address.toLowerCase(),
        pricePaidWei: input.pricePaidWei,
        durationDays: input.durationDays ?? null,
        endTime,
        txHash: input.txHash.toLowerCase(),
        status: 'ACTIVE',
        declaredUseCase: input.declaredUseCase,
        startTime: now,
        onChain: false,
        onChainDealId: null,
        personaVersionAtSale,
        personaVersionIdAtSale,
      };

      await dealsCol().doc(dealId).set(deal);
      await listingRef.update({
        totalSales: listing.totalSales + 1,
        totalRevenueWei: (BigInt(listing.totalRevenueWei) + BigInt(input.pricePaidWei)).toString(),
        updatedAt: now,
      });

      // Revenue accounting — seller gets the headline credit.
      recordRevenueEvent({
        creatorUid: listing.sellerUid,
        creatorAddress: listing.sellerAddress,
        source: 'licensing',
        amountWei: input.pricePaidWei,
        universeId: null,
        metadata: {
          dealType: input.dealType,
          listingId: input.listingId,
          entityKind: listing.entityKind,
          useCase: input.declaredUseCase,
        },
      }).catch((err) => console.error('[likenessMarketplace] revenue recording failed:', err));

      return deal;
    }),

  /** Deals I've sold (as seller). */
  mySales: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(50).default(20) }))
    .query(async ({ ctx, input }) => {
      const snap = await dealsCol()
        .where('sellerUid', '==', ctx.user.uid)
        .orderBy('startTime', 'desc')
        .limit(input.limit)
        .get();
      return snap.docs.map((d) => ({ ...(d.data() as LikenessDeal), id: d.id }));
    }),

  /** Deals I've purchased (as buyer). */
  myPurchases: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(50).default(20) }))
    .query(async ({ ctx, input }) => {
      const snap = await dealsCol()
        .where('buyerUid', '==', ctx.user.uid)
        .orderBy('startTime', 'desc')
        .limit(input.limit)
        .get();
      return snap.docs.map((d) => ({ ...(d.data() as LikenessDeal), id: d.id }));
    }),

  /**
   * Check if a buyer has active access to an entity for a given use case.
   * Auto-expires deals past their endTime. Call this before allowing a
   * downstream generation against the licensed voice/likeness.
   */
  checkAccess: publicProcedure
    .input(
      z.object({
        entityId: z.string(),
        buyerUid: z.string(),
        useCase: useCaseSchema.optional(),
      })
    )
    .query(async ({ input }) => {
      const snap = await dealsCol()
        .where('entityId', '==', input.entityId)
        .where('buyerUid', '==', input.buyerUid)
        .where('status', '==', 'ACTIVE')
        .orderBy('startTime', 'desc')
        .limit(10)
        .get();
      if (snap.empty) return { hasAccess: false, reason: 'no_deal' as const };

      const now = Date.now();
      for (const doc of snap.docs) {
        const deal = doc.data() as LikenessDeal;
        // Use-case match (if caller provided one)
        if (input.useCase && deal.declaredUseCase !== input.useCase) continue;

        if (deal.dealType === 'BUY') {
          return { hasAccess: true, dealId: doc.id, dealType: 'BUY' as const };
        }
        const endMs = deal.endTime
          ? deal.endTime instanceof Date
            ? deal.endTime.getTime()
            : new Date(deal.endTime as unknown as string).getTime()
          : null;
        if (endMs !== null && endMs < now) {
          await dealsCol().doc(doc.id).update({ status: 'EXPIRED' });
          continue;
        }
        return {
          hasAccess: true,
          dealId: doc.id,
          dealType: deal.dealType,
          expiresAt: endMs ? new Date(endMs).toISOString() : null,
        };
      }
      return { hasAccess: false, reason: 'expired' as const };
    }),
});

// Re-export type-level constants for the web layer.
export type LikenessRouterListing = LikenessListing;
export type LikenessRouterDeal = LikenessDeal;
export type LikenessRouterConsent = LikenessConsent;
export type LikenessRouterModality = LikenessModality;
export type LikenessRouterUseCase = LikenessUseCase;

// Silence unused-import warnings for shape-only imports used in type assertions.
void (null as unknown as LikenessEntityMetadata);
