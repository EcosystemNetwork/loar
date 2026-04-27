/**
 * Per-universe content-coverage audit.
 *
 * Read-only. For each universe, computes:
 *   - generations existing  (videoGenerations + imageGenerations with universeId)
 *   - content docs found    (gallery-visible mirror in `content` keyed by generationId)
 *   - missing-from-gallery  (generations that lack a content doc)
 *   - hidden-from-gallery   (content present but visibility!=public OR contentStatus hidden)
 *   - mediaAttachments      (entity wiki attachments)
 *   - eventWikis (Cyber War-style episode pages) + episodeNFTs
 *
 * Also reports orphan generations (no universeId) so we know what would need
 * tagging if the operator chooses to attribute them retroactively.
 */
import dotenv from 'dotenv';
import path from 'path';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const HIDDEN = new Set(['flagged', 'under_review', 'hidden', 'removed']);

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

  const uSnap = await db.collection('cinematicUniverses').get();
  const universes = uSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));

  // Pull entire collections once — we'll group in memory.
  console.log('Loading generations + content + attachments…');
  const [vgSnap, igSnap, contentSnap, maSnap, ewSnap, enSnap, ocSnap] = await Promise.all([
    db.collection('videoGenerations').get(),
    db.collection('imageGenerations').get(),
    db.collection('content').get(),
    db.collection('mediaAttachments').get(),
    db.collection('eventWikis').get(),
    db.collection('episodeNFTs').get(),
    db.collection('offChainNodes').get(),
  ]);
  console.log(
    `  videoGen=${vgSnap.size}  imageGen=${igSnap.size}  content=${contentSnap.size}  attach=${maSnap.size}  eventWiki=${ewSnap.size}  episodeNFT=${enSnap.size}  offChain=${ocSnap.size}\n`
  );

  // Index content by generationId for a fast mirror check.
  const contentByGen = new Map<string, any>();
  for (const d of contentSnap.docs) {
    const data = d.data() as any;
    if (data.generationId) contentByGen.set(data.generationId, { id: d.id, ...data });
  }

  // Helper: bucket content by universe
  const contentByUni = new Map<string, any[]>();
  for (const d of contentSnap.docs) {
    const data = d.data() as any;
    const uid = (data.universeId as string | undefined)?.toLowerCase();
    if (!uid) continue;
    if (!contentByUni.has(uid)) contentByUni.set(uid, []);
    contentByUni.get(uid)!.push({ id: d.id, ...data });
  }

  type Row = {
    name: string;
    addr: string;
    isHidden: boolean;
    videoGen: number;
    videoGenWithUrl: number;
    imageGen: number;
    contentTotal: number;
    contentVisible: number; // visibility==public AND contentStatus not in HIDDEN
    contentByMediaType: Record<string, number>;
    missingMirror: { vg: number; ig: number };
    hiddenMirror: number;
    attachments: number;
    eventWikis: number;
    episodeNFTs: number;
    offChainNodes: number;
  };

  const rows: Row[] = [];

  for (const u of universes) {
    const addr = (u.address || u.id || '').toLowerCase();
    if (!addr) continue;

    const myVg = vgSnap.docs.filter((d) => (d.data().universeId || '').toLowerCase() === addr);
    const myIg = igSnap.docs.filter((d) => (d.data().universeId || '').toLowerCase() === addr);
    const myContent = contentByUni.get(addr) ?? [];
    const myAtt = maSnap.docs.filter((d) => (d.data().universeId || '').toLowerCase() === addr);
    const myEw = ewSnap.docs.filter((d) => {
      const data = d.data() as any;
      const id = String(d.id);
      return (
        (data.universeAddress || data.universeId || '').toLowerCase() === addr ||
        id.toLowerCase().startsWith(addr + '-')
      );
    });
    const myEn = enSnap.docs.filter((d) => {
      const data = d.data() as any;
      return (data.universeAddress || data.universeId || '').toLowerCase() === addr;
    });
    const myOc = ocSnap.docs.filter((d) => (d.data().universeId || '').toLowerCase() === addr);

    const contentByMediaType: Record<string, number> = {};
    let contentVisible = 0;
    let hiddenMirror = 0;
    for (const c of myContent) {
      const mt = c.mediaType || 'unknown';
      contentByMediaType[mt] = (contentByMediaType[mt] ?? 0) + 1;
      const vis = c.visibility === 'public';
      const okStatus = !HIDDEN.has(c.contentStatus);
      if (vis && okStatus) contentVisible++;
      else hiddenMirror++;
    }

    const missingVg = myVg.filter((d) => !contentByGen.has(d.id)).length;
    const missingIg = myIg.filter((d) => !contentByGen.has(d.id)).length;

    const videoGenWithUrl = myVg.filter((d) => {
      const data = d.data() as any;
      return !!(data.permanentVideoUrl || data.videoUrl);
    }).length;

    rows.push({
      name: u.name || '(unnamed)',
      addr,
      isHidden: !!u.isHidden,
      videoGen: myVg.length,
      videoGenWithUrl,
      imageGen: myIg.length,
      contentTotal: myContent.length,
      contentVisible,
      contentByMediaType,
      missingMirror: { vg: missingVg, ig: missingIg },
      hiddenMirror,
      attachments: myAtt.length,
      eventWikis: myEw.length,
      episodeNFTs: myEn.length,
      offChainNodes: myOc.length,
    });
  }

  // Sort: visible first, by total assets desc
  rows.sort((a, b) => {
    if (a.isHidden !== b.isHidden) return a.isHidden ? 1 : -1;
    const totalA = a.videoGen + a.imageGen + a.contentTotal + a.attachments;
    const totalB = b.videoGen + b.imageGen + b.contentTotal + b.attachments;
    return totalB - totalA;
  });

  console.log('──────────── PER-UNIVERSE COVERAGE ────────────');
  for (const r of rows) {
    if (r.isHidden && r.videoGen + r.imageGen + r.contentTotal + r.attachments === 0) continue;
    const mt =
      Object.entries(r.contentByMediaType)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k}=${v}`)
        .join(' ') || '—';
    console.log(`\n${r.name}  ${r.addr.slice(0, 10)}…  ${r.isHidden ? '[HIDDEN]' : ''}`);
    console.log(
      `  videoGen:    ${r.videoGen}  (with-url: ${r.videoGenWithUrl})  missing-mirror: ${r.missingMirror.vg}`
    );
    console.log(`  imageGen:    ${r.imageGen}  missing-mirror: ${r.missingMirror.ig}`);
    console.log(
      `  content:     total=${r.contentTotal}  publicly-visible=${r.contentVisible}  hidden=${r.hiddenMirror}`
    );
    console.log(`               by mediaType: ${mt}`);
    console.log(
      `  attachments: ${r.attachments}   eventWikis: ${r.eventWikis}   episodeNFTs: ${r.episodeNFTs}   offChainNodes: ${r.offChainNodes}`
    );
  }

  // Orphan (no universeId) generations
  const orphanVg = vgSnap.docs.filter((d) => !d.data().universeId).length;
  const orphanIg = igSnap.docs.filter((d) => !d.data().universeId).length;
  const orphanContent = contentSnap.docs.filter((d) => !d.data().universeId).length;
  console.log('\n──────────── ORPHANS (no universeId) ────────────');
  console.log(`videoGenerations:  ${orphanVg} / ${vgSnap.size}`);
  console.log(`imageGenerations:  ${orphanIg} / ${igSnap.size}`);
  console.log(
    `content:           ${orphanContent} / ${contentSnap.size}  (personal-gallery + sandbox)`
  );

  // Mirror-rate summary
  const totalGenWithUni = rows.reduce((s, r) => s + r.videoGen + r.imageGen, 0);
  const totalMissingMirror = rows.reduce((s, r) => s + r.missingMirror.vg + r.missingMirror.ig, 0);
  console.log('\n──────────── MIRROR HEALTH ────────────');
  console.log(`Generations w/ universeId:           ${totalGenWithUni}`);
  console.log(`  → with content-doc mirror:         ${totalGenWithUni - totalMissingMirror}`);
  console.log(`  → MISSING content-doc mirror:      ${totalMissingMirror}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
