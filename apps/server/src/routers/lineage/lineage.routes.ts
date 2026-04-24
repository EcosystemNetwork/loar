/**
 * Lineage Router — PRD 10.
 *
 * Read-side of the asset lineage graph. The write-side lives in
 * `services/lineage/record.ts` and is called from generation, editing, and
 * publish handlers.
 *
 * Procedures
 *   getEvent            public  — one asset event by assetId
 *   ancestors           public  — linear chain from root → self
 *   descendants         public  — direct children of an asset
 *   tree                public  — full subtree under a root (bounded)
 *   byUniverse          public  — filtered feed of events for a universe
 *   creditSummary       protected — per-tool credit spend (universe owner)
 *   performanceSummary  protected — remix / edit-to-publish / style usage (owner)
 *   myHistory           protected — caller's own lineage feed
 */
import { router, publicProcedure, protectedProcedure } from '../../lib/trpc';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { db } from '../../lib/firebase';
import type { AssetEvent } from '../../services/lineage/types';
import { ASSET_EVENTS_COLLECTION } from '../../services/lineage';

const eventsCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection(ASSET_EVENTS_COLLECTION);
};

function toDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof (v as any)?.toDate === 'function') {
    try {
      return (v as any).toDate();
    } catch {
      return null;
    }
  }
  if (typeof v === 'string' || typeof v === 'number') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function serialize(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data };
  for (const key of ['createdAt']) {
    const date = toDate(out[key]);
    if (date) out[key] = date.toISOString();
  }
  return out;
}

type ViewerCtx = { user: { uid: string; address?: string | null } | null };

/**
 * Batch-checks which asset IDs are viewable by the caller. An asset is
 * viewable iff:
 *   - its `content` doc has contentStatus of 'active' or 'reinstated'
 *     (i.e. not hidden/removed/flagged/under_review), OR
 *   - the caller is the creator (so creators can still see their own
 *     moderated content in lineage).
 *
 * Assets with no backing `content` doc (pre-moderation-schema rows) are
 * treated as viewable — this preserves the legacy behaviour for data
 * created before the moderation field existed.
 *
 * Similarly screens out events belonging to private universes unless the
 * caller is the universe creator.
 *
 * Returns a Set of assetIds the caller may see.
 */
async function filterVisibleAssets(assetIds: string[], ctx: ViewerCtx): Promise<Set<string>> {
  if (assetIds.length === 0) return new Set();
  const unique = Array.from(new Set(assetIds));
  const contentRefs = unique.map((id) => db!.collection('content').doc(id));
  const snaps = await db!.getAll(...contentRefs);
  const viewerUid = ctx.user?.uid?.toLowerCase() ?? null;
  const visible = new Set<string>();
  const universeIdsToCheck = new Map<string, string[]>(); // universeId -> assetIds
  for (let i = 0; i < unique.length; i++) {
    const id = unique[i]!;
    const snap = snaps[i];
    if (!snap || !snap.exists) {
      // No content doc — legacy row, assume visible. Universe check still applies
      // at the event layer below.
      visible.add(id);
      continue;
    }
    const c = snap.data() ?? {};
    const status = (c.contentStatus as string | undefined) ?? 'active';
    const isOwner = viewerUid && c.creatorUid === viewerUid;
    if (isOwner || status === 'active' || status === 'reinstated') {
      visible.add(id);
    }
  }
  return visible;
}

/** Returns true iff the caller may see an event with this universeId. */
async function universeVisibleToViewer(
  universeId: string | null | undefined,
  cache: Map<string, boolean>,
  ctx: ViewerCtx
): Promise<boolean> {
  if (!universeId) return true;
  if (cache.has(universeId)) return cache.get(universeId)!;
  const doc = await db!.collection('cinematicUniverses').doc(universeId).get();
  if (!doc.exists) {
    cache.set(universeId, true);
    return true;
  }
  const data = doc.data() ?? {};
  const visibility = data.visibility as string | undefined;
  if (visibility !== 'private') {
    cache.set(universeId, true);
    return true;
  }
  const viewerUid = ctx.user?.uid?.toLowerCase() ?? null;
  const ok = !!viewerUid && data.creatorUid === viewerUid;
  cache.set(universeId, ok);
  return ok;
}

async function assertUniverseOwner(
  universeId: string,
  ctx: { user: { uid: string; address?: string | null } }
) {
  const universeDoc = await db!.collection('cinematicUniverses').doc(universeId).get();
  if (!universeDoc.exists) return; // new/testnet universe — no owner check possible
  const data = universeDoc.data() ?? {};
  const uidMatches = data.creatorUid === ctx.user.uid;
  const addrMatches =
    data.creator &&
    ctx.user.address &&
    data.creator.toLowerCase() === ctx.user.address.toLowerCase();
  if (!uidMatches && !addrMatches) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Only the universe creator can view this data',
    });
  }
}

function rangeFilter(range: 'day' | 'week' | 'month' | 'all'): Date | null {
  const now = Date.now();
  const MS = 24 * 60 * 60 * 1000;
  switch (range) {
    case 'day':
      return new Date(now - MS);
    case 'week':
      return new Date(now - 7 * MS);
    case 'month':
      return new Date(now - 30 * MS);
    default:
      return null;
  }
}

const rightsClassSchema = z.enum(['fan', 'original', 'licensed']);
const rangeSchema = z.enum(['day', 'week', 'month', 'all']).default('month');

export const lineageRouter = router({
  /** Fetch a single asset event by its assetId (generationId | jobId | contentId). */
  getEvent: publicProcedure
    .input(z.object({ assetId: z.string() }))
    .query(async ({ input, ctx }) => {
      const doc = await eventsCol().doc(input.assetId).get();
      if (!doc.exists) return null;
      const ev = doc.data() as AssetEvent;
      // Moderation gate: if the underlying content has been hidden/removed
      // via DMCA/abuse flow, lineage must not leak its prompt, IPFS URL, or
      // creator — legal surface. Creators still see their own moderated
      // content.
      const visible = await filterVisibleAssets([input.assetId], ctx);
      if (!visible.has(input.assetId)) return null;
      const uniCache = new Map<string, boolean>();
      if (!(await universeVisibleToViewer(ev.universeId, uniCache, ctx))) return null;
      return serialize({ ...ev, id: doc.id });
    }),

  /** Walk parentAssetId from self up to root. Bounded to 32 to avoid cycles. */
  ancestors: publicProcedure
    .input(z.object({ assetId: z.string() }))
    .query(async ({ input, ctx }) => {
      const chain: Record<string, unknown>[] = [];
      const assetIds: string[] = [];
      const events: AssetEvent[] = [];
      let current: string | null = input.assetId;
      const visited = new Set<string>();
      while (current && !visited.has(current) && chain.length < 32) {
        visited.add(current);
        const doc = await eventsCol().doc(current).get();
        if (!doc.exists) break;
        const data = doc.data() as AssetEvent;
        assetIds.push(doc.id);
        events.push(data);
        chain.push(serialize({ ...data, id: doc.id }));
        current = data.parentAssetId ?? null;
      }
      const visible = await filterVisibleAssets(assetIds, ctx);
      const uniCache = new Map<string, boolean>();
      const filtered: Record<string, unknown>[] = [];
      for (let i = 0; i < chain.length; i++) {
        const id = assetIds[i]!;
        if (!visible.has(id)) continue;
        if (!(await universeVisibleToViewer(events[i]!.universeId, uniCache, ctx))) continue;
        filtered.push(chain[i]!);
      }
      return filtered.reverse(); // root-first
    }),

  /** Direct children of an asset. */
  descendants: publicProcedure
    .input(
      z.object({
        assetId: z.string(),
        limit: z.number().min(1).max(200).default(50),
      })
    )
    .query(async ({ input, ctx }) => {
      const snap = await eventsCol()
        .where('parentAssetId', '==', input.assetId)
        .limit(input.limit)
        .get();
      const nodes = snap.docs.map((d) => ({
        id: d.id,
        ev: d.data() as AssetEvent,
      }));
      const visible = await filterVisibleAssets(
        nodes.map((n) => n.id),
        ctx
      );
      const uniCache = new Map<string, boolean>();
      const out: Record<string, unknown>[] = [];
      for (const n of nodes) {
        if (!visible.has(n.id)) continue;
        if (!(await universeVisibleToViewer(n.ev.universeId, uniCache, ctx))) continue;
        out.push(serialize({ ...n.ev, id: n.id }));
      }
      return out;
    }),

  /** Full subtree rooted at a node. Useful for a provenance UI. */
  tree: publicProcedure
    .input(
      z.object({
        rootAssetId: z.string(),
        limit: z.number().min(1).max(500).default(200),
      })
    )
    .query(async ({ input, ctx }) => {
      const snap = await eventsCol()
        .where('rootAssetId', '==', input.rootAssetId)
        .limit(input.limit)
        .get();
      const nodes = snap.docs.map((d) => ({ id: d.id, ev: d.data() as AssetEvent }));
      // Include the root itself even if it wasn't part of the query result
      if (!nodes.some((n) => n.id === input.rootAssetId)) {
        const rootDoc = await eventsCol().doc(input.rootAssetId).get();
        if (rootDoc.exists) {
          nodes.unshift({ id: rootDoc.id, ev: rootDoc.data() as AssetEvent });
        }
      }
      const visible = await filterVisibleAssets(
        nodes.map((n) => n.id),
        ctx
      );
      const uniCache = new Map<string, boolean>();
      const out: Record<string, unknown>[] = [];
      for (const n of nodes) {
        if (!visible.has(n.id)) continue;
        if (!(await universeVisibleToViewer(n.ev.universeId, uniCache, ctx))) continue;
        out.push(serialize({ ...n.ev, id: n.id }));
      }
      return out;
    }),

  /** Universe-scoped feed with filters (rights class, creator, kind, step). */
  byUniverse: publicProcedure
    .input(
      z.object({
        universeId: z.string().optional(),
        universeAddress: z.string().optional(),
        rightsClass: rightsClassSchema.optional(),
        creatorUid: z.string().optional(),
        kind: z.enum(['generate', 'edit', 'variation', 'animation', 'publish']).optional(),
        step: z.string().optional(),
        range: rangeSchema,
        limit: z.number().min(1).max(200).default(50),
      })
    )
    .query(async ({ input }) => {
      if (!input.universeId && !input.universeAddress) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'universeId or universeAddress is required',
        });
      }
      let query: FirebaseFirestore.Query = eventsCol();
      if (input.universeAddress) {
        query = query.where('universeAddress', '==', input.universeAddress.toLowerCase());
      } else if (input.universeId) {
        query = query.where('universeId', '==', input.universeId);
      }
      if (input.rightsClass) query = query.where('rightsClass', '==', input.rightsClass);
      if (input.creatorUid) query = query.where('creatorUid', '==', input.creatorUid);
      if (input.kind) query = query.where('kind', '==', input.kind);
      if (input.step) query = query.where('step', '==', input.step);

      const after = rangeFilter(input.range);
      if (after) query = query.where('createdAt', '>=', after);

      // NB: composite index (universe + createdAt) is required. If missing,
      // Firestore returns a clear error link — surface it via the query error.
      query = query.orderBy('createdAt', 'desc').limit(input.limit);

      const snap = await query.get();
      return snap.docs.map((d) => serialize({ ...(d.data() as AssetEvent), id: d.id }));
    }),

  /** Per-tool credit spend rollup. Owner-only. */
  creditSummary: protectedProcedure
    .input(
      z.object({
        universeId: z.string(),
        range: rangeSchema,
      })
    )
    .query(async ({ input, ctx }) => {
      await assertUniverseOwner(input.universeId, ctx);

      let query: FirebaseFirestore.Query = eventsCol().where('universeId', '==', input.universeId);
      const after = rangeFilter(input.range);
      if (after) query = query.where('createdAt', '>=', after);

      const snap = await query.get();
      const byTool = new Map<
        string,
        { tool: string; step: string; credits: number; count: number }
      >();
      let totalCredits = 0;
      let totalEvents = 0;

      for (const doc of snap.docs) {
        const ev = doc.data() as AssetEvent;
        const key = `${ev.tool}:${ev.step}`;
        const existing = byTool.get(key) ?? { tool: ev.tool, step: ev.step, credits: 0, count: 0 };
        existing.credits += ev.creditCost ?? 0;
        existing.count += 1;
        byTool.set(key, existing);
        totalCredits += ev.creditCost ?? 0;
        totalEvents += 1;
      }

      return {
        totalCredits,
        totalEvents,
        byTool: Array.from(byTool.values()).sort((a, b) => b.credits - a.credits),
      };
    }),

  /** Edit-to-publish, remix leaderboard, style pack usage. Owner-only. */
  performanceSummary: protectedProcedure
    .input(
      z.object({
        universeId: z.string(),
        range: rangeSchema,
      })
    )
    .query(async ({ input, ctx }) => {
      await assertUniverseOwner(input.universeId, ctx);

      let query: FirebaseFirestore.Query = eventsCol().where('universeId', '==', input.universeId);
      const after = rangeFilter(input.range);
      if (after) query = query.where('createdAt', '>=', after);

      const snap = await query.get();

      const remixCount = new Map<string, number>();
      const stylePack = new Map<string, { label: string; count: number }>();
      let edits = 0;
      let publishes = 0;
      let generations = 0;

      for (const doc of snap.docs) {
        const ev = doc.data() as AssetEvent;
        if (ev.kind === 'edit' || ev.kind === 'variation' || ev.kind === 'animation') edits += 1;
        if (ev.kind === 'publish') publishes += 1;
        if (ev.kind === 'generate') generations += 1;
        if (ev.rootAssetId && ev.rootAssetId !== ev.assetId) {
          remixCount.set(ev.rootAssetId, (remixCount.get(ev.rootAssetId) ?? 0) + 1);
        }
        for (const ref of ev.promptRefs ?? []) {
          if (ref.kind === 'style' || ref.kind === 'moodboard' || ref.kind === 'lora') {
            const key = ref.assetId || ref.url || ref.label || 'unnamed';
            const prev = stylePack.get(key) ?? { label: ref.label || key, count: 0 };
            prev.count += 1;
            stylePack.set(key, prev);
          }
        }
      }

      const topRemixed = Array.from(remixCount.entries())
        .map(([rootAssetId, descendants]) => ({ rootAssetId, descendants }))
        .sort((a, b) => b.descendants - a.descendants)
        .slice(0, 10);

      const topStylePacks = Array.from(stylePack.entries())
        .map(([key, v]) => ({ key, label: v.label, count: v.count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      const editToPublishRate = edits > 0 ? publishes / edits : 0;

      return {
        generations,
        edits,
        publishes,
        editToPublishRate,
        topRemixed,
        topStylePacks,
      };
    }),

  /** Caller's own history across all universes. */
  myHistory: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(25),
        kind: z.enum(['generate', 'edit', 'variation', 'animation', 'publish']).optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      let query: FirebaseFirestore.Query = eventsCol().where('creatorUid', '==', ctx.user.uid);
      if (input.kind) query = query.where('kind', '==', input.kind);
      query = query.orderBy('createdAt', 'desc').limit(input.limit);
      const snap = await query.get();
      return snap.docs.map((d) => serialize({ ...(d.data() as AssetEvent), id: d.id }));
    }),
});
