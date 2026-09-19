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
import { FieldValue } from 'firebase-admin/firestore';
import { normalizeUniverseId } from '../../lib/universe-id';

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
  // Optional so a story beat can exist before media is generated for it
  // (e.g. the voice director creating a plot point ahead of `generate_scene`).
  // buildOffChainGraphData already falls back to '' safely for rendering.
  videoUrl: z.string().url().optional().default(''),
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
  // The counter can lag the real maximum (scripts that write nodes directly,
  // or a counter keyed by a pre-normalisation id) — trusting it alone hands
  // out a duplicate nodeId, which collapses two nodes into one on the canvas.
  // Read the highest existing id *outside* the transaction: a range query
  // inside it makes concurrent creates contend and time out, and the counter
  // itself already serialises concurrent writers.
  const top = await nodesCol()
    .where('universeId', '==', universeId)
    .orderBy('nodeId', 'desc')
    .limit(1)
    .get();
  const highest = top.empty ? 0 : (top.docs[0].data().nodeId as number) || 0;
  return db!.runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    const counter = doc.exists ? (doc.data()?.latest as number) || 0 : 0;
    const next = Math.max(counter, highest) + 1;
    tx.set(ref, { latest: next, updatedAt: new Date() }, { merge: true });
    return next;
  });
}

/** Look up a node doc by (universeId, nodeId); `null` when it doesn't exist. */
async function findNode(universeId: string, nodeId: number) {
  const snap = await nodesCol()
    .where('universeId', '==', universeId)
    .where('nodeId', '==', nodeId)
    .limit(1)
    .get();
  return snap.empty ? null : snap.docs[0];
}

// arrayUnion / arrayRemove are applied server-side, so concurrent sibling
// creates or deletes can't lose each other's writes the way a
// read-modify-write of the whole `children` array would.
async function appendChild(universeId: string, parentId: number, childId: number) {
  const parent = await findNode(universeId, parentId);
  if (!parent) return;
  await parent.ref.update({
    children: FieldValue.arrayUnion(childId),
    updatedAt: new Date(),
  });
}

async function removeChild(universeId: string, parentId: number, childId: number) {
  const parent = await findNode(universeId, parentId);
  if (!parent) return;
  await parent.ref.update({
    children: FieldValue.arrayRemove(childId),
    updatedAt: new Date(),
  });
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
    // EVM ids are stored lowercased (readers query that form); Solana PDAs verbatim.
    const universeId = normalizeUniverseId(input.universeId);
    // Reject a dangling parent *before* the counter burns an id.
    if (input.previousNodeId > 0 && !(await findNode(universeId, input.previousNodeId))) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: `Parent node ${input.previousNodeId} not found`,
      });
    }
    const contentHash = input.contentHash || keccak256(toBytes(input.videoUrl));
    const plotHash = input.plotHash || keccak256(toBytes(input.plot));
    const nodeId = await nextSequentialId(universeId);

    const doc = {
      id: randomUUID(),
      universeId,
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
      await appendChild(universeId, input.previousNodeId, nodeId);
    }

    return doc;
  }),

  /** List all off-chain nodes for a universe. */
  list: publicProcedure.input(z.object({ universeId: z.string() })).query(async ({ input }) => {
    const snap = await nodesCol()
      .where('universeId', '==', normalizeUniverseId(input.universeId))
      .orderBy('nodeId', 'asc')
      .get();
    const nodes = snap.docs.map((d) => d.data());
    return { nodes, total: nodes.length };
  }),

  /** Get a single off-chain node. */
  get: publicProcedure
    .input(z.object({ universeId: z.string(), nodeId: z.number().int() }))
    .query(async ({ input }) => {
      const doc = await findNode(normalizeUniverseId(input.universeId), input.nodeId);
      return doc ? doc.data() : null;
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
      const doc = await findNode(normalizeUniverseId(input.universeId), input.nodeId);
      if (!doc)
        throw new TRPCError({ code: 'NOT_FOUND', message: `Node ${input.nodeId} not found` });

      const data = doc.data();
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

      await doc.ref.update(updates);
      return { ...data, ...updates };
    }),

  /** Delete a node (and unlink from parent's children array). */
  delete: protectedProcedure
    .input(z.object({ universeId: z.string(), nodeId: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const universeId = normalizeUniverseId(input.universeId);
      const doc = await findNode(universeId, input.nodeId);
      if (!doc) return { deleted: false };

      const data = doc.data();
      const caller = (ctx.user?.address || ctx.user?.uid || '').toLowerCase();
      if (!caller || (data.creator || '').toLowerCase() !== caller) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the node creator can delete it',
        });
      }
      const previousId = data.previousNodeId as number;

      await doc.ref.delete();

      // Unlink from parent
      if (previousId > 0) await removeChild(universeId, previousId, input.nodeId);

      return { deleted: true };
    }),
});
