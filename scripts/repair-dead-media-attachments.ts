/**
 * Repair dead ephemeral-CDN media attachments surfaced on wiki entity pages.
 *
 * Background
 * ----------
 * A batch of `mediaAttachments` created 2026-04-17/18 (before the pipeline was
 * wired through `rehostEphemeralUrl`) stored raw provider-CDN URLs instead of a
 * permanent Pinata/GCS copy:
 *   - ~595 rows on `assets.meshy.ai` (Meshy image-to-3D / texture — GLB/FBX/OBJ/
 *     USDZ model files + the `concept_art` preview thumbnails), and
 *   - ~26 rows on `*.volces.com` (ByteDance Seedream images).
 * Meshy's CloudFront signatures have since been revoked (403 AccessDenied) and
 * the ByteDance TOS URLs have expired, so every one of these is a broken
 * thumbnail / dead 3D viewer in `MediaGallery` (wiki `/wiki/entity/$id`). This
 * is the "wiki pages show some 3D & some videos but none of the pictures"
 * report — the pictures are all dead Meshy preview PNGs.
 *
 * The source bytes are unrecoverable (signatures dead), and these generation
 * ids resolve to no document holding a permanent copy, so the only correct fix
 * is to stop surfacing the dead rows. `mediaAttachments` has no status field
 * and the UI has no notion of a hidden attachment, so a confirmed-dead,
 * unrescuable row is deleted outright — after a full JSON backup.
 *
 * Also flips any still-active `content` doc whose media is a dead ephemeral URL
 * to `contentStatus='hidden'` (mirrors the 2026-09-01 wiki-media audit; that
 * pass already hid 122 of 123).
 *
 * Safety
 * ------
 *   - Dry run by default. `--apply` writes.
 *   - Every touched doc is written to scripts/.backups/ before any mutation.
 *   - A row is only deleted when its URL HEAD-checks dead AND no rescue URL is
 *     found. Rows that are still live are left untouched (re-run later once they
 *     rot, or once someone rehosts them).
 *
 * Usage
 *   pnpm tsx scripts/repair-dead-media-attachments.ts               # dry run
 *   pnpm tsx scripts/repair-dead-media-attachments.ts --apply
 *   pnpm tsx scripts/repair-dead-media-attachments.ts --apply --limit 50
 *
 * Env
 *   FIREBASE_SERVICE_ACCOUNT_PATH  (default: ~/.config/loar/loar-db-sa.json)
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';

const APPLY = process.argv.includes('--apply');
const limitIdx = process.argv.indexOf('--limit');
const LIMIT = limitIdx !== -1 ? Number(process.argv[limitIdx + 1]) : Infinity;
const CONCURRENCY = 12;

// Keep in sync with apps/server/src/lib/rehost-ephemeral.ts
const EPHEMERAL_HOSTS = [
  'volces.com',
  'ark-acg',
  'fal.media',
  'replicate.delivery',
  'pbxt.replicate.delivery',
  'oaidalleapiprodscus.blob.core.windows.net',
  'generativelanguage.googleapis.com',
  'assets.meshy.ai',
  'tripo-data',
  'data.tripo3d.ai',
];

function isEphemeralUrl(url: unknown): url is string {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return false;
  try {
    const host = new URL(url).host.toLowerCase();
    return EPHEMERAL_HOSTS.some((ep) => host.includes(ep));
  } catch {
    return false;
  }
}

const SA_PATH =
  process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
  path.join(process.env.HOME || '', '.config/loar/loar-db-sa.json');

function initDb(): Firestore {
  // Never touch a local emulator — this operates on prod.
  delete process.env.FIRESTORE_EMULATOR_HOST;
  const sa = JSON.parse(readFileSync(SA_PATH, 'utf-8'));
  const db = getFirestore(
    initializeApp(
      { credential: cert(sa), projectId: sa.project_id || 'loar-db' },
      `repair-${Date.now()}`
    )
  );
  db.settings({ preferRest: true });
  return db;
}

async function headStatus(url: string): Promise<number> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12_000);
    let res = await fetch(url, { method: 'HEAD', signal: ctrl.signal, redirect: 'follow' });
    // Some CDNs 403/405 HEAD but answer a ranged GET.
    if (res.status === 403 || res.status === 405) {
      res = await fetch(url, {
        method: 'GET',
        headers: { Range: 'bytes=0-0' },
        signal: ctrl.signal,
        redirect: 'follow',
      });
    }
    clearTimeout(t);
    return res.status;
  } catch {
    return 0; // network error / DNS / timeout — treat as dead
  }
}

const isAlive = (s: number) => s >= 200 && s < 400;

/** Pooled map. */
async function pMap<T, R>(
  items: T[],
  n: number,
  fn: (t: T, i: number) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (cursor < items.length) {
        const i = cursor++;
        out[i] = await fn(items[i], i);
      }
    })
  );
  return out;
}

const FORMAT_KEYS: Record<string, string[]> = {
  glb: ['glb', 'glbUrl', 'modelUrl', 'model3dUrl', 'permanentModelUrl'],
  fbx: ['fbx', 'fbxUrl'],
  obj: ['obj', 'objUrl'],
  usdz: ['usdz', 'usdzUrl'],
  mtl: ['mtl', 'mtlUrl'],
  thumbnail: ['thumbnailUrl', 'imageUrl', 'previewUrl', 'permanentThumbnailUrl'],
};

/** Infer the model/thumbnail format a mediaAttachment row represents. */
function rowFormat(row: FirebaseFirestore.DocumentData): string {
  const ch = String(row.contentHash || '');
  const fn = String(row.originalFilename || '');
  const m =
    ch.match(/:(glb|fbx|obj|usdz|mtl|thumbnail)$/) ||
    fn.match(/\.(glb|fbx|obj|usdz|mtl|png|jpg|jpeg)$/i);
  if (!m) return row.category === 'image' ? 'thumbnail' : 'glb';
  const f = m[1].toLowerCase();
  return f === 'png' || f === 'jpg' || f === 'jpeg' ? 'thumbnail' : f;
}

const RESCUE_COLLECTIONS = [
  'threeDGenerations',
  'imageGenerations',
  'videoGenerations',
  'characterPipelines',
];

/** Look for a permanent (non-ephemeral) URL of the right format on a sibling gen doc. */
async function findRescueUrl(
  db: Firestore,
  generationId: string | null | undefined,
  fmt: string
): Promise<string | null> {
  if (!generationId) return null;
  const ids = new Set<string>([
    generationId,
    generationId.replace(/^pipeline-/, ''),
    generationId.replace(/^gen:/, '').split(':')[0],
  ]);
  const keys = FORMAT_KEYS[fmt] || FORMAT_KEYS.glb;
  for (const coll of RESCUE_COLLECTIONS) {
    for (const id of ids) {
      let snap: FirebaseFirestore.DocumentSnapshot;
      try {
        snap = await db.collection(coll).doc(id).get();
      } catch {
        continue;
      }
      if (!snap.exists) continue;
      const d = snap.data()!;
      const pools = [d, d.modelUrls, d.texturedModelUrls, d.output, d.result, d.assets].filter(
        (x) => x && typeof x === 'object'
      );
      for (const pool of pools) {
        for (const k of keys) {
          const v = (pool as Record<string, unknown>)[k];
          if (typeof v === 'string' && /^https?:\/\//.test(v) && !isEphemeralUrl(v)) return v;
        }
      }
    }
  }
  return null;
}

interface Plan {
  deletes: {
    id: string;
    url: string;
    category: string;
    targetId: string;
    data: FirebaseFirestore.DocumentData;
  }[];
  repoints: { id: string; from: string; to: string; data: FirebaseFirestore.DocumentData }[];
  keptAlive: number;
  contentHides: { id: string; field: string; url: string; data: FirebaseFirestore.DocumentData }[];
}

async function build(db: Firestore): Promise<Plan> {
  const plan: Plan = { deletes: [], repoints: [], keptAlive: 0, contentHides: [] };

  // ── mediaAttachments ──────────────────────────────────────────────────
  const maSnap = await db.collection('mediaAttachments').get();
  const candidates = maSnap.docs.filter((d) => isEphemeralUrl(d.data().url)).slice(0, LIMIT);
  console.log(`mediaAttachments: ${maSnap.size} total, ${candidates.length} on an ephemeral host`);

  const statuses = await pMap(candidates, CONCURRENCY, (d) => headStatus(d.data().url));
  for (let i = 0; i < candidates.length; i++) {
    const doc = candidates[i];
    const row = doc.data();
    if (isAlive(statuses[i])) {
      plan.keptAlive++;
      continue;
    }
    const fmt = rowFormat(row);
    const rescue = await findRescueUrl(db, row.generationId, fmt);
    if (rescue) {
      plan.repoints.push({ id: doc.id, from: row.url, to: rescue, data: row });
    } else {
      plan.deletes.push({
        id: doc.id,
        url: row.url,
        category: row.category,
        targetId: `${row.targetType}:${row.targetId}`,
        data: row,
      });
    }
  }

  // ── content (still-active dead ephemeral media) ───────────────────────
  const cSnap = await db.collection('content').get();
  const CONTENT_FIELDS = ['mediaUrl', 'thumbnailUrl', 'videoUrl', 'audioUrl', 'imageUrl'];
  const contentCandidates: {
    doc: FirebaseFirestore.QueryDocumentSnapshot;
    field: string;
    url: string;
  }[] = [];
  cSnap.forEach((d) => {
    const v = d.data();
    const status = v.contentStatus ?? 'active';
    if (status === 'hidden') return;
    for (const f of CONTENT_FIELDS) {
      if (isEphemeralUrl(v[f])) {
        contentCandidates.push({ doc: d, field: f, url: v[f] });
        break;
      }
    }
  });
  const cStatuses = await pMap(contentCandidates, CONCURRENCY, (c) => headStatus(c.url));
  contentCandidates.forEach((c, i) => {
    if (!isAlive(cStatuses[i])) {
      plan.contentHides.push({ id: c.doc.id, field: c.field, url: c.url, data: c.doc.data() });
    }
  });

  return plan;
}

function backup(plan: Plan): string {
  const dir = path.join(process.cwd(), 'scripts/.backups');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `repair-dead-media-attachments-${Date.now()}.json`);
  writeFileSync(
    file,
    JSON.stringify(
      {
        ts: new Date().toISOString(),
        deletes: plan.deletes,
        repoints: plan.repoints,
        contentHides: plan.contentHides,
      },
      (_k, val) =>
        val && (val as any)._seconds != null
          ? new Date((val as any)._seconds * 1000).toISOString()
          : val,
      2
    )
  );
  return file;
}

async function apply(db: Firestore, plan: Plan) {
  let n = 0;
  // Repoints
  for (const r of plan.repoints) {
    await db.collection('mediaAttachments').doc(r.id).update({ url: r.to, repairedAt: new Date() });
    if (++n % 50 === 0) console.log(`  …${n}`);
  }
  // Deletes (batched)
  for (let i = 0; i < plan.deletes.length; i += 400) {
    const batch = db.batch();
    for (const del of plan.deletes.slice(i, i + 400)) {
      batch.delete(db.collection('mediaAttachments').doc(del.id));
    }
    await batch.commit();
    console.log(`  deleted ${Math.min(i + 400, plan.deletes.length)}/${plan.deletes.length}`);
  }
  // Content hides
  for (const h of plan.contentHides) {
    await db.collection('content').doc(h.id).update({
      contentStatus: 'hidden',
      contentStatusUpdatedAt: new Date(),
      contentStatusUpdatedBy: 'repair-dead-media-attachments',
      contentStatusReason: 'ephemeral_cdn_url_dead_no_rescue',
      brokenMediaUrlArchived: h.url,
    });
  }
}

(async () => {
  const db = initDb();
  const plan = await build(db);

  const byCat = (rows: { category?: string }[]) =>
    rows.reduce<Record<string, number>>(
      (m, r) => ((m[r.category || '?'] = (m[r.category || '?'] || 0) + 1), m),
      {}
    );

  console.log('\n──────── PLAN ────────');
  console.log(`repoint (permanent copy found) : ${plan.repoints.length}`);
  console.log(`delete  (dead, unrescuable)    : ${plan.deletes.length}`, byCat(plan.deletes));
  console.log(`left alone (URL still live)    : ${plan.keptAlive}`);
  console.log(`content docs to hide          : ${plan.contentHides.length}`);

  const distinctTargets = new Set(plan.deletes.map((d) => d.targetId));
  console.log(`entities/universes affected by deletes: ${distinctTargets.size}`);

  if (plan.repoints.length + plan.deletes.length + plan.contentHides.length === 0) {
    console.log('\nNothing to do.');
    return;
  }

  const file = backup(plan);
  console.log(`\nbackup written: ${path.relative(process.cwd(), file)}`);

  if (!APPLY) {
    console.log('\nDRY RUN — re-run with --apply to write.');
    return;
  }
  console.log('\nAPPLYING…');
  await apply(db, plan);
  console.log('Done.');
})();
