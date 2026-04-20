/**
 * Indexer reads — serves Firestore-backed replacement for the Ponder GraphQL
 * surface. Mirrors the exact query shapes the frontend's `ponder-api.ts` uses
 * so the swap can happen at the call site without field mapping.
 *
 * Collections are the ones written by `apps/event-listener/src/handlers/*`
 * (prefix `indexer_`). Reads filter `_event.unconfirmed != true` by default so
 * optimistic UIs don't see blocks that may re-org.
 */
import { z } from 'zod';
import { publicProcedure, router } from '../../lib/trpc';
import { db } from '../../lib/firebase';

const COLLECTIONS = {
  universes: 'indexer_universes',
  tokens: 'indexer_tokens',
  nodes: 'indexer_nodes',
  nodeContents: 'indexer_nodeContents',
  tokenHolders: 'indexer_tokenHolders',
  swaps: 'indexer_swaps',
  pools: 'indexer_pools',
  bondingCurves: 'indexer_bondingCurves',
  bondingCurveTrades: 'indexer_bondingCurveTrades',
  bondingCurveSnapshots: 'indexer_bondingCurveSnapshots',
} as const;

const limitSchema = z.number().int().min(1).max(1000).default(40);
const addressSchema = z.string().regex(/^0x[a-f0-9]{40}$/i);
const hex32Schema = z.string().regex(/^0x[a-f0-9]{64}$/i);

function lc<T extends string | undefined>(s: T): T {
  return (s ? s.toLowerCase() : s) as T;
}

/**
 * Filter out unconfirmed docs unless explicitly included. Firestore has no
 * `!=` combined with other inequalities, so the read filters on the server
 * side after fetching the list.
 */
function stripUnconfirmed<T extends { _event?: { unconfirmed?: boolean } }>(
  rows: T[],
  includeUnconfirmed: boolean
): T[] {
  if (includeUnconfirmed) return rows;
  return rows.filter((r) => !r._event?.unconfirmed);
}

export const indexerRouter = router({
  /** List universes — default order by createdAt desc. */
  universes: publicProcedure
    .input(
      z
        .object({
          limit: limitSchema,
          includeUnconfirmed: z.boolean().default(false),
        })
        .default({ limit: 40, includeUnconfirmed: false })
    )
    .query(async ({ input }) => {
      const snap = await db
        .collection(COLLECTIONS.universes)
        .orderBy('createdAt', 'desc')
        .limit(input.limit * 2)
        .get();
      const items = snap.docs.map((d) => d.data());
      return {
        items: stripUnconfirmed(items as any[], input.includeUnconfirmed).slice(0, input.limit),
      };
    }),

  /** Single universe by id (address). */
  universe: publicProcedure.input(z.object({ id: addressSchema })).query(async ({ input }) => {
    const doc = await db.collection(COLLECTIONS.universes).doc(lc(input.id)).get();
    return doc.exists ? doc.data() : null;
  }),

  /** List tokens. Supports where.universeAddress filter for the universe-token lookup. */
  tokens: publicProcedure
    .input(
      z
        .object({
          limit: limitSchema,
          universeAddress: addressSchema.optional(),
          includeUnconfirmed: z.boolean().default(false),
        })
        .default({ limit: 40, includeUnconfirmed: false })
    )
    .query(async ({ input }) => {
      let q: FirebaseFirestore.Query = db
        .collection(COLLECTIONS.tokens)
        .orderBy('createdAt', 'desc');
      if (input.universeAddress) {
        q = db
          .collection(COLLECTIONS.tokens)
          .where('universeAddress', '==', lc(input.universeAddress));
      }
      const snap = await q.limit(input.limit * 2).get();
      const items = snap.docs.map((d) => d.data());
      return {
        items: stripUnconfirmed(items as any[], input.includeUnconfirmed).slice(0, input.limit),
      };
    }),

  /** Single token by address. */
  token: publicProcedure.input(z.object({ id: addressSchema })).query(async ({ input }) => {
    const doc = await db.collection(COLLECTIONS.tokens).doc(lc(input.id)).get();
    return doc.exists ? doc.data() : null;
  }),

  /** Nodes for a universe, ordered by createdAt desc. */
  nodes: publicProcedure
    .input(
      z
        .object({
          limit: limitSchema,
          universeAddress: addressSchema.optional(),
          includeUnconfirmed: z.boolean().default(false),
        })
        .default({ limit: 40, includeUnconfirmed: false })
    )
    .query(async ({ input }) => {
      let q: FirebaseFirestore.Query = db
        .collection(COLLECTIONS.nodes)
        .orderBy('createdAt', 'desc');
      if (input.universeAddress) {
        q = db
          .collection(COLLECTIONS.nodes)
          .where('universeAddress', '==', lc(input.universeAddress))
          .orderBy('createdAt', 'desc');
      }
      const snap = await q.limit(input.limit * 2).get();
      const items = snap.docs.map((d) => d.data());
      return {
        items: stripUnconfirmed(items as any[], input.includeUnconfirmed).slice(0, input.limit),
      };
    }),

  /** Paginated nodeContents for a universe. Matches `id_starts_with` pattern. */
  nodeContents: publicProcedure
    .input(
      z.object({
        universeAddress: addressSchema.optional(),
        limit: limitSchema,
        cursor: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      let q: FirebaseFirestore.Query;
      if (input.universeAddress) {
        // Doc ids are `${universeAddress}:${nodeId}` — use a range to match
        // prefix without a separate field.
        const prefix = `${lc(input.universeAddress)}:`;
        q = db
          .collection(COLLECTIONS.nodeContents)
          .orderBy('__name__')
          .startAt(prefix)
          .endAt(prefix + '\uffff');
      } else {
        q = db.collection(COLLECTIONS.nodeContents).orderBy('__name__');
      }
      if (input.cursor) q = q.startAfter(input.cursor);
      const snap = await q.limit(input.limit).get();
      const items = snap.docs.map((d) => d.data());
      const nextCursor =
        snap.docs.length === input.limit ? snap.docs[snap.docs.length - 1]!.id : null;
      return { items, nextCursor };
    }),

  /** Token holders — list for a token. */
  tokenHolders: publicProcedure
    .input(
      z
        .object({
          limit: limitSchema,
          tokenAddress: addressSchema.optional(),
          includeUnconfirmed: z.boolean().default(false),
        })
        .default({ limit: 40, includeUnconfirmed: false })
    )
    .query(async ({ input }) => {
      let q: FirebaseFirestore.Query = db.collection(COLLECTIONS.tokenHolders);
      if (input.tokenAddress) {
        q = q.where('tokenAddress', '==', lc(input.tokenAddress));
      }
      const snap = await q.limit(input.limit * 2).get();
      const items = snap.docs.map((d) => d.data());
      return {
        items: stripUnconfirmed(items as any[], input.includeUnconfirmed).slice(0, input.limit),
      };
    }),

  /** Swaps — filter by pool or sender. */
  swaps: publicProcedure
    .input(
      z
        .object({
          limit: limitSchema,
          poolId: hex32Schema.optional(),
          sender: addressSchema.optional(),
          includeUnconfirmed: z.boolean().default(false),
        })
        .default({ limit: 40, includeUnconfirmed: false })
    )
    .query(async ({ input }) => {
      let q: FirebaseFirestore.Query = db
        .collection(COLLECTIONS.swaps)
        .orderBy('blockNumber', 'desc');
      if (input.poolId) {
        q = db
          .collection(COLLECTIONS.swaps)
          .where('poolId', '==', input.poolId.toLowerCase())
          .orderBy('blockNumber', 'desc');
      } else if (input.sender) {
        q = db
          .collection(COLLECTIONS.swaps)
          .where('sender', '==', lc(input.sender))
          .orderBy('blockNumber', 'desc');
      }
      const snap = await q.limit(input.limit * 2).get();
      const items = snap.docs.map((d) => d.data());
      return {
        items: stripUnconfirmed(items as any[], input.includeUnconfirmed).slice(0, input.limit),
      };
    }),

  /** Single pool by poolId (hex32). */
  pool: publicProcedure.input(z.object({ poolId: hex32Schema })).query(async ({ input }) => {
    const doc = await db.collection(COLLECTIONS.pools).doc(input.poolId.toLowerCase()).get();
    return doc.exists ? doc.data() : null;
  }),

  /** All pools — paginated. */
  pools: publicProcedure
    .input(z.object({ limit: limitSchema }).default({ limit: 40 }))
    .query(async ({ input }) => {
      const snap = await db.collection(COLLECTIONS.pools).limit(input.limit).get();
      return { items: snap.docs.map((d) => d.data()) };
    }),

  /** Single bonding curve by address. */
  bondingCurve: publicProcedure.input(z.object({ id: addressSchema })).query(async ({ input }) => {
    const doc = await db.collection(COLLECTIONS.bondingCurves).doc(lc(input.id)).get();
    return doc.exists ? doc.data() : null;
  }),

  /** Bonding curve snapshots for chart data. */
  bondingCurveSnapshots: publicProcedure
    .input(
      z.object({
        bondingCurve: addressSchema,
        limit: limitSchema,
      })
    )
    .query(async ({ input }) => {
      const snap = await db
        .collection(COLLECTIONS.bondingCurveSnapshots)
        .where('bondingCurve', '==', lc(input.bondingCurve))
        .orderBy('blockNumber', 'asc')
        .limit(input.limit)
        .get();
      return { items: snap.docs.map((d) => d.data()) };
    }),

  /** Indexer health — last indexed block per chain. */
  health: publicProcedure.query(async () => {
    const snap = await db.collection('indexer_checkpoints').get();
    return {
      checkpoints: snap.docs.map((d) => d.data()),
    };
  }),
});
