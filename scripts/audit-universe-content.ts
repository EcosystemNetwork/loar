/**
 * Audit per-universe content health: how many video nodes each universe has,
 * how many have a working mediaUrl + thumbnailUrl (post-backfill).
 */
import dotenv from 'dotenv';
import path from 'path';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const EPHEMERAL = ['volces.com', 'fal.media', 'replicate', 'ark-acg', 'dalleapi'];

function isEphemeral(url?: string | null): boolean {
  if (!url) return false;
  try {
    const h = new URL(url).host.toLowerCase();
    return EPHEMERAL.some((e) => h.includes(e));
  } catch {
    return false;
  }
}

function isPermanent(url?: string | null): boolean {
  if (!url) return false;
  try {
    const h = new URL(url).host.toLowerCase();
    return h.endsWith('.mypinata.cloud') || h === 'gateway.pinata.cloud';
  } catch {
    return false;
  }
}

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

  // 1. Universes
  const unisSnap = await db.collection('cinematicUniverses').get();
  const universes = unisSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
  console.log(`\n━━━ Universes: ${universes.length} ━━━`);

  // 2. For each universe, count content + offChainNodes. Skip isHidden universes.
  const visibleUniverses = universes.filter((u) => !u.isHidden);
  console.log(`(${visibleUniverses.length} visible after isHidden filter)\n`);

  for (const u of visibleUniverses) {
    const addr = (u.address || u.id || '').toLowerCase();
    const name = u.name || '(unnamed)';
    if (!addr) continue;

    // content docs bound to this universe
    const contentSnap = await db.collection('content').where('universeId', '==', addr).get();
    const content = contentSnap.docs.map((d) => d.data() as any);
    // Public content only: active / reinstated
    const publicContent = content.filter((c) => {
      const s = c.contentStatus || 'active';
      return s === 'active' || s === 'reinstated';
    });
    const videos = publicContent.filter(
      (c) => c.mediaType === 'video' || c.mediaType === 'ai-video'
    );
    const videosWithThumb = videos.filter((v) => !!v.thumbnailUrl);
    const videosPinnedMedia = videos.filter((v) => isPermanent(v.mediaUrl));
    const videosBroken = videos.filter(
      (v) => isEphemeral(v.mediaUrl) || isEphemeral(v.thumbnailUrl)
    );
    const hiddenCount = content.length - publicContent.length;

    // offChainNodes (fun-mode timeline)
    let offChain: any[] = [];
    try {
      const offSnap = await db.collection('offChainNodes').where('universeId', '==', addr).get();
      offChain = offSnap.docs.map((d) => d.data() as any);
    } catch {
      /* no index / no collection */
    }
    const offVideos = offChain.filter((n) => n.videoUrl || n.videoLink);

    console.log(`\n${name.padEnd(28)} ${addr.slice(0, 10)}…`);
    console.log(
      `  public: ${publicContent.length.toString().padStart(4)}  hidden: ${hiddenCount
        .toString()
        .padStart(
          3
        )}  videos: ${videos.length.toString().padStart(3)}  with-thumb: ${videosWithThumb.length
        .toString()
        .padStart(3)}  pinned: ${videosPinnedMedia.length
        .toString()
        .padStart(3)}  broken: ${videosBroken.length.toString().padStart(3)}`
    );
    if (offChain.length) {
      console.log(
        `  offChainNodes: ${offChain.length.toString().padStart(4)}  with-video: ${offVideos.length}`
      );
    }
  }

  // 3. Orphaned content (universeId set but universe missing)
  const contentAll = await db.collection('content').get();
  const uniAddrs = new Set(universes.map((u) => (u.address || u.id || '').toLowerCase()));
  let orphanCount = 0;
  let noUniCount = 0;
  for (const doc of contentAll.docs) {
    const u = (doc.data().universeId || '').toLowerCase();
    if (!u) noUniCount++;
    else if (!uniAddrs.has(u)) orphanCount++;
  }
  console.log(`\n━━━ Totals ━━━`);
  console.log(`content total:    ${contentAll.size}`);
  console.log(`no universeId:    ${noUniCount}  (personal gallery / sandbox)`);
  console.log(`orphaned:         ${orphanCount}  (universeId points at missing universe)`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
