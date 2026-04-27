/**
 * Read-only diagnostic: explain WHY each universe has missing/hidden content
 * in the wiki. Buckets every gap so we can decide what to fix and what is
 * legitimately admin-suppressed.
 *
 *   1. Missing-mirror generations  — videoGen/imageGen with universeId but no
 *      content doc (won't appear in the gallery at all).
 *   2. Hidden-mirror content docs  — content with universeId where either
 *      visibility !== 'public' OR contentStatus ∈ {flagged,under_review,hidden,removed}.
 *   3. Unknown-mediaType content   — content docs missing a mediaType.
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
    const sa = JSON.parse(
      readFileSync(
        process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? 'firebase-sa-key-20260416.json',
        'utf-8'
      )
    );
    const app = initializeApp({ credential: cert(sa) });
    db = getFirestore(app);
    db.settings({ preferRest: true });
  }

  const [unisSnap, vgSnap, igSnap, contentSnap] = await Promise.all([
    db.collection('cinematicUniverses').get(),
    db.collection('videoGenerations').get(),
    db.collection('imageGenerations').get(),
    db.collection('content').get(),
  ]);

  const universesByAddr = new Map<string, any>();
  for (const d of unisSnap.docs) {
    const data = d.data() as any;
    const addr = (data.address || data.id || d.id || '').toLowerCase();
    if (addr)
      universesByAddr.set(addr, { name: data.name || '(unnamed)', isHidden: !!data.isHidden });
  }

  const contentByGen = new Map<string, any>();
  for (const d of contentSnap.docs) {
    const data = d.data() as any;
    if (data.generationId) contentByGen.set(data.generationId, { id: d.id, ...data });
  }

  // ── 1. Missing-mirror generations ──
  console.log('═══════════════ MISSING-MIRROR GENERATIONS ═══════════════');
  const missingByUni = new Map<string, { vg: any[]; ig: any[] }>();
  for (const d of vgSnap.docs) {
    const data = d.data() as any;
    const uid = String(data.universeId || '').toLowerCase();
    if (!uid) continue;
    if (contentByGen.has(d.id)) continue;
    if (!missingByUni.has(uid)) missingByUni.set(uid, { vg: [], ig: [] });
    missingByUni.get(uid)!.vg.push({ id: d.id, ...data });
  }
  for (const d of igSnap.docs) {
    const data = d.data() as any;
    const uid = String(data.universeId || '').toLowerCase();
    if (!uid) continue;
    if (contentByGen.has(d.id)) continue;
    if (!missingByUni.has(uid)) missingByUni.set(uid, { vg: [], ig: [] });
    missingByUni.get(uid)!.ig.push({ id: d.id, ...data });
  }

  for (const [uid, gens] of missingByUni) {
    const u = universesByAddr.get(uid);
    if (!u) continue;
    console.log(`\n${u.name}  ${uid.slice(0, 12)}…`);
    console.log(`  ${gens.vg.length} videoGen + ${gens.ig.length} imageGen missing mirror`);

    // Group by status — failed jobs aren't a real gap.
    const bucket = (rows: any[]) => {
      const byStatus: Record<string, number> = {};
      const byUrl: Record<string, number> = {};
      for (const r of rows) {
        const s = r.status || '(none)';
        byStatus[s] = (byStatus[s] ?? 0) + 1;
        const hasUrl = !!(r.permanentVideoUrl || r.videoUrl || r.permanentImageUrl || r.imageUrl);
        const k = hasUrl ? 'has-url' : 'no-url';
        byUrl[k] = (byUrl[k] ?? 0) + 1;
      }
      return { byStatus, byUrl };
    };
    if (gens.vg.length) {
      const b = bucket(gens.vg);
      console.log(`    videoGen statuses:`, b.byStatus, b.byUrl);
      gens.vg.slice(0, 3).forEach((r) => {
        console.log(
          `      vg ${r.id.slice(0, 18)}  status=${r.status}  url=${
            !!(r.permanentVideoUrl || r.videoUrl) ? 'yes' : 'no'
          }  creator=${(r.creatorUid || '').slice(0, 12)}`
        );
      });
    }
    if (gens.ig.length) {
      const b = bucket(gens.ig);
      console.log(`    imageGen statuses:`, b.byStatus, b.byUrl);
      gens.ig.slice(0, 3).forEach((r) => {
        console.log(
          `      ig ${r.id.slice(0, 18)}  status=${r.status}  url=${
            !!(r.permanentImageUrl || r.imageUrl) ? 'yes' : 'no'
          }  creator=${(r.creatorUid || '').slice(0, 12)}`
        );
      });
    }
  }

  // ── 2. Hidden-mirror content docs ──
  console.log('\n\n═══════════════ HIDDEN-MIRROR CONTENT (per-universe) ═══════════════');
  const hiddenByUni = new Map<string, any[]>();
  for (const d of contentSnap.docs) {
    const data = d.data() as any;
    const uid = String(data.universeId || '').toLowerCase();
    if (!uid) continue;
    const vis = data.visibility === 'public';
    const okStatus = !HIDDEN.has(data.contentStatus);
    if (vis && okStatus) continue;
    if (!hiddenByUni.has(uid)) hiddenByUni.set(uid, []);
    hiddenByUni.get(uid)!.push({ id: d.id, ...data });
  }

  for (const [uid, items] of hiddenByUni) {
    const u = universesByAddr.get(uid);
    if (!u) continue;
    console.log(`\n${u.name}  ${uid.slice(0, 12)}…  (${items.length} hidden)`);
    const byVis: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    const byMt: Record<string, number> = {};
    const byCreator: Record<string, number> = {};
    let withModNotes = 0;
    let hasContentStatusUpdatedBy = 0;
    for (const c of items) {
      const v = String(c.visibility ?? '(none)');
      const s = String(c.contentStatus ?? '(none)');
      const mt = String(c.mediaType ?? '(none)');
      const cr = String(c.creatorUid ?? '(none)').slice(0, 14);
      byVis[v] = (byVis[v] ?? 0) + 1;
      byStatus[s] = (byStatus[s] ?? 0) + 1;
      byMt[mt] = (byMt[mt] ?? 0) + 1;
      byCreator[cr] = (byCreator[cr] ?? 0) + 1;
      if (c.moderationNotes || c.moderationReason) withModNotes++;
      if (c.contentStatusUpdatedBy) hasContentStatusUpdatedBy++;
    }
    console.log(`  visibility: ${JSON.stringify(byVis)}`);
    console.log(`  contentStatus: ${JSON.stringify(byStatus)}`);
    console.log(`  mediaType: ${JSON.stringify(byMt)}`);
    console.log(
      `  creator concentration:`,
      Object.entries(byCreator)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
    );
    console.log(
      `  audit-trail signals: moderationNotes=${withModNotes}, contentStatusUpdatedBy=${hasContentStatusUpdatedBy}`
    );
    // Sample one
    const sample = items[0];
    console.log(
      `  sample ${sample.id.slice(0, 18)}  vis=${sample.visibility}  status=${
        sample.contentStatus
      }  mediaType=${sample.mediaType}  generationId=${sample.generationId?.slice(0, 14)}`
    );
  }

  // ── 3. Unknown mediaType ──
  console.log('\n\n═══════════════ UNKNOWN-MEDIA-TYPE CONTENT ═══════════════');
  const unknownMt = contentSnap.docs.filter((d) => {
    const data = d.data() as any;
    return data.universeId && (!data.mediaType || data.mediaType === 'unknown');
  });
  console.log(`Total: ${unknownMt.length}`);
  const byUni: Record<string, number> = {};
  unknownMt.forEach((d) => {
    const uid = String((d.data() as any).universeId).toLowerCase();
    byUni[uid] = (byUni[uid] ?? 0) + 1;
  });
  for (const [uid, n] of Object.entries(byUni)) {
    const u = universesByAddr.get(uid);
    console.log(`  ${u?.name ?? uid}  ${uid.slice(0, 12)}…  ${n}`);
  }
  if (unknownMt.length) {
    console.log('\nFirst 3 samples:');
    unknownMt.slice(0, 3).forEach((d) => {
      const data = d.data() as any;
      console.log(
        `  ${d.id.slice(0, 18)}  mediaType=${data.mediaType}  mediaUrl=${String(
          data.mediaUrl ?? ''
        ).slice(0, 60)}  generationId=${data.generationId?.slice(0, 14)}  vis=${
          data.visibility
        }  status=${data.contentStatus}`
      );
    });
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
