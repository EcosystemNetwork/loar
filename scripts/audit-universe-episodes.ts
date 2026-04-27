/**
 * Read-only: report canon-episode coverage for every visible universe.
 *
 * Lists each universe (non-hidden, non-private) with:
 *   - episode count (total / canon)
 *   - whether it would surface in the home rail (canon >= 1)
 *   - usable offChainNodes (have videoUrl)
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

  const [unisSnap, epSnap, ocSnap] = await Promise.all([
    db.collection('cinematicUniverses').get(),
    db.collection('episodes').get(),
    db.collection('offChainNodes').get(),
  ]);

  const epByUni = new Map<string, { total: number; canon: number }>();
  for (const d of epSnap.docs) {
    const data = d.data() as any;
    const uid = (data.universeId as string | undefined)?.toLowerCase();
    if (!uid) continue;
    const cur = epByUni.get(uid) ?? { total: 0, canon: 0 };
    cur.total++;
    if (data.isCanon) cur.canon++;
    epByUni.set(uid, cur);
  }

  const ocByUni = new Map<string, { total: number; withVideo: number }>();
  for (const d of ocSnap.docs) {
    const data = d.data() as any;
    const uid = (data.universeId as string | undefined)?.toLowerCase();
    if (!uid) continue;
    const cur = ocByUni.get(uid) ?? { total: 0, withVideo: 0 };
    cur.total++;
    if (data.videoUrl) cur.withVideo++;
    ocByUni.set(uid, cur);
  }

  type Row = {
    name: string;
    addr: string;
    isHidden: boolean;
    isPrivate: boolean;
    episodes: number;
    canonEpisodes: number;
    nodes: number;
    nodesWithVideo: number;
  };
  const rows: Row[] = [];
  for (const d of unisSnap.docs) {
    const u = d.data() as any;
    const addr = (u.address || u.id || d.id).toLowerCase();
    const ep = epByUni.get(addr) ?? { total: 0, canon: 0 };
    const oc = ocByUni.get(addr) ?? { total: 0, withVideo: 0 };
    rows.push({
      name: u.name || '(unnamed)',
      addr,
      isHidden: !!u.isHidden,
      isPrivate: !!u.isPrivate,
      episodes: ep.total,
      canonEpisodes: ep.canon,
      nodes: oc.total,
      nodesWithVideo: oc.withVideo,
    });
  }

  rows.sort((a, b) => {
    if (a.isHidden !== b.isHidden) return a.isHidden ? 1 : -1;
    if (a.isPrivate !== b.isPrivate) return a.isPrivate ? 1 : -1;
    return b.nodes - a.nodes;
  });

  console.log('──────────── UNIVERSE EPISODE COVERAGE ────────────');
  console.log(
    'name'.padEnd(36) +
      'addr'.padEnd(14) +
      'flags'.padEnd(20) +
      'eps'.padEnd(8) +
      'canon'.padEnd(8) +
      'nodes'.padEnd(10) +
      'with-video'
  );
  for (const r of rows) {
    const flags =
      [r.isHidden ? 'HIDDEN' : '', r.isPrivate ? 'PRIVATE' : ''].filter(Boolean).join(',') || '—';
    console.log(
      r.name.slice(0, 34).padEnd(36) +
        r.addr.slice(0, 12).padEnd(14) +
        flags.padEnd(20) +
        String(r.episodes).padEnd(8) +
        String(r.canonEpisodes).padEnd(8) +
        String(r.nodes).padEnd(10) +
        String(r.nodesWithVideo)
    );
  }

  const visible = rows.filter((r) => !r.isHidden && !r.isPrivate);
  const visibleNoCanon = visible.filter((r) => r.canonEpisodes === 0);
  const visibleNoCanonWithNodes = visibleNoCanon.filter((r) => r.nodesWithVideo > 0);
  const visibleNoCanonNoNodes = visibleNoCanon.filter((r) => r.nodesWithVideo === 0);

  console.log('\n──────────── SUMMARY ────────────');
  console.log(`Total universes:                       ${rows.length}`);
  console.log(`Visible (not hidden/private):          ${visible.length}`);
  console.log(`  → with canon episode:                ${visible.length - visibleNoCanon.length}`);
  console.log(`  → MISSING canon, has video nodes:    ${visibleNoCanonWithNodes.length}`);
  console.log(`  → MISSING canon, NO video nodes:     ${visibleNoCanonNoNodes.length}`);

  if (visibleNoCanonWithNodes.length) {
    console.log('\nVisible, missing canon but buildable:');
    visibleNoCanonWithNodes.forEach((r) =>
      console.log(`  ${r.name}  ${r.addr}  (${r.nodesWithVideo} usable nodes)`)
    );
  }
  if (visibleNoCanonNoNodes.length) {
    console.log('\nVisible, missing canon AND no video nodes:');
    visibleNoCanonNoNodes.forEach((r) => console.log(`  ${r.name}  ${r.addr}`));
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
