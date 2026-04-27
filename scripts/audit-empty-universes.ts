/**
 * Audit universes for episodes + video node content.
 *
 * Read-only. Lists universes that have neither episodes nor any video-bearing
 * node so the operator can decide whether to remove or backfill them.
 *
 * Counts per universe:
 *   - episodes:        episodes/{*} where universeId == addr
 *   - episodesCanon:   episodes/{*} where universeId == addr && isCanon == true
 *   - contentVideos:   content/{*} where universeId == addr && mediaType in {video, ai-video}
 *   - offChainVideos:  offChainNodes/{*} where universeId == addr && (videoUrl || videoLink)
 *   - indexerNodes:    indexer_nodes/{*} where universeId == addr  (on-chain video nodes)
 */
import dotenv from 'dotenv';
import path from 'path';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

type UniRow = {
  id: string;
  addr: string;
  name: string;
  creator: string;
  isHidden: boolean;
  isPrivate: boolean;
  episodes: number;
  episodesCanon: number;
  contentVideos: number;
  offChainVideos: number;
  indexerNodes: number;
};

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
  console.log(`\nUniverses total: ${universes.length}`);

  const rows: UniRow[] = [];

  for (const u of universes) {
    const addr = (u.address || u.id || '').toLowerCase();
    if (!addr) continue;

    const [epSnap, contentSnap, offChainSnap, idxSnap] = await Promise.all([
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
    ]);

    const episodes = epSnap.docs.map((d) => d.data() as any);
    const episodesCanon = episodes.filter((e) => e.isCanon === true).length;

    const contentVideos = contentSnap.docs
      .map((d) => d.data() as any)
      .filter((c) => {
        const status = c.contentStatus || 'active';
        if (status !== 'active' && status !== 'reinstated') return false;
        return c.mediaType === 'video' || c.mediaType === 'ai-video';
      }).length;

    const offChainVideos = offChainSnap
      ? offChainSnap.docs.map((d) => d.data() as any).filter((n) => !!(n.videoUrl || n.videoLink))
          .length
      : 0;

    const indexerNodes = idxSnap ? idxSnap.size : 0;

    rows.push({
      id: u.id,
      addr,
      name: u.name || '(unnamed)',
      creator: u.creator || '',
      isHidden: !!u.isHidden,
      isPrivate: !!u.isPrivate,
      episodes: episodes.length,
      episodesCanon,
      contentVideos,
      offChainVideos,
      indexerNodes,
    });
  }

  const empty = rows.filter(
    (r) =>
      r.episodes === 0 && r.contentVideos === 0 && r.offChainVideos === 0 && r.indexerNodes === 0
  );
  const hasEpisodesOnly = rows.filter(
    (r) => r.episodes > 0 && r.contentVideos === 0 && r.offChainVideos === 0 && r.indexerNodes === 0
  );
  const hasVideosOnly = rows.filter(
    (r) => r.episodes === 0 && (r.contentVideos > 0 || r.offChainVideos > 0 || r.indexerNodes > 0)
  );
  const healthy = rows.filter(
    (r) => r.episodes > 0 && (r.contentVideos > 0 || r.offChainVideos > 0 || r.indexerNodes > 0)
  );

  console.log('\n──────────── SUMMARY ────────────');
  console.log(`HEALTHY  (episodes + video):       ${healthy.length}`);
  console.log(`PARTIAL  (videos only, no episodes): ${hasVideosOnly.length}`);
  console.log(`PARTIAL  (episodes only, no videos): ${hasEpisodesOnly.length}`);
  console.log(`EMPTY    (neither):                ${empty.length}`);
  console.log(`Total:                             ${rows.length}`);

  const fmt = (r: UniRow) => {
    const tags = [r.isHidden ? 'HIDDEN' : '', r.isPrivate ? 'PRIVATE' : '']
      .filter(Boolean)
      .join(',');
    return `${r.name.slice(0, 30).padEnd(30)} ${r.addr.slice(0, 10)}…  ep=${r.episodes}(c${r.episodesCanon}) cv=${r.contentVideos} oc=${r.offChainVideos} idx=${r.indexerNodes}  ${tags}`;
  };

  console.log('\n──────────── EMPTY UNIVERSES (candidates for removal) ────────────');
  if (empty.length === 0) {
    console.log('(none)');
  } else {
    for (const r of empty) console.log(`  ${fmt(r)}`);
  }

  console.log('\n──────────── PARTIAL: videos but NO episodes ────────────');
  for (const r of hasVideosOnly) console.log(`  ${fmt(r)}`);

  console.log('\n──────────── PARTIAL: episodes but NO videos ────────────');
  for (const r of hasEpisodesOnly) console.log(`  ${fmt(r)}`);

  console.log('\n──────────── HEALTHY ────────────');
  for (const r of healthy) console.log(`  ${fmt(r)}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
