/**
 * Admin MCP Usage Router — observability for the MCP agent integration.
 *
 * Reads from the `apiKeyUsage` collection that the tRPC cost-scope middleware
 * populates on every API-key-authed request (see apps/server/src/lib/trpc.ts).
 * `apiKeyUsage` docs are tagged with `keyType` ("mcp_server" | "direct") and
 * `endUserAddress` (MCP relay passthrough) per PRD §1 / §3.
 *
 * Surfaces:
 *   - Top MCP keys by volume (last N hours)
 *   - Top end-user addresses by MCP-relayed spend
 *   - Rate-limit hits per key
 *   - Webhook failure rate (reads from BullMQ webhook queue metrics)
 *
 * All procedures require `adminProcedure` — wallet must be in ADMIN_ADDRESSES.
 */
import { z } from 'zod';
import { adminProcedure, router } from '../../lib/trpc';
import { db, firebaseAvailable } from '../../lib/firebase';

const apiKeyUsageCol = () => {
  if (!firebaseAvailable || !db) return null;
  return db.collection('apiKeyUsage');
};

const apiKeysCol = () => {
  if (!firebaseAvailable || !db) return null;
  return db.collection('apiKeys');
};

// ── Helpers ────────────────────────────────────────────────────────────

function parseWindow(windowHours: number) {
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);
  return since;
}

async function enrichKeyMetadata(
  keyIds: string[]
): Promise<
  Map<string, { name: string; keyPrefix: string; ownerUid: string; permissions: string[] }>
> {
  const col = apiKeysCol();
  if (!col || keyIds.length === 0) return new Map();
  // Firestore `in` supports up to 30 values — page through in chunks.
  const result = new Map<
    string,
    { name: string; keyPrefix: string; ownerUid: string; permissions: string[] }
  >();
  for (let i = 0; i < keyIds.length; i += 30) {
    const chunk = keyIds.slice(i, i + 30);
    const snap = await col.where('__name__', 'in', chunk).get();
    for (const doc of snap.docs) {
      const d = doc.data();
      result.set(doc.id, {
        name: (d.name as string) ?? '(unnamed)',
        keyPrefix: (d.keyPrefix as string) ?? '',
        ownerUid: (d.ownerUid as string) ?? '',
        permissions: (d.permissions as string[]) ?? [],
      });
    }
  }
  return result;
}

// ── Router ─────────────────────────────────────────────────────────────

export const adminMcpUsageRouter = router({
  /**
   * Top API keys by call volume in the selected window, split by keyType.
   * Defaults to last 24 hours, top 50.
   */
  topKeys: adminProcedure
    .input(
      z.object({
        windowHours: z
          .number()
          .min(1)
          .max(24 * 30)
          .default(24),
        keyType: z.enum(['mcp_server', 'direct', 'all']).default('mcp_server'),
        limit: z.number().min(1).max(200).default(50),
      })
    )
    .query(async ({ input }) => {
      const col = apiKeyUsageCol();
      if (!col) return { entries: [], windowHours: input.windowHours };

      const since = parseWindow(input.windowHours);
      let query: FirebaseFirestore.Query = col.where('timestamp', '>=', since);
      if (input.keyType !== 'all') {
        query = query.where('keyType', '==', input.keyType);
      }

      // Firestore can't do `GROUP BY + COUNT` — aggregate in memory.
      // For analytics-scale workloads this would run in BigQuery; at current
      // volumes the in-memory aggregate is well under a second.
      const snap = await query.limit(10000).get();
      const counts = new Map<
        string,
        { apiKeyId: string; calls: number; creditsUsed: number; uniqueEndUsers: Set<string> }
      >();

      for (const doc of snap.docs) {
        const d = doc.data();
        const keyId = d.apiKeyId as string;
        if (!keyId) continue;
        const entry = counts.get(keyId) ?? {
          apiKeyId: keyId,
          calls: 0,
          creditsUsed: 0,
          uniqueEndUsers: new Set<string>(),
        };
        entry.calls += 1;
        entry.creditsUsed += (d.creditsUsed as number) ?? 0;
        if (d.endUserAddress) entry.uniqueEndUsers.add(d.endUserAddress as string);
        counts.set(keyId, entry);
      }

      const sorted = [...counts.values()].sort((a, b) => b.calls - a.calls).slice(0, input.limit);

      // Enrich with key metadata (name, prefix, owner)
      const meta = await enrichKeyMetadata(sorted.map((e) => e.apiKeyId));

      return {
        windowHours: input.windowHours,
        keyType: input.keyType,
        entries: sorted.map((e) => ({
          apiKeyId: e.apiKeyId,
          name: meta.get(e.apiKeyId)?.name ?? '(deleted)',
          keyPrefix: meta.get(e.apiKeyId)?.keyPrefix ?? '',
          ownerUid: meta.get(e.apiKeyId)?.ownerUid ?? '',
          permissions: meta.get(e.apiKeyId)?.permissions ?? [],
          calls: e.calls,
          creditsUsed: e.creditsUsed,
          uniqueEndUsers: e.uniqueEndUsers.size,
        })),
      };
    }),

  /**
   * Top end-user wallet addresses by MCP-relayed spend. This only counts
   * calls where an MCP relay forwarded an X-Loar-End-User-Address — direct
   * keys are excluded.
   */
  topEndUsers: adminProcedure
    .input(
      z.object({
        windowHours: z
          .number()
          .min(1)
          .max(24 * 30)
          .default(24),
        limit: z.number().min(1).max(200).default(50),
      })
    )
    .query(async ({ input }) => {
      const col = apiKeyUsageCol();
      if (!col) return { entries: [], windowHours: input.windowHours };

      const since = parseWindow(input.windowHours);
      const snap = await col
        .where('keyType', '==', 'mcp_server')
        .where('timestamp', '>=', since)
        .limit(10000)
        .get();

      const counts = new Map<
        string,
        {
          address: string;
          calls: number;
          creditsUsed: number;
          uniqueKeys: Set<string>;
          endpoints: Set<string>;
        }
      >();

      for (const doc of snap.docs) {
        const d = doc.data();
        const addr = d.endUserAddress as string | undefined;
        if (!addr) continue;
        const entry = counts.get(addr) ?? {
          address: addr,
          calls: 0,
          creditsUsed: 0,
          uniqueKeys: new Set<string>(),
          endpoints: new Set<string>(),
        };
        entry.calls += 1;
        entry.creditsUsed += (d.creditsUsed as number) ?? 0;
        if (d.apiKeyId) entry.uniqueKeys.add(d.apiKeyId as string);
        if (d.endpoint) entry.endpoints.add(d.endpoint as string);
        counts.set(addr, entry);
      }

      const sorted = [...counts.values()].sort((a, b) => b.calls - a.calls).slice(0, input.limit);

      return {
        windowHours: input.windowHours,
        entries: sorted.map((e) => ({
          address: e.address,
          calls: e.calls,
          creditsUsed: e.creditsUsed,
          uniqueKeys: e.uniqueKeys.size,
          endpoints: e.endpoints.size,
        })),
      };
    }),

  /**
   * Recent MCP-relayed calls — paginated log view for drill-down after
   * finding an anomaly in topKeys / topEndUsers.
   */
  recentCalls: adminProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(500).default(100),
        apiKeyId: z.string().optional(),
        endUserAddress: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      const col = apiKeyUsageCol();
      if (!col) return { entries: [] };

      let query: FirebaseFirestore.Query = col.orderBy('timestamp', 'desc').limit(input.limit);
      if (input.apiKeyId) {
        query = col
          .where('apiKeyId', '==', input.apiKeyId)
          .orderBy('timestamp', 'desc')
          .limit(input.limit);
      } else if (input.endUserAddress) {
        query = col
          .where('endUserAddress', '==', input.endUserAddress.toLowerCase())
          .orderBy('timestamp', 'desc')
          .limit(input.limit);
      }

      const snap = await query.get();
      return {
        entries: snap.docs.map((doc) => {
          const d = doc.data();
          return {
            id: doc.id,
            apiKeyId: d.apiKeyId as string,
            endpoint: d.endpoint as string,
            creditsUsed: (d.creditsUsed as number) ?? 0,
            keyType: (d.keyType as 'mcp_server' | 'direct' | undefined) ?? 'direct',
            endUserAddress: (d.endUserAddress as string | undefined) ?? null,
            timestamp: d.timestamp,
          };
        }),
      };
    }),

  /**
   * Webhook delivery health — snapshot of the BullMQ webhook queue.
   * Returns null when webhooks are not configured (WEBHOOK_SIGNING_SECRET unset).
   */
  webhookHealth: adminProcedure.query(async () => {
    if (!process.env.WEBHOOK_SIGNING_SECRET) {
      return { enabled: false as const };
    }
    try {
      const { getWebhookQueue } = await import('../../lib/queue');
      const queue = getWebhookQueue();
      const [waiting, active, completed, failed, delayed] = await Promise.all([
        queue.getWaitingCount(),
        queue.getActiveCount(),
        queue.getCompletedCount(),
        queue.getFailedCount(),
        queue.getDelayedCount(),
      ]);
      return {
        enabled: true as const,
        waiting,
        active,
        completed,
        failed,
        delayed,
        healthy: failed === 0 || failed / Math.max(1, completed) < 0.05, // <5% failure rate
      };
    } catch (err) {
      return {
        enabled: true as const,
        error: err instanceof Error ? err.message : 'unknown',
        healthy: false as const,
      };
    }
  }),
});
