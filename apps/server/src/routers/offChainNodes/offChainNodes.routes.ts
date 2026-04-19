/**
 * Off-Chain Timeline Nodes Router
 *
 * Firestore-backed timeline nodes for "fun-mode" universes that don't have
 * an on-chain Universe contract (e.g. fan IP, drafts, learning playgrounds).
 *
 * Schema mirrors the on-chain `Universe.createNode` interface so the same
 * frontend timeline canvas can render either source.
 *
 * Collection: `offChainNodes`
 *   doc shape:
 *     id: string (uuid)
 *     universeId: string (off-chain universe address — anything, not necessarily 0x...)
 *     nodeId: number (1-indexed sequential within universe)
 *     creator: string (address or uid)
 *     contentHash: string (keccak256 of media url)
 *     plotHash: string (keccak256 of plot text)
 *     videoUrl: string
 *     plot: string (full description)
 *     previousNodeId: number (0 if root)
 *     children: number[] (sequential ids of child nodes)
 *     canon: boolean
 *     createdAt: Date
 *     updatedAt: Date
 */
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { protectedProcedure, publicProcedure, router } from '../../lib/trpc';
import { db } from '../../lib/firebase';
import { randomUUID } from 'crypto';
import { keccak256, toBytes } from 'viem';

const nodesCol = () => {
  if (!db) throw new Error('Firebase not configured');
  return db.collection('offChainNodes');
};

const counterCol = () => {
  if (!db) throw new Error('Firebase not configured');
  return db.collection('offChainNodeCounters');
};

// ── Schemas ─────────────────────────────────────────────────────────────

const createNodeInput = z.object({
  universeId: z.string().min(1),
  videoUrl: z.string().url(),
  plot: z.string().max(20000).default(''),
  previousNodeId: z.number().int().min(0).default(0),
  /** Optional content hash override; defaults to keccak256(videoUrl) */
  contentHash: z.string().optional(),
  /** Optional plot hash override; defaults to keccak256(plot) */
  plotHash: z.string().optional(),
  /** Optional title for display */
  title: z.string().max(300).optional(),
  /** Optional sceneId for ordering when batch-creating */
  sceneId: z.number().int().optional(),
});

// ── Helpers ─────────────────────────────────────────────────────────────

async function nextSequentialId(universeId: string): Promise<number> {
  const ref = counterCol().doc(universeId);
  return db!.runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    const current = doc.exists ? (doc.data()?.latest as number) || 0 : 0;
    const next = current + 1;
    tx.set(ref, { latest: next, updatedAt: new Date() }, { merge: true });
    return next;
  });
}

async function appendChild(universeId: string, parentId: number, childId: number) {
  const snap = await nodesCol()
    .where('universeId', '==', universeId)
    .where('nodeId', '==', parentId)
    .limit(1)
    .get();
  if (snap.empty) return;
  const doc = snap.docs[0];
  const children = (doc.data().children || []) as number[];
  if (!children.includes(childId)) {
    await doc.ref.update({ children: [...children, childId], updatedAt: new Date() });
  }
}

// ── Router ──────────────────────────────────────────────────────────────

export const offChainNodesRouter = router({
  /** Create a new off-chain timeline node. */
  create: protectedProcedure.input(createNodeInput).mutation(async ({ ctx, input }) => {
    // Always derive creator from authenticated principal — never trust client input.
    const creator = (ctx.user?.address || ctx.user?.uid || '').toLowerCase();
    if (!creator) {
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: 'Wallet address or uid required to create node',
      });
    }
    const contentHash = input.contentHash || keccak256(toBytes(input.videoUrl));
    const plotHash = input.plotHash || keccak256(toBytes(input.plot));
    const nodeId = await nextSequentialId(input.universeId);

    const doc = {
      id: randomUUID(),
      universeId: input.universeId,
      nodeId,
      creator,
      contentHash,
      plotHash,
      videoUrl: input.videoUrl,
      plot: input.plot,
      title: input.title || '',
      sceneId: input.sceneId ?? null,
      previousNodeId: input.previousNodeId,
      children: [] as number[],
      canon: input.previousNodeId === 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await nodesCol().doc(doc.id).set(doc);

    if (input.previousNodeId > 0) {
      await appendChild(input.universeId, input.previousNodeId, nodeId);
    }

    return doc;
  }),

  /** List all off-chain nodes for a universe. */
  list: publicProcedure.input(z.object({ universeId: z.string() })).query(async ({ input }) => {
    const snap = await nodesCol()
      .where('universeId', '==', input.universeId)
      .orderBy('nodeId', 'asc')
      .get();
    const nodes = snap.docs.map((d) => d.data());
    return { nodes, total: nodes.length };
  }),

  /** Get a single off-chain node. */
  get: publicProcedure
    .input(z.object({ universeId: z.string(), nodeId: z.number().int() }))
    .query(async ({ input }) => {
      const snap = await nodesCol()
        .where('universeId', '==', input.universeId)
        .where('nodeId', '==', input.nodeId)
        .limit(1)
        .get();
      if (snap.empty) return null;
      return snap.docs[0].data();
    }),

  /** Update an existing node (canon flag, plot text, etc.). */
  update: protectedProcedure
    .input(
      z.object({
        universeId: z.string(),
        nodeId: z.number().int(),
        title: z.string().max(300).optional(),
        plot: z.string().max(20000).optional(),
        canon: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const snap = await nodesCol()
        .where('universeId', '==', input.universeId)
        .where('nodeId', '==', input.nodeId)
        .limit(1)
        .get();
      if (snap.empty) throw new Error(`Node ${input.nodeId} not found`);

      const data = snap.docs[0].data();
      const caller = (ctx.user?.address || ctx.user?.uid || '').toLowerCase();
      if (!caller || (data.creator || '').toLowerCase() !== caller) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the node creator can update it',
        });
      }

      const updates: Record<string, any> = { updatedAt: new Date() };
      if (input.title !== undefined) updates.title = input.title;
      if (input.plot !== undefined) {
        updates.plot = input.plot;
        updates.plotHash = keccak256(toBytes(input.plot));
      }
      if (input.canon !== undefined) updates.canon = input.canon;

      await snap.docs[0].ref.update(updates);
      return { ...data, ...updates };
    }),

  /** Delete a node (and unlink from parent's children array). */
  delete: protectedProcedure
    .input(z.object({ universeId: z.string(), nodeId: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const snap = await nodesCol()
        .where('universeId', '==', input.universeId)
        .where('nodeId', '==', input.nodeId)
        .limit(1)
        .get();
      if (snap.empty) return { deleted: false };

      const data = snap.docs[0].data();
      const caller = (ctx.user?.address || ctx.user?.uid || '').toLowerCase();
      if (!caller || (data.creator || '').toLowerCase() !== caller) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the node creator can delete it',
        });
      }
      const previousId = data.previousNodeId as number;

      await snap.docs[0].ref.delete();

      // Unlink from parent
      if (previousId > 0) {
        const parentSnap = await nodesCol()
          .where('universeId', '==', input.universeId)
          .where('nodeId', '==', previousId)
          .limit(1)
          .get();
        if (!parentSnap.empty) {
          const parentChildren = (parentSnap.docs[0].data().children || []) as number[];
          await parentSnap.docs[0].ref.update({
            children: parentChildren.filter((id) => id !== input.nodeId),
            updatedAt: new Date(),
          });
        }
      }

      return { deleted: true };
    }),
});
