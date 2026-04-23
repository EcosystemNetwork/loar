/**
 * Firestore handlers for curation (endorsements + leaderboard).
 *
 * Collection: `endorsements/{id}` where `id = "${curator}:${targetType}:${targetId}"`.
 * The deterministic doc id gives us a natural "one endorsement per curator per
 * target" constraint without needing a compound index.
 */
import { db } from '../../lib/firebase';
import type { Endorsement, CurationTargetType, LeaderboardEntry } from './curation.types';

function endorsementsCol() {
  return db.collection('endorsements');
}

function endorsementId(curator: string, targetType: CurationTargetType, targetId: string) {
  return `${curator.toLowerCase()}:${targetType}:${targetId}`;
}

export async function upsertEndorsement(input: {
  curator: string;
  targetType: CurationTargetType;
  targetId: string;
  weight: number;
  note?: string;
  universeAddress?: string | null;
}): Promise<Endorsement> {
  const id = endorsementId(input.curator, input.targetType, input.targetId);
  const ref = endorsementsCol().doc(id);
  const now = new Date();
  const existing = await ref.get();
  const doc: Endorsement = existing.exists
    ? {
        ...(existing.data() as Endorsement),
        weight: input.weight,
        note: input.note ?? (existing.data() as Endorsement).note ?? '',
        universeAddress:
          input.universeAddress !== undefined
            ? input.universeAddress
              ? input.universeAddress.toLowerCase()
              : null
            : (existing.data() as Endorsement).universeAddress,
        updatedAt: now,
      }
    : {
        id,
        curator: input.curator.toLowerCase(),
        targetType: input.targetType,
        targetId: input.targetId,
        weight: input.weight,
        note: input.note ?? '',
        universeAddress: input.universeAddress ? input.universeAddress.toLowerCase() : null,
        createdAt: now,
        updatedAt: now,
      };
  await ref.set(doc);
  return doc;
}

export async function revokeEndorsement(
  endorsementIdOrTarget:
    | { id: string }
    | { curator: string; targetType: CurationTargetType; targetId: string },
  caller: string
): Promise<void> {
  const id =
    'id' in endorsementIdOrTarget
      ? endorsementIdOrTarget.id
      : endorsementId(
          endorsementIdOrTarget.curator,
          endorsementIdOrTarget.targetType,
          endorsementIdOrTarget.targetId
        );
  const ref = endorsementsCol().doc(id);
  const doc = await ref.get();
  if (!doc.exists) throw new Error('Endorsement not found');
  const data = doc.data() as Endorsement;
  if (data.curator.toLowerCase() !== caller.toLowerCase()) {
    throw new Error('Forbidden: only the endorser can revoke');
  }
  await ref.delete();
}

export async function getScoreFor(
  targetType: CurationTargetType,
  targetId: string
): Promise<{ score: number; endorsers: number; lastEndorsedAt: Date | null }> {
  const snap = await endorsementsCol()
    .where('targetType', '==', targetType)
    .where('targetId', '==', targetId)
    .get();
  let score = 0;
  let lastEndorsedAt: Date | null = null;
  for (const doc of snap.docs) {
    const d = doc.data() as Endorsement;
    score += d.weight;
    // Firestore may hydrate Date as Timestamp — coerce.
    const ts = (d.updatedAt as any)?.toDate?.() ?? d.updatedAt;
    if (!lastEndorsedAt || ts > lastEndorsedAt) lastEndorsedAt = ts;
  }
  return { score, endorsers: snap.size, lastEndorsedAt };
}

export async function getMyEndorsements(curator: string, limit = 100): Promise<Endorsement[]> {
  const snap = await endorsementsCol()
    .where('curator', '==', curator.toLowerCase())
    .orderBy('updatedAt', 'desc')
    .limit(limit)
    .get();
  return snap.docs.map((d) => d.data() as Endorsement);
}

export async function getMyEndorsementFor(
  curator: string,
  targetType: CurationTargetType,
  targetId: string
): Promise<Endorsement | null> {
  const id = endorsementId(curator, targetType, targetId);
  const doc = await endorsementsCol().doc(id).get();
  if (!doc.exists) return null;
  return doc.data() as Endorsement;
}

/**
 * Leaderboard — aggregate weights per target, sorted desc.
 *
 * Firestore has no server-side GROUP BY, so we pull endorsements that match
 * the filter (bounded) and aggregate in-memory. Fine for v1 — sizes are
 * small. A future pass can materialize into a `curationScores/{targetKey}`
 * doc that's updated atomically in `upsertEndorsement`.
 */
export async function getLeaderboard(opts: {
  targetType?: CurationTargetType;
  universeAddress?: string | null;
  limit?: number;
}): Promise<LeaderboardEntry[]> {
  const { targetType, universeAddress, limit = 25 } = opts;
  let query: FirebaseFirestore.Query = endorsementsCol();
  if (targetType) query = query.where('targetType', '==', targetType);
  if (universeAddress !== undefined) {
    query = query.where(
      'universeAddress',
      '==',
      universeAddress ? universeAddress.toLowerCase() : null
    );
  }
  // Bound: enough endorsements to build a meaningful top-N leaderboard.
  const snap = await query.limit(1000).get();

  const agg = new Map<string, LeaderboardEntry>();
  for (const doc of snap.docs) {
    const e = doc.data() as Endorsement;
    const key = `${e.targetType}:${e.targetId}`;
    const ts = (e.updatedAt as any)?.toDate?.() ?? e.updatedAt;
    const existing = agg.get(key);
    if (existing) {
      existing.score += e.weight;
      existing.endorsers += 1;
      if (ts > existing.lastEndorsedAt) existing.lastEndorsedAt = ts;
    } else {
      agg.set(key, {
        targetType: e.targetType,
        targetId: e.targetId,
        score: e.weight,
        endorsers: 1,
        lastEndorsedAt: ts,
      });
    }
  }

  return [...agg.values()]
    .sort((a, b) => b.score - a.score || b.endorsers - a.endorsers)
    .slice(0, limit);
}
