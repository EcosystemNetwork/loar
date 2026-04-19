/**
 * vlm.proposals — review and accept/reject VLM-drafted entity proposals.
 *
 * Accepting a proposal creates a real entity via the existing
 * createEntity handler. Proposals are not monetizable by default — a human
 * must subsequently mark monetized=true with an explicit rights declaration.
 */

import { z } from 'zod';
import { router, protectedProcedure } from '../../lib/trpc';
import { db, firebaseAvailable } from '../../lib/firebase';
import { createEntity } from '../entities/entities.handlers';
import { ENTITY_KINDS } from '../entities/entities.types';

const kindEnum = z.enum(ENTITY_KINDS as unknown as [string, ...string[]]);

export const vlmProposalsRouter = router({
  listByExtraction: protectedProcedure
    .input(z.object({ extractionId: z.string(), status: z.string().optional() }))
    .query(async ({ input }) => {
      if (!firebaseAvailable) return [];
      let q = db.collection('entityProposals').where('extractionId', '==', input.extractionId);
      if (input.status) q = q.where('status', '==', input.status) as any;
      const snap = await q.get();
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    }),

  listByUniverse: protectedProcedure
    .input(
      z.object({
        universeAddress: z.string(),
        status: z.string().default('pending'),
        limit: z.number().min(1).max(100).default(50),
      })
    )
    .query(async ({ input }) => {
      if (!firebaseAvailable) return [];
      const snap = await db
        .collection('entityProposals')
        .where('universeAddress', '==', input.universeAddress)
        .where('status', '==', input.status)
        .orderBy('createdAt', 'desc')
        .limit(input.limit)
        .get();
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    }),

  accept: protectedProcedure
    .input(
      z.object({
        proposalId: z.string(),
        overrides: z
          .object({
            name: z.string().optional(),
            description: z.string().optional(),
            kind: kindEnum.optional(),
            parentId: z.string().nullable().optional(),
            imageUrl: z.string().nullable().optional(),
            metadata: z.record(z.string(), z.unknown()).optional(),
          })
          .default({}),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!firebaseAvailable) throw new Error('Storage unavailable');
      const ref = db.collection('entityProposals').doc(input.proposalId);
      const doc = await ref.get();
      if (!doc.exists) throw new Error('Proposal not found');
      const p = doc.data()!;
      if (p.creatorUid !== ctx.user.uid.toLowerCase()) {
        throw new Error('Only the proposal creator may accept');
      }
      if (p.status !== 'pending') {
        throw new Error(`Proposal already ${p.status}`);
      }

      const { id, data } = await createEntity(
        {
          name: input.overrides.name ?? p.name,
          description: input.overrides.description ?? p.description,
          kind: (input.overrides.kind ?? p.kind) as any,
          universeAddress: p.universeAddress ?? null,
          parentId: input.overrides.parentId ?? null,
          imageUrl: input.overrides.imageUrl ?? null,
          metadata: {
            ...(p.metadata ?? {}),
            ...(input.overrides.metadata ?? {}),
            // provenance trail — this entity came from VLM
            _provenance: {
              source: 'vlm',
              extractionId: p.extractionId,
              proposalId: input.proposalId,
              acceptedAt: new Date().toISOString(),
            },
          },
          monetized: false,
          rightsDeclaration: null,
        },
        ctx.user.uid.toLowerCase()
      );

      await ref.update({
        status: 'accepted',
        decidedBy: ctx.user.uid.toLowerCase(),
        decidedAt: new Date(),
        acceptedEntityId: id,
      });

      return { entityId: id, entity: data };
    }),

  reject: protectedProcedure
    .input(z.object({ proposalId: z.string(), reason: z.string().max(500).optional() }))
    .mutation(async ({ ctx, input }) => {
      if (!firebaseAvailable) throw new Error('Storage unavailable');
      const ref = db.collection('entityProposals').doc(input.proposalId);
      const doc = await ref.get();
      if (!doc.exists) throw new Error('Proposal not found');
      const p = doc.data()!;
      if (p.creatorUid !== ctx.user.uid.toLowerCase()) {
        throw new Error('Only the proposal creator may reject');
      }
      if (p.status !== 'pending') return { ok: true };
      await ref.update({
        status: 'rejected',
        decidedBy: ctx.user.uid.toLowerCase(),
        decidedAt: new Date(),
        rejectReason: input.reason ?? null,
      });
      return { ok: true };
    }),

  merge: protectedProcedure
    .input(z.object({ proposalId: z.string(), targetEntityId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (!firebaseAvailable) throw new Error('Storage unavailable');
      const ref = db.collection('entityProposals').doc(input.proposalId);
      const doc = await ref.get();
      if (!doc.exists) throw new Error('Proposal not found');
      const p = doc.data()!;
      if (p.creatorUid !== ctx.user.uid.toLowerCase()) {
        throw new Error('Only the proposal creator may merge');
      }
      const targetDoc = await db.collection('entities').doc(input.targetEntityId).get();
      if (!targetDoc.exists) throw new Error('Target entity not found');
      const target = targetDoc.data()!;
      if (target.creator !== ctx.user.uid.toLowerCase()) {
        throw new Error('You can only merge into entities you own');
      }

      // Append proposal description/metadata to the existing entity as a note,
      // never overwrite. The entity keeps its original provenance.
      const mergedMetadata = {
        ...(target.metadata ?? {}),
        _vlmMerges: [
          ...((target.metadata?._vlmMerges ?? []) as any[]),
          {
            extractionId: p.extractionId,
            proposalId: input.proposalId,
            mergedAt: new Date().toISOString(),
            mergedFields: {
              description: p.description,
              metadata: p.metadata ?? {},
            },
          },
        ],
      };
      await db.collection('entities').doc(input.targetEntityId).update({
        metadata: mergedMetadata,
        updatedAt: new Date(),
      });

      await ref.update({
        status: 'merged',
        decidedBy: ctx.user.uid.toLowerCase(),
        decidedAt: new Date(),
        acceptedEntityId: input.targetEntityId,
      });

      return { entityId: input.targetEntityId };
    }),
});
