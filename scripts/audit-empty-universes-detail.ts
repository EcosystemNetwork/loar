/**
 * Detail pass for empty / partial universes — surfaces metadata that informs
 * the generate-vs-remove decision. Read-only.
 *
 * For each non-healthy universe (no episodes OR no video nodes), reports:
 *   - description, creator, createdAt, mode flags (private/hidden), token
 *   - entities count by kind  (worldbuilding signal — characters/places/etc)
 *   - has script / scriptToEpisodeJobs in flight
 *   - on-chain token + image presence  (signals real launch effort)
 */
import dotenv from 'dotenv';
import path from 'path';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

async function main() {
  const existing = getApps()[0];
  let db;
  if (existing) {
    db = getFirestore(existing);
  } else {
    const sa = JSON.parse(readFileSync('firebase-sa-key-20260416.json', 'utf-8'));
    const app = initializeApp({ credential: cert(sa) });
    db = getFirestore(app);
    db.settings({ preferRest: true });
  }

  const unisSnap = await db.collection('cinematicUniverses').get();
  const universes = unisSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));

  type Row = {
    docId: string;
    addr: string;
    name: string;
    description: string;
    creator: string;
    createdAt: string;
    isHidden: boolean;
    isPrivate: boolean;
    hasImage: boolean;
    tokenAddress: string;
    episodes: number;
    contentVideos: number;
    offChainVideos: number;
    indexerNodes: number;
    entities: number;
    entitiesByKind: Record<string, number>;
    scriptJobs: number;
  };

  const rows: Row[] = [];

  for (const u of universes) {
    const addr = (u.address || u.id || '').toLowerCase();
    if (!addr) continue;

    const [epSnap, contentSnap, offSnap, idxSnap, entSnap, jobsSnap] = await Promise.all([
      db.collection('episodes').where('universeId', '==', addr).get(),
      db.collection('content').where('universeId', '==', addr).get(),
      db
        .collection('offChainNodes')
        .where('universeId', '==', addr)
        .get()
        .catch(() => null),
      db
        .collection('indexer_nodes')
        .where('universeId', '==', addr)
        .get()
        .catch(() => null),
      db
        .collection('entities')
        .where('universeAddress', '==', addr)
        .get()
        .catch(() => null),
      db
        .collection('scriptToEpisodeJobs')
        .where('universeId', '==', addr)
        .get()
        .catch(() => null),
    ]);

    const contentVideos = contentSnap.docs
      .map((d) => d.data() as any)
      .filter((c) => {
        const status = c.contentStatus || 'active';
        if (status !== 'active' && status !== 'reinstated') return false;
        return c.mediaType === 'video' || c.mediaType === 'ai-video';
      }).length;

    const offChainVideos = offSnap
      ? offSnap.docs.map((d) => d.data() as any).filter((n) => !!(n.videoUrl || n.videoLink)).length
      : 0;

    const entitiesByKind: Record<string, number> = {};
    if (entSnap) {
      for (const d of entSnap.docs) {
        const k = (d.data() as any).kind || 'unknown';
        entitiesByKind[k] = (entitiesByKind[k] ?? 0) + 1;
      }
    }

    const ts =
      typeof u.createdAt === 'string'
        ? u.createdAt
        : (u.createdAt?.toDate?.()?.toISOString?.() ?? '');

    rows.push({
      docId: u.id,
      addr,
      name: u.name || '(unnamed)',
      description: (u.description || '').replace(/\s+/g, ' ').slice(0, 120),
      creator: (u.creator || '').toLowerCase(),
      createdAt: ts,
      isHidden: !!u.isHidden,
      isPrivate: !!u.isPrivate,
      hasImage: !!(u.image_url || u.imageURL || u.portrait_image_url),
      tokenAddress: (u.tokenAddress || '').toLowerCase(),
      episodes: epSnap.size,
      contentVideos,
      offChainVideos,
      indexerNodes: idxSnap?.size ?? 0,
      entities: entSnap?.size ?? 0,
      entitiesByKind,
      scriptJobs: jobsSnap?.size ?? 0,
    });
  }

  const isHealthy = (r: Row) =>
    r.episodes > 0 && (r.contentVideos > 0 || r.offChainVideos > 0 || r.indexerNodes > 0);

  const interesting = rows.filter((r) => !isHealthy(r));

  // Sort: visible first, then by entities desc (worldbuilding signal), then createdAt desc
  interesting.sort((a, b) => {
    if (a.isHidden !== b.isHidden) return a.isHidden ? 1 : -1;
    if (a.entities !== b.entities) return b.entities - a.entities;
    return (b.createdAt || '').localeCompare(a.createdAt || '');
  });

  const ZERO = '0x0000000000000000000000000000000000000000';

  for (const r of interesting) {
    const tags = [
      r.isHidden ? 'HIDDEN' : 'VISIBLE',
      r.isPrivate ? 'PRIVATE' : '',
      r.hasImage ? 'IMG' : '',
      r.tokenAddress && r.tokenAddress !== ZERO ? `TOKEN:${r.tokenAddress.slice(0, 10)}…` : '',
    ]
      .filter(Boolean)
      .join(' ');

    const kinds =
      Object.entries(r.entitiesByKind)
        .sort((a, b) => b[1] - a[1])
        .map(([k, n]) => `${k}=${n}`)
        .join(' ') || '—';

    console.log(
      `\n${r.name}  [${tags}]\n` +
        `  doc:        ${r.docId}\n` +
        `  addr:       ${r.addr}\n` +
        `  creator:    ${r.creator || '—'}\n` +
        `  createdAt:  ${r.createdAt || '—'}\n` +
        `  desc:       ${r.description || '—'}\n` +
        `  content:    ep=${r.episodes} contentVid=${r.contentVideos} offChainVid=${r.offChainVideos} idxNodes=${r.indexerNodes}\n` +
        `  entities:   total=${r.entities}  ${kinds}\n` +
        `  scriptJobs: ${r.scriptJobs}`
    );
  }

  // Compact summary by group
  const ZA = (r: Row) => r.addr === ZERO || r.addr.startsWith('0x000000000');
  console.log('\n──────────── COUNTS ────────────');
  console.log(`Visible non-healthy:     ${interesting.filter((r) => !r.isHidden).length}`);
  console.log(`Hidden non-healthy:      ${interesting.filter((r) => r.isHidden).length}`);
  console.log(`Zero-addr (placeholder): ${interesting.filter(ZA).length}`);
  console.log(`Has worldbuilding:       ${interesting.filter((r) => r.entities > 0).length}`);
  console.log(
    `Has token:               ${interesting.filter((r) => r.tokenAddress && r.tokenAddress !== ZERO).length}`
  );
  console.log(`Has script jobs:         ${interesting.filter((r) => r.scriptJobs > 0).length}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
