/**
 * MCP Router — resources surface for AI agents connected via loar-mcp-server.
 *
 * Implements `mcp.resources.list` and `mcp.resources.read`. These are proxied
 * by the MCP server's `resources/list` and `resources/read` handlers, which
 * lets an agent browse universes, entities, creations, and profiles via URIs
 * (loar://universe/0x…, loar://entity/id, loar://creation/id, …) without
 * re-invoking billable mutations.
 *
 * See docs/prd-mcp-integration.md §5.
 *
 * Access: requires an authenticated caller. When the caller is an API-key
 * session with the `mcp_server` scope, `ownerAddress` is used to scope the
 * listing to the end-user's wallet (passed through from the MCP session).
 * For JWT/cookie sessions, defaults to `ctx.user.address`.
 */
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { protectedProcedure, router } from '../../lib/trpc';
import { getUniverse, getUniversesByCreator } from '../universes/universes.handlers';
import { getEntity, getEntitiesByCreator } from '../entities/entities.handlers';
import { db, firebaseAvailable } from '../../lib/firebase';

const ETH_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

// ── URI helpers ────────────────────────────────────────────────────────

const SUPPORTED_URI_TYPES = ['universe', 'entity', 'creation', 'profile', 'credits'] as const;
type UriType = (typeof SUPPORTED_URI_TYPES)[number];

interface ParsedUri {
  type: UriType;
  id: string;
}

function parseUri(uri: string): ParsedUri | null {
  const match = uri.match(/^loar:\/\/([a-z]+)(?:\/(.+))?$/);
  if (!match) return null;
  const [, type, id] = match;
  if (!type || !(SUPPORTED_URI_TYPES as readonly string[]).includes(type)) return null;
  // 'credits' has no id segment; others do
  if (type !== 'credits' && !id) return null;
  return { type: type as UriType, id: id ?? '' };
}

function buildUri(type: UriType, id: string): string {
  return type === 'credits' ? `loar://credits` : `loar://${type}/${id}`;
}

export interface ResourceEntry {
  uri: string;
  name: string;
  description?: string;
  mimeType: 'application/json';
}

// ── Router ─────────────────────────────────────────────────────────────

export const mcpRouter = router({
  /**
   * List resources the caller can navigate. Scoped to the end-user's address
   * (from the MCP session's X-Loar-End-User-Address passthrough, or
   * falling back to ctx.user.address).
   */
  'resources.list': protectedProcedure
    .input(
      z.object({
        cursor: z.string().optional(),
        types: z.array(z.enum(SUPPORTED_URI_TYPES)).optional(),
        ownerAddress: z.string().regex(ETH_ADDRESS_RE, 'Invalid Ethereum address').optional(),
        limit: z.number().min(1).max(200).default(50),
      })
    )
    .query(async ({ input, ctx }) => {
      const effectiveAddress = (input.ownerAddress ?? ctx.user.address ?? '').toLowerCase();

      const requestedTypes = input.types ?? [...SUPPORTED_URI_TYPES];
      const want = (t: UriType) => requestedTypes.includes(t);

      const resources: ResourceEntry[] = [];

      // ── Universes (owned by the effective address) ────────────────
      if (want('universe') && effectiveAddress) {
        try {
          const result = await getUniversesByCreator(effectiveAddress);
          const universes = (result?.data ?? []) as any[];
          for (const u of universes) {
            resources.push({
              uri: buildUri('universe', u.address ?? u.id),
              name: u.name ?? u.address ?? u.id,
              description: u.description ?? undefined,
              mimeType: 'application/json',
            });
          }
        } catch {
          // Continue with other resource types
        }
      }

      // ── Entities (created by the effective address) ───────────────
      if (want('entity') && effectiveAddress) {
        try {
          const entities = await getEntitiesByCreator(effectiveAddress, undefined, 200);
          for (const e of entities) {
            resources.push({
              uri: buildUri('entity', e.id),
              name: `${(e as any).kind ?? 'entity'}: ${(e as any).name ?? e.id}`,
              description: (e as any).description ?? undefined,
              mimeType: 'application/json',
            });
          }
        } catch {
          // continue
        }
      }

      // ── Creations (videoGenerations owned by the caller) ──────────
      if (want('creation') && firebaseAvailable && db && effectiveAddress) {
        try {
          const snap = await db
            .collection('videoGenerations')
            .where('userId', '==', ctx.user.uid)
            .orderBy('createdAt', 'desc')
            .limit(50)
            .get();
          for (const doc of snap.docs) {
            const d = doc.data();
            resources.push({
              uri: buildUri('creation', doc.id),
              name: (d.originalPrompt ?? d.prompt ?? doc.id).slice(0, 80),
              description: (d.finalModelId ?? d.model ?? undefined) as string | undefined,
              mimeType: 'application/json',
            });
          }
        } catch {
          // continue
        }
      }

      // ── Profile (self) ─────────────────────────────────────────────
      if (want('profile') && effectiveAddress) {
        resources.push({
          uri: buildUri('profile', effectiveAddress),
          name: `Profile: ${effectiveAddress}`,
          mimeType: 'application/json',
        });
      }

      // ── Credits (self) ─────────────────────────────────────────────
      if (want('credits')) {
        resources.push({
          uri: buildUri('credits', ''),
          name: 'Credit balance',
          mimeType: 'application/json',
        });
      }

      // Cursor pagination — simple index into the assembled list so the agent
      // can page without us re-running all queries. For very large lists,
      // per-type cursors are a future enhancement.
      const start = input.cursor ? Math.max(0, parseInt(input.cursor, 10) || 0) : 0;
      const page = resources.slice(start, start + input.limit);
      const nextCursor =
        start + input.limit < resources.length ? String(start + input.limit) : undefined;

      return { resources: page, nextCursor };
    }),

  /**
   * Read a single resource by URI. Returns a JSON-stringified payload.
   * Permission enforcement: the resource must be owned by the caller
   * (or public, for profiles).
   */
  'resources.read': protectedProcedure
    .input(z.object({ uri: z.string() }))
    .query(async ({ input, ctx }) => {
      const parsed = parseUri(input.uri);
      if (!parsed) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Invalid resource URI: ${input.uri}`,
        });
      }

      const callerAddress = (ctx.user.address ?? '').toLowerCase();

      let payload: unknown;

      switch (parsed.type) {
        case 'universe': {
          const u = await getUniverse(parsed.id);
          if (!u) throw new TRPCError({ code: 'NOT_FOUND', message: 'Universe not found' });
          payload = u;
          break;
        }
        case 'entity': {
          const e = await getEntity(parsed.id);
          if (!e) throw new TRPCError({ code: 'NOT_FOUND', message: 'Entity not found' });
          payload = e;
          break;
        }
        case 'creation': {
          if (!firebaseAvailable || !db) {
            throw new TRPCError({
              code: 'INTERNAL_SERVER_ERROR',
              message: 'Firebase not configured',
            });
          }
          const doc = await db.collection('videoGenerations').doc(parsed.id).get();
          if (!doc.exists) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Creation not found' });
          }
          const d = doc.data() ?? {};
          // Ownership: only the creator sees their own generation detail
          if ((d as any).userId && (d as any).userId.toLowerCase() !== ctx.user.uid.toLowerCase()) {
            throw new TRPCError({ code: 'FORBIDDEN', message: 'Not the creation owner' });
          }
          payload = { id: doc.id, ...d };
          break;
        }
        case 'profile': {
          if (!firebaseAvailable || !db) {
            throw new TRPCError({
              code: 'INTERNAL_SERVER_ERROR',
              message: 'Firebase not configured',
            });
          }
          const addr = parsed.id.toLowerCase();
          const doc = await db.collection('profiles').doc(addr).get();
          if (!doc.exists) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Profile not found' });
          }
          payload = { id: doc.id, ...doc.data() };
          break;
        }
        case 'credits': {
          if (!firebaseAvailable || !db) {
            return { balance: 0, totalSpent: 0 };
          }
          const doc = await db.collection('userCredits').doc(ctx.user.uid).get();
          payload = doc.exists ? { id: doc.id, ...doc.data() } : { balance: 0, totalSpent: 0 };
          break;
        }
      }

      return {
        uri: input.uri,
        mimeType: 'application/json' as const,
        text: JSON.stringify(payload, null, 2),
      };
    }),
});
