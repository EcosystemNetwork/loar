/**
 * Persona Router — PRD 9: Likeness Packages.
 *
 * A `persona` entity bundles a creator's voice, looks (face / body / video /
 * 3D), and personality (bio + system prompt + tone profile + few-shot
 * exemplars) into a single sellable identity. The downstream marketplace
 * (likenessMarketplace.*) treats a persona as just another entity kind, so
 * we reuse its consent + listing + on-chain flow verbatim.
 *
 * Three origin classes:
 *
 *   self        Real person, performer = subject. KYC + consent apply
 *               (Phase 4 — currently click-through consent only).
 *   parody      Recognizable public figure. Auto-routes the persona into
 *               admin moderation. Persona stays `pending_review` until an
 *               admin approves; any listing on it is force-deactivated
 *               while pending.
 *   fictional   Original character; performer affirms no real-person basis.
 *               No KYC. Misuse caught post-hoc via DMCA / flag path.
 *
 * Versioning: editing a persona's profile or components produces a new
 * immutable `PersonaVersion` document. Existing deals stay pinned to the
 * version they bought (resolved client-side via `version.profile`).
 *
 * Collections:
 *   entities/{personaEntityId}                        kind=persona, metadata=PersonaEntityMetadata
 *   personaVersions/{personaEntityId}/versions/{vId}  immutable per-edit snapshots
 *   personaVersions/{personaEntityId}                 pointer to active version
 *   personaModeration/{personaEntityId}               admin review log (parody origin)
 */
import { router, protectedProcedure, publicProcedure, adminProcedure } from '../../lib/trpc';
import { db } from '../../lib/firebase';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { randomUUID } from 'crypto';
import {
  ENTITY_KINDS,
  PERSONA_ORIGINS,
  PERSONA_LIMITS,
  DEFAULT_PERSONA_TONE,
  PERSONA_FICTIONAL_AFFIRMATION_V1,
  PERSONA_PARODY_ACKNOWLEDGEMENT_V1,
  type Entity,
  type PersonaEntityMetadata,
  type PersonaProfile,
  type PersonaToneProfile,
  type PersonaVersion,
  type PersonaModerationStatus,
  type UpdateEntityInput,
} from '../entities/entities.types';
import {
  createEntity,
  getEntity,
  updateEntity,
  getEntitiesByCreator,
} from '../entities/entities.handlers';

// Compile-time guarantee that `persona` is part of the kind union.
void (ENTITY_KINDS as readonly string[]).includes('persona');

// ── Collections ──────────────────────────────────────────────────────────

const personaVersionsCol = () => {
  if (!db) {
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Firebase not configured' });
  }
  return db.collection('personaVersions');
};

const personaModerationCol = () => {
  if (!db) {
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Firebase not configured' });
  }
  return db.collection('personaModeration');
};

const listingsCol = () => {
  if (!db) {
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Firebase not configured' });
  }
  return db.collection('likenessListings');
};

// ── Zod schemas ──────────────────────────────────────────────────────────

const originSchema = z.enum(PERSONA_ORIGINS);

const toneSchema = z
  .object({
    warmth: z.number().int().min(0).max(100),
    formality: z.number().int().min(0).max(100),
    humor: z.number().int().min(0).max(100),
    confidence: z.number().int().min(0).max(100),
    energy: z.number().int().min(0).max(100),
    custom: z.record(z.string().max(40), z.number().int().min(0).max(100)).optional(),
  })
  .strict();

const exemplarSchema = z
  .object({
    userTurn: z.string().min(1).max(PERSONA_LIMITS.exemplarUserTurnMax),
    personaTurn: z.string().min(1).max(PERSONA_LIMITS.exemplarPersonaTurnMax),
    context: z.string().max(60).optional(),
  })
  .strict();

const profileSchema = z
  .object({
    bio: z.string().max(PERSONA_LIMITS.bioMaxChars).default(''),
    systemPrompt: z.string().max(PERSONA_LIMITS.systemPromptMaxChars).default(''),
    tone: toneSchema.default(DEFAULT_PERSONA_TONE),
    exemplars: z.array(exemplarSchema).max(PERSONA_LIMITS.exemplarMax).default([]),
    tags: z
      .array(z.string().min(1).max(PERSONA_LIMITS.tagMaxChars))
      .max(PERSONA_LIMITS.tagsMax)
      .default([]),
    catchphrases: z
      .array(z.string().min(1).max(PERSONA_LIMITS.catchphraseMaxChars))
      .max(PERSONA_LIMITS.catchphraseMax)
      .optional(),
    redLines: z
      .array(z.string().min(1).max(PERSONA_LIMITS.redLineMaxChars))
      .max(PERSONA_LIMITS.redLineMax)
      .optional(),
  })
  .strict();

// ── Helpers ──────────────────────────────────────────────────────────────

/** Read an entity and assert the caller owns it AND it is kind=persona. */
async function readOwnedPersona(entityId: string, callerAddress: string): Promise<Entity> {
  const entity = await getEntity(entityId);
  if (!entity) throw new TRPCError({ code: 'NOT_FOUND', message: 'Persona not found' });
  if ((entity.creator || '').toLowerCase() !== callerAddress.toLowerCase()) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not own this persona' });
  }
  if (entity.kind !== 'persona') {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Entity is not a persona' });
  }
  return entity;
}

/**
 * Verify a component reference is owned by the same creator and is the
 * expected kind. Component refs are optional — null/undefined passes through.
 */
async function assertComponentOwnership(opts: {
  componentId: string | null | undefined;
  expectedKind: 'voice' | 'likeness';
  callerAddress: string;
  fieldLabel: string;
}): Promise<void> {
  if (!opts.componentId) return;
  const ent = await getEntity(opts.componentId);
  if (!ent) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `${opts.fieldLabel} entity not found`,
    });
  }
  if ((ent.creator || '').toLowerCase() !== opts.callerAddress.toLowerCase()) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: `You do not own the referenced ${opts.fieldLabel}`,
    });
  }
  if (ent.kind !== opts.expectedKind) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Expected ${opts.fieldLabel} to be kind=${opts.expectedKind}, got ${ent.kind}`,
    });
  }
}

/**
 * Persist a new immutable version document and bump the persona's pointer to
 * it. Optionally marks the prior version inactive (active version is a
 * pointer field on the entity, but the per-version `active: bool` is also
 * maintained for fast scans).
 */
async function writeVersion(opts: {
  personaEntityId: string;
  versionNumber: number;
  profile: PersonaProfile;
  voiceEntityId?: string;
  likenessEntityId?: string;
  threeDAssetUrl?: string;
  authorUid: string;
  authorAddress: string;
  changeNote?: string;
}): Promise<PersonaVersion> {
  if (!db) {
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Firebase not configured' });
  }
  const versionId = randomUUID();
  const now = new Date();
  const version: PersonaVersion = {
    id: versionId,
    personaEntityId: opts.personaEntityId,
    version: opts.versionNumber,
    profile: opts.profile,
    ...(opts.voiceEntityId ? { voiceEntityId: opts.voiceEntityId } : {}),
    ...(opts.likenessEntityId ? { likenessEntityId: opts.likenessEntityId } : {}),
    ...(opts.threeDAssetUrl ? { threeDAssetUrl: opts.threeDAssetUrl } : {}),
    authorUid: opts.authorUid,
    authorAddress: opts.authorAddress.toLowerCase(),
    ...(opts.changeNote ? { changeNote: opts.changeNote } : {}),
    active: true,
    createdAt: now,
  };

  const batch = db.batch();
  // Demote prior active versions.
  const priorActive = await personaVersionsCol()
    .doc(opts.personaEntityId)
    .collection('versions')
    .where('active', '==', true)
    .get();
  for (const doc of priorActive.docs) {
    batch.update(doc.ref, { active: false });
  }
  batch.set(
    personaVersionsCol().doc(opts.personaEntityId).collection('versions').doc(versionId),
    version
  );
  batch.set(
    personaVersionsCol().doc(opts.personaEntityId),
    {
      activeVersionId: versionId,
      versionCount: opts.versionNumber,
      updatedAt: now,
    },
    { merge: true }
  );
  await batch.commit();
  return version;
}

/**
 * Deactivate any open listings on this persona — used when a parody is set to
 * `pending_review` (or rejected). Buyer access on prior deals is preserved.
 */
async function suspendOpenListings(personaEntityId: string, reason: string): Promise<number> {
  if (!db) return 0;
  const snap = await listingsCol()
    .where('entityId', '==', personaEntityId)
    .where('active', '==', true)
    .get();
  if (snap.empty) return 0;
  const now = new Date();
  const batch = db.batch();
  for (const doc of snap.docs) {
    batch.update(doc.ref, {
      active: false,
      suspensionReason: reason,
      updatedAt: now,
    });
  }
  await batch.commit();
  return snap.size;
}

// ── Router ───────────────────────────────────────────────────────────────

export const personaRouter = router({
  /**
   * Create a new persona. For origin=parody, the persona is created in
   * `moderationStatus = pending_review` and any listings on it must wait for
   * admin approval before going live.
   *
   * Self/fictional origins go live immediately (moderationStatus=not_required).
   */
  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(80),
        description: z.string().max(2000).default(''),
        imageUrl: z.string().url().nullish(),
        origin: originSchema,
        parodySubject: z.string().min(1).max(120).optional(),
        parodyDisclaimer: z.string().min(1).max(500).optional(),
        parodyAcknowledgement: z.literal(PERSONA_PARODY_ACKNOWLEDGEMENT_V1).optional(),
        fictionalAffirmation: z.literal(PERSONA_FICTIONAL_AFFIRMATION_V1).optional(),
        voiceEntityId: z.string().optional(),
        likenessEntityId: z.string().optional(),
        threeDAssetUrl: z
          .string()
          .url()
          .regex(
            /\.(glb|gltf|fbx|obj|usdz)(\?.*)?$/i,
            '3D asset must be .glb/.gltf/.fbx/.obj/.usdz'
          )
          .optional(),
        threeDGenerationId: z.string().optional(),
        profile: profileSchema,
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (!ctx.user.address) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Connected wallet required to create a persona',
        });
      }

      // ── Origin-specific gate ──────────────────────────────────────────
      if (input.origin === 'parody') {
        if (!input.parodySubject) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'parodySubject is required for parody personas',
          });
        }
        if (!input.parodyDisclaimer) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'parodyDisclaimer is required for parody personas',
          });
        }
        if (!input.parodyAcknowledgement) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'You must acknowledge the parody attestation text to submit this persona',
          });
        }
        // Defense in depth — even though z.literal already enforces this at
        // parse time, re-compare to the server-pinned constant so any future
        // schema relaxation doesn't silently accept a tampered attestation.
        if (input.parodyAcknowledgement !== PERSONA_PARODY_ACKNOWLEDGEMENT_V1) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Parody acknowledgement text does not match the current pinned version',
          });
        }
      } else if (input.origin === 'fictional') {
        if (!input.fictionalAffirmation) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'You must affirm no real person is depicted to submit a fictional persona',
          });
        }
        if (input.fictionalAffirmation !== PERSONA_FICTIONAL_AFFIRMATION_V1) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Fictional affirmation text does not match the current pinned version',
          });
        }
      }

      // ── Component ownership check ─────────────────────────────────────
      await assertComponentOwnership({
        componentId: input.voiceEntityId,
        expectedKind: 'voice',
        callerAddress: ctx.user.address,
        fieldLabel: 'voice',
      });
      await assertComponentOwnership({
        componentId: input.likenessEntityId,
        expectedKind: 'likeness',
        callerAddress: ctx.user.address,
        fieldLabel: 'likeness',
      });

      // ── Build metadata ────────────────────────────────────────────────
      const moderationStatus: PersonaModerationStatus =
        input.origin === 'parody' ? 'pending_review' : 'not_required';

      // Provisional metadata — activeVersionId is filled after version write.
      const initialMetadata: PersonaEntityMetadata = {
        origin: input.origin,
        ...(input.parodySubject ? { parodySubject: input.parodySubject } : {}),
        ...(input.parodyDisclaimer ? { parodyDisclaimer: input.parodyDisclaimer } : {}),
        ...(input.origin === 'fictional' ? { fictionalAffirmation: true } : {}),
        ...(input.voiceEntityId ? { voiceEntityId: input.voiceEntityId } : {}),
        ...(input.likenessEntityId ? { likenessEntityId: input.likenessEntityId } : {}),
        ...(input.threeDAssetUrl ? { threeDAssetUrl: input.threeDAssetUrl } : {}),
        ...(input.threeDGenerationId ? { threeDGenerationId: input.threeDGenerationId } : {}),
        profile: input.profile,
        activeVersionId: '', // filled after version write
        versionCount: 1,
        moderationStatus,
      };

      const { data: entity } = await createEntity(
        {
          name: input.name,
          description: input.description,
          kind: 'persona',
          universeAddress: null,
          parentId: null,
          imageUrl: input.imageUrl ?? null,
          metadata: initialMetadata as unknown as Record<string, unknown>,
          monetized: false,
          rightsDeclaration: null,
        },
        ctx.user.address
      );

      // ── Persist initial version + update pointer ─────────────────────
      const version = await writeVersion({
        personaEntityId: entity.id,
        versionNumber: 1,
        profile: input.profile,
        voiceEntityId: input.voiceEntityId,
        likenessEntityId: input.likenessEntityId,
        threeDAssetUrl: input.threeDAssetUrl,
        authorUid: ctx.user.uid,
        authorAddress: ctx.user.address,
        changeNote: 'Initial version',
      });

      // Stamp activeVersionId on entity metadata.
      const finalMetadata = { ...initialMetadata, activeVersionId: version.id };
      await updateEntity(entity.id, { metadata: finalMetadata });

      // ── Parody: write moderation record for admin queue ──────────────
      if (input.origin === 'parody') {
        await personaModerationCol()
          .doc(entity.id)
          .set({
            personaEntityId: entity.id,
            creatorUid: ctx.user.uid,
            creatorAddress: ctx.user.address.toLowerCase(),
            parodySubject: input.parodySubject ?? null,
            parodyDisclaimer: input.parodyDisclaimer ?? null,
            acknowledgement: PERSONA_PARODY_ACKNOWLEDGEMENT_V1,
            status: 'pending_review' as PersonaModerationStatus,
            createdAt: new Date(),
          });
      }

      return { ...entity, metadata: finalMetadata } as Entity;
    }),

  /**
   * Edit a persona. Profile changes create a new immutable version; component
   * swaps (voice/likeness/3D) also bump the version. Returns the new version.
   *
   * Cannot change `origin` after creation (would invalidate the attestation
   * record). Cannot edit a persona while parody moderation is pending.
   */
  update: protectedProcedure
    .input(
      z.object({
        personaEntityId: z.string(),
        name: z.string().min(1).max(80).optional(),
        description: z.string().max(2000).optional(),
        imageUrl: z.string().url().nullish(),
        voiceEntityId: z.string().nullish(),
        likenessEntityId: z.string().nullish(),
        threeDAssetUrl: z
          .string()
          .url()
          .regex(/\.(glb|gltf|fbx|obj|usdz)(\?.*)?$/i)
          .nullish(),
        threeDGenerationId: z.string().nullish(),
        profile: profileSchema,
        changeNote: z.string().max(200).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (!ctx.user.address) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Connected wallet required' });
      }
      const entity = await readOwnedPersona(input.personaEntityId, ctx.user.address);
      const currentMeta = entity.metadata as unknown as PersonaEntityMetadata;

      if (currentMeta.moderationStatus === 'pending_review') {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Persona is under moderation review — edits are locked until approval',
        });
      }

      // Component checks (only when changed to a non-null value).
      if (input.voiceEntityId) {
        await assertComponentOwnership({
          componentId: input.voiceEntityId,
          expectedKind: 'voice',
          callerAddress: ctx.user.address,
          fieldLabel: 'voice',
        });
      }
      if (input.likenessEntityId) {
        await assertComponentOwnership({
          componentId: input.likenessEntityId,
          expectedKind: 'likeness',
          callerAddress: ctx.user.address,
          fieldLabel: 'likeness',
        });
      }

      // ── C-1: detect speech-bearing changes on parody personas ──────────
      // For origin=parody, ANY edit to profile or top-level identity fields
      // (name/description) re-opens admin review. Prior implementation only
      // tracked a subset of profile sub-fields — easy to bypass by editing
      // tone/tags/custom or by drifting the description. Re-reviewing on
      // every parody mutation is the safer default.
      const prevProfile = currentMeta.profile;
      const nextProfile = input.profile;
      const jsonEq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
      const speechBearingChanged =
        (input.name !== undefined && input.name !== entity.name) ||
        (input.description !== undefined && input.description !== (entity.description ?? '')) ||
        !jsonEq(prevProfile, nextProfile);
      const requiresRereview =
        currentMeta.origin === 'parody' &&
        currentMeta.moderationStatus === 'approved' &&
        speechBearingChanged;

      const nextVersionNumber = currentMeta.versionCount + 1;
      const version = await writeVersion({
        personaEntityId: entity.id,
        versionNumber: nextVersionNumber,
        profile: input.profile,
        voiceEntityId: input.voiceEntityId ?? currentMeta.voiceEntityId,
        likenessEntityId: input.likenessEntityId ?? currentMeta.likenessEntityId,
        threeDAssetUrl: input.threeDAssetUrl ?? currentMeta.threeDAssetUrl,
        authorUid: ctx.user.uid,
        authorAddress: ctx.user.address,
        changeNote: input.changeNote,
      });

      // Stamp new metadata snapshot.
      const nextMeta: PersonaEntityMetadata = {
        ...currentMeta,
        profile: input.profile,
        activeVersionId: version.id,
        versionCount: nextVersionNumber,
        // Component refs — explicit null clears the field, undefined preserves it.
        voiceEntityId:
          input.voiceEntityId === null
            ? undefined
            : (input.voiceEntityId ?? currentMeta.voiceEntityId),
        likenessEntityId:
          input.likenessEntityId === null
            ? undefined
            : (input.likenessEntityId ?? currentMeta.likenessEntityId),
        threeDAssetUrl:
          input.threeDAssetUrl === null
            ? undefined
            : (input.threeDAssetUrl ?? currentMeta.threeDAssetUrl),
        threeDGenerationId:
          input.threeDGenerationId === null
            ? undefined
            : (input.threeDGenerationId ?? currentMeta.threeDGenerationId),
        ...(requiresRereview
          ? {
              moderationStatus: 'pending_review' as PersonaModerationStatus,
              moderationReviewerUid: undefined,
              moderationNotes: undefined,
              moderationReviewedAt: undefined,
            }
          : {}),
      };

      const entityUpdates: UpdateEntityInput = {
        metadata: nextMeta as unknown as Record<string, unknown>,
      };
      if (input.name !== undefined) entityUpdates.name = input.name;
      if (input.description !== undefined) entityUpdates.description = input.description;
      if (input.imageUrl !== undefined) entityUpdates.imageUrl = input.imageUrl;
      await updateEntity(entity.id, entityUpdates);

      // C-1: when a previously approved parody is downgraded, also:
      //  (1) reopen the personaModeration queue record
      //  (2) suspend any open listings on this persona (deals stay valid;
      //      buyers still get the version they bought via the version pin)
      //  (3) append to contentAuditLog so admins have a trail
      if (requiresRereview) {
        const now = new Date();
        await personaModerationCol()
          .doc(entity.id)
          .set(
            {
              personaEntityId: entity.id,
              status: 'pending_review' as PersonaModerationStatus,
              reopenedAt: now,
              reopenedReason: 'parody_post_approval_edit',
              previousVersion: currentMeta.versionCount,
              newVersion: nextVersionNumber,
              editorUid: ctx.user.uid,
              editorAddress: ctx.user.address.toLowerCase(),
            },
            { merge: true }
          );
        await suspendOpenListings(entity.id, 'parody_rereview_pending');
        if (db) {
          await db.collection('contentAuditLog').add({
            contentId: entity.id,
            action: 'persona_parody_rereview_triggered',
            actorUid: ctx.user.uid.toLowerCase(),
            actorAddress: ctx.user.address.toLowerCase(),
            previousStatus: 'approved',
            newStatus: 'pending_review',
            previousVersion: currentMeta.versionCount,
            newVersion: nextVersionNumber,
            createdAt: now.toISOString(),
          });
        }
      }

      return { version, metadata: nextMeta, requiresRereview };
    }),

  /** Get a single persona by id (public — but parody pending_review is hidden from non-owners). */
  get: publicProcedure
    .input(z.object({ personaEntityId: z.string() }))
    .query(async ({ input, ctx }) => {
      const entity = await getEntity(input.personaEntityId);
      if (!entity || entity.kind !== 'persona') return null;
      const meta = entity.metadata as unknown as PersonaEntityMetadata;
      const isOwner =
        !!ctx.user?.address &&
        (entity.creator || '').toLowerCase() === ctx.user.address.toLowerCase();
      if (meta.moderationStatus === 'pending_review' && !isOwner) {
        return null;
      }
      if (meta.moderationStatus === 'rejected' && !isOwner) {
        return null;
      }
      // M1: never ship the system prompt or red-lines to anyone who doesn't
      // own the persona. These are the steering inputs a buyer pays to use
      // via `getVersion` on a held deal, not free-to-browse metadata.
      if (!isOwner) {
        const safeMeta: PersonaEntityMetadata = { ...meta };
        if (safeMeta.profile) {
          const { systemPrompt: _omit1, redLines: _omit2, ...safeProfile } = safeMeta.profile;
          void _omit1;
          void _omit2;
          safeMeta.profile = {
            ...safeProfile,
            systemPrompt: '',
            redLines: undefined,
          } as PersonaProfile;
        }
        return { ...entity, metadata: safeMeta as unknown as Record<string, unknown> } as Entity;
      }
      return entity;
    }),

  /** All personas owned by the caller. */
  listMine: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.user.address) return [] as Entity[];
    return getEntitiesByCreator(ctx.user.address.toLowerCase(), 'persona', 100);
  }),

  /** Public browse of approved personas. Filtered by origin if provided. */
  listPublic: publicProcedure
    .input(
      z
        .object({
          origin: originSchema.optional(),
          limit: z.number().int().min(1).max(50).default(20),
          cursor: z.string().optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      if (!db) return { personas: [], nextCursor: null as string | null };
      const params = input ?? { limit: 20 };
      let q: FirebaseFirestore.Query = db
        .collection('entities')
        .where('kind', '==', 'persona')
        .orderBy('createdAt', 'desc');

      if (params.cursor) {
        const cursorSnap = await db.collection('entities').doc(params.cursor).get();
        if (cursorSnap.exists) q = q.startAfter(cursorSnap);
      }
      const snap = await q.limit(params.limit * 2).get();

      const out: Entity[] = [];
      for (const doc of snap.docs) {
        const ent = { id: doc.id, ...doc.data() } as Entity;
        const meta = ent.metadata as unknown as PersonaEntityMetadata;
        if (meta.moderationStatus !== 'not_required' && meta.moderationStatus !== 'approved') {
          continue;
        }
        if (params.origin && meta.origin !== params.origin) continue;
        // M1: list endpoint is fully public — strip the steering inputs
        // (systemPrompt / redLines) before returning. Buyers fetch the
        // real profile via `getVersion` after a deal is recorded.
        const safeMeta: PersonaEntityMetadata = { ...meta };
        if (safeMeta.profile) {
          safeMeta.profile = {
            ...safeMeta.profile,
            systemPrompt: '',
            redLines: undefined,
          };
        }
        out.push({ ...ent, metadata: safeMeta as unknown as Record<string, unknown> } as Entity);
        if (out.length >= params.limit) break;
      }
      const nextCursor = out.length === params.limit ? out[out.length - 1].id : null;
      return { personas: out, nextCursor };
    }),

  /** Full version history for a persona — visible to owner; public sees only the active one. */
  listVersions: publicProcedure
    .input(z.object({ personaEntityId: z.string() }))
    .query(async ({ input, ctx }) => {
      const entity = await getEntity(input.personaEntityId);
      if (!entity || entity.kind !== 'persona') return [] as PersonaVersion[];
      const isOwner =
        !!ctx.user?.address &&
        (entity.creator || '').toLowerCase() === ctx.user.address.toLowerCase();

      const snap = await personaVersionsCol()
        .doc(input.personaEntityId)
        .collection('versions')
        .orderBy('version', 'desc')
        .get();
      const versions = snap.docs.map((d) => d.data() as PersonaVersion);
      return isOwner ? versions : versions.filter((v) => v.active);
    }),

  /** Read a specific version (e.g. a buyer resolving the version they licensed). */
  getVersion: publicProcedure
    .input(z.object({ personaEntityId: z.string(), versionId: z.string() }))
    .query(async ({ input, ctx }) => {
      const snap = await personaVersionsCol()
        .doc(input.personaEntityId)
        .collection('versions')
        .doc(input.versionId)
        .get();
      if (!snap.exists) return null;
      const version = snap.data() as PersonaVersion;

      // M1: systemPrompt + redLines are only readable by the persona owner
      // or by an address that holds an active LikenessDeal on this version.
      const callerAddr = ctx.user?.address?.toLowerCase();
      const entity = await getEntity(input.personaEntityId);
      const isOwner = !!callerAddr && (entity?.creator || '').toLowerCase() === callerAddr;

      let hasActiveDeal = false;
      if (!isOwner && callerAddr && db) {
        const dealSnap = await db
          .collection('likenessDeals')
          .where('entityId', '==', input.personaEntityId)
          .where('buyerAddress', '==', callerAddr)
          .where('status', '==', 'ACTIVE')
          .limit(5)
          .get();
        // Require the deal to be pinned to this exact version (or, for
        // legacy deals without a pin, accept active deals against the
        // currently-active version).
        for (const doc of dealSnap.docs) {
          const d = doc.data() as { personaVersionIdAtSale?: string };
          if (d.personaVersionIdAtSale === input.versionId) {
            hasActiveDeal = true;
            break;
          }
          if (!d.personaVersionIdAtSale && version.active) {
            hasActiveDeal = true;
            break;
          }
        }
      }

      if (!isOwner && !hasActiveDeal) {
        const { profile, ...rest } = version;
        const { systemPrompt: _omit1, redLines: _omit2, ...safeProfile } = profile;
        void _omit1;
        void _omit2;
        return {
          ...rest,
          profile: {
            ...safeProfile,
            systemPrompt: '',
            redLines: undefined,
          },
        } as PersonaVersion;
      }
      return version;
    }),

  /**
   * Bundle existing components into a persona in one step — convenience for
   * users who already have separate voice + likeness entities they want to
   * sell as a package. Equivalent to `create` but skips the inline component
   * uploads.
   */
  bundle: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(80),
        description: z.string().max(2000).default(''),
        imageUrl: z.string().url().nullish(),
        voiceEntityId: z.string().optional(),
        likenessEntityId: z.string().optional(),
        origin: originSchema.default('self'),
        profile: profileSchema,
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (!ctx.user.address) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Connected wallet required' });
      }
      if (!input.voiceEntityId && !input.likenessEntityId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'A bundle persona requires at least one component (voice or likeness)',
        });
      }
      if (input.origin === 'parody' || input.origin === 'fictional') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Bundle endpoint only supports origin=self. Use `create` for parody/fictional.',
        });
      }
      // Component checks
      await assertComponentOwnership({
        componentId: input.voiceEntityId,
        expectedKind: 'voice',
        callerAddress: ctx.user.address,
        fieldLabel: 'voice',
      });
      await assertComponentOwnership({
        componentId: input.likenessEntityId,
        expectedKind: 'likeness',
        callerAddress: ctx.user.address,
        fieldLabel: 'likeness',
      });

      const metadata: PersonaEntityMetadata = {
        origin: 'self',
        ...(input.voiceEntityId ? { voiceEntityId: input.voiceEntityId } : {}),
        ...(input.likenessEntityId ? { likenessEntityId: input.likenessEntityId } : {}),
        profile: input.profile,
        activeVersionId: '',
        versionCount: 1,
        moderationStatus: 'not_required',
      };
      const { data: entity } = await createEntity(
        {
          name: input.name,
          description: input.description,
          kind: 'persona',
          universeAddress: null,
          parentId: null,
          imageUrl: input.imageUrl ?? null,
          metadata: metadata as unknown as Record<string, unknown>,
          monetized: false,
          rightsDeclaration: null,
        },
        ctx.user.address
      );
      const version = await writeVersion({
        personaEntityId: entity.id,
        versionNumber: 1,
        profile: input.profile,
        voiceEntityId: input.voiceEntityId,
        likenessEntityId: input.likenessEntityId,
        authorUid: ctx.user.uid,
        authorAddress: ctx.user.address,
        changeNote: 'Bundled from components',
      });
      const finalMeta = { ...metadata, activeVersionId: version.id };
      await updateEntity(entity.id, { metadata: finalMeta });
      return { ...entity, metadata: finalMeta } as Entity;
    }),

  // ── Parody moderation (admin) ────────────────────────────────────────

  /** Admin queue of parody personas pending review. */
  parodyQueue: adminProcedure
    .input(
      z
        .object({
          status: z
            .enum(['pending_review', 'approved', 'rejected'])
            .default('pending_review')
            .optional(),
          limit: z.number().int().min(1).max(100).default(50),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const params = input ?? { status: 'pending_review' as const, limit: 50 };
      const snap = await personaModerationCol()
        .where('status', '==', params.status ?? 'pending_review')
        .orderBy('createdAt', 'desc')
        .limit(params.limit ?? 50)
        .get();
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    }),

  /** Admin: approve or reject a parody persona. */
  reviewParody: adminProcedure
    .input(
      z.object({
        personaEntityId: z.string(),
        decision: z.enum(['approved', 'rejected']),
        notes: z.string().max(2000).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const entity = await getEntity(input.personaEntityId);
      if (!entity || entity.kind !== 'persona') {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Persona not found' });
      }
      const meta = entity.metadata as unknown as PersonaEntityMetadata;
      if (meta.origin !== 'parody') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Persona is not origin=parody' });
      }
      if (meta.moderationStatus !== 'pending_review') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Persona is not pending review (current: ${meta.moderationStatus})`,
        });
      }
      const now = new Date();
      const nextStatus: PersonaModerationStatus = input.decision;
      const nextMeta: PersonaEntityMetadata = {
        ...meta,
        moderationStatus: nextStatus,
        moderationReviewerUid: ctx.user.uid,
        ...(input.notes ? { moderationNotes: input.notes } : {}),
        moderationReviewedAt: now,
      };
      await updateEntity(entity.id, {
        metadata: nextMeta as unknown as Record<string, unknown>,
      });
      await personaModerationCol()
        .doc(entity.id)
        .set(
          {
            status: nextStatus,
            reviewerUid: ctx.user.uid,
            reviewerAddress: ctx.user.address?.toLowerCase() ?? null,
            reviewNotes: input.notes ?? null,
            reviewedAt: now,
          },
          { merge: true }
        );

      // If rejected, suspend any open listings on this persona.
      let suspendedListings = 0;
      if (input.decision === 'rejected') {
        suspendedListings = await suspendOpenListings(entity.id, 'parody_rejected');
      }
      return { ok: true, status: nextStatus, suspendedListings };
    }),

  // ── Helpers / utilities ──────────────────────────────────────────────

  /** Default tone profile — convenience for UI forms. */
  defaultTone: publicProcedure.query(
    (): PersonaToneProfile => ({
      ...DEFAULT_PERSONA_TONE,
    })
  ),

  /** Pinned attestation texts so the UI can render exactly what the user signs off on. */
  attestationTexts: publicProcedure.query(() => ({
    parody: PERSONA_PARODY_ACKNOWLEDGEMENT_V1,
    fictional: PERSONA_FICTIONAL_AFFIRMATION_V1,
  })),

  /**
   * Compute whether a persona is currently listable. Used by the create-listing
   * UI to disable the publish button + the marketplace router as a gate.
   */
  canList: protectedProcedure
    .input(z.object({ personaEntityId: z.string() }))
    .query(async ({ input, ctx }) => {
      if (!ctx.user.address) return { canList: false, reason: 'no_wallet' as const };
      const entity = await getEntity(input.personaEntityId);
      if (!entity || entity.kind !== 'persona') {
        return { canList: false, reason: 'not_found' as const };
      }
      if ((entity.creator || '').toLowerCase() !== ctx.user.address.toLowerCase()) {
        return { canList: false, reason: 'not_owner' as const };
      }
      const meta = entity.metadata as unknown as PersonaEntityMetadata;
      if (meta.moderationStatus === 'pending_review') {
        return { canList: false, reason: 'pending_parody_review' as const };
      }
      if (meta.moderationStatus === 'rejected') {
        return { canList: false, reason: 'parody_rejected' as const };
      }
      return { canList: true as const, reason: null };
    }),
});

// Re-exports so client code can stay strongly typed.
export type PersonaRouter = typeof personaRouter;
