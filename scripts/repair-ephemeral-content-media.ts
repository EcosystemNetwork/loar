/**
 * Targeted repair for content docs whose media points at a NON-IPFS ephemeral
 * host (Google Gemini Files API, fal.media, replicate, volces, dalle blob).
 * These are signed/key-scoped URLs that expire — they 403/404 in the browser.
 *
 * Unlike scripts/repair-broken-media-urls.ts this does NOT sweep every
 * `.mypinata.cloud` URL (2000+, ~98% alive) — it only touches the handful of
 * genuinely-dead third-party-CDN refs.
 *
 * For each broken field:
 *   - re-point to generations/{generationId}.permanent{Video,Image,Media}Url
 *     when one exists and is itself permanent
 *   - otherwise set contentStatus='hidden' so the gallery/wiki stops surfacing
 *     the dead ref (reversible: contentStatus='active')
 *
 * Old value is archived on the doc; a JSON manifest is written to the
 * scratchpad for reversibility.
 *
 * Usage:
 *   DRY_RUN=1 pnpm tsx scripts/repair-ephemeral-content-media.ts
 *   pnpm tsx scripts/repair-ephemeral-content-media.ts        # apply
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
// Repo .env pins FIRESTORE_EMULATOR_HOST for local dev — force prod unless
// --emulator is explicitly passed.
if (!process.argv.includes('--emulator')) delete process.env.FIRESTORE_EMULATOR_HOST;

const DRY_RUN = process.env.DRY_RUN === '1';
const MANIFEST_DIR =
  process.env.MANIFEST_DIR ||
  '/tmp/claude-1000/-home-god-Desktop-loar-loar/40ab99ba-32fd-49f0-bdaf-c51183b76f39/scratchpad';

const EPHEMERAL_HOSTS = [
  'generativelanguage.googleapis.com',
  'volces.com',
  'fal.media',
  'replicate.delivery',
  'pbxt.replicate.delivery',
  'oaidalleapiprodscus.blob.core.windows.net',
  'ark-acg',
];
const MEDIA_URL_FIELDS = ['mediaUrl', 'videoUrl', 'audioUrl', 'imageUrl', 'thumbnailUrl'];

function isEphemeral(url: unknown): url is string {
  if (typeof url !== 'string' || !url.startsWith('http')) return false;
  try {
    const host = new URL(url).host.toLowerCase();
    return EPHEMERAL_HOSTS.some((h) => host.includes(h));
  } catch {
    return false;
  }
}

function isPermanent(url: unknown): url is string {
  if (typeof url !== 'string' || !url.startsWith('http')) return false;
  try {
    const host = new URL(url).host.toLowerCase();
    return (
      host.endsWith('.mypinata.cloud') || host === 'gateway.pinata.cloud' || host === 'ipfs.io'
    );
  } catch {
    return false;
  }
}

function initDb(): Firestore {
  const saPath = path.resolve(process.cwd(), `${process.env.HOME}/.config/loar/loar-db-sa.json`);
  const sa = JSON.parse(readFileSync(saPath, 'utf-8'));
  const app = initializeApp({ credential: cert(sa), projectId: 'loar-db' }, `repair-${Date.now()}`);
  const db = getFirestore(app);
  db.settings({ preferRest: true });
  return db;
}

async function headOk(url: string, timeoutMs = 8000): Promise<boolean> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = {};
    try {
      if (new URL(url).hostname === 'generativelanguage.googleapis.com') {
        const k =
          process.env.GEMINI_API_KEY ||
          process.env.GOOGLE_API_KEY ||
          process.env.GOOGLE_GENAI_API_KEY;
        if (k) headers['x-goog-api-key'] = k;
      }
    } catch {
      /* ignore */
    }
    const r = await fetch(url, { method: 'HEAD', signal: c.signal, redirect: 'follow', headers });
    return r.status >= 200 && r.status < 400;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

interface Row {
  docId: string;
  field: string;
  url: string;
  generationId: string | null;
}
interface Plan extends Row {
  permanentUrl: string | null;
  action: 'repoint' | 'hide' | 'live-skip';
}

async function main() {
  const db = initDb();
  console.log(`\n=== REPAIR EPHEMERAL CONTENT MEDIA (${DRY_RUN ? 'DRY-RUN' : 'APPLY'}) ===\n`);

  const snap = await db.collection('content').get();
  const rows: Row[] = [];
  for (const d of snap.docs) {
    const data = d.data();
    for (const f of MEDIA_URL_FIELDS) {
      if (isEphemeral(data[f])) {
        rows.push({
          docId: d.id,
          field: f,
          url: data[f] as string,
          generationId: (data.generationId as string) ?? null,
        });
      }
    }
  }
  console.log(`Scanned ${snap.size} content docs — ${rows.length} ephemeral-host field refs`);
  const byHost: Record<string, number> = {};
  for (const r of rows) {
    const h = new URL(r.url).host.toLowerCase();
    byHost[h] = (byHost[h] || 0) + 1;
  }
  console.log('  by host:', byHost);

  // Re-verify each is actually dead (concurrency 12).
  console.log(`\nHEAD-checking ${rows.length} refs…`);
  const dead: Row[] = [];
  let cursor = 0;
  async function worker() {
    while (cursor < rows.length) {
      const r = rows[cursor++];
      if (!(await headOk(r.url))) dead.push(r);
    }
  }
  await Promise.all(Array.from({ length: 12 }, worker));
  console.log(
    `  ${dead.length}/${rows.length} confirmed dead, ${rows.length - dead.length} still live (left alone)`
  );

  // Rescue lookup.
  console.log(`\nLooking for rescue URLs in generations/…`);
  const genCache = new Map<string, any>();
  const plans: Plan[] = [];
  for (const r of dead) {
    let permanent: string | null = null;
    if (r.generationId) {
      let gd = genCache.get(r.generationId);
      if (gd === undefined) {
        try {
          const g = await db.collection('generations').doc(r.generationId).get();
          gd = g.exists ? g.data() : null;
        } catch {
          gd = null;
        }
        genCache.set(r.generationId, gd);
      }
      if (gd) {
        const cand =
          gd.permanentVideoUrl ??
          gd.permanentImageUrl ??
          gd.permanentMediaUrl ??
          gd.mediaUrl ??
          null;
        if (isPermanent(cand)) permanent = cand;
      }
    }
    plans.push({ ...r, permanentUrl: permanent, action: permanent ? 'repoint' : 'hide' });
  }

  const repoint = plans.filter((p) => p.action === 'repoint');
  const hide = plans.filter((p) => p.action === 'hide');
  console.log(`  repoint: ${repoint.length}`);
  console.log(`  hide:    ${hide.length}`);
  console.log(`\nREPOINT sample:`);
  for (const p of repoint.slice(0, 8)) {
    console.log(
      `  ${p.docId} ${p.field}\n    old ${p.url.slice(0, 90)}\n    new ${p.permanentUrl!.slice(0, 90)}`
    );
  }
  console.log(`\nHIDE sample:`);
  for (const p of hide.slice(0, 12)) {
    console.log(`  ${p.docId} ${p.field} gen=${p.generationId ?? 'none'}  ${p.url.slice(0, 70)}`);
  }

  const manifest = path.join(MANIFEST_DIR, `repair-ephemeral-content-${Date.now()}.json`);
  writeFileSync(manifest, JSON.stringify({ dryRun: DRY_RUN, plans }, null, 2));
  console.log(`\nManifest: ${manifest}`);

  if (DRY_RUN) {
    console.log(`\n(DRY_RUN — no writes.)`);
    return;
  }

  console.log(`\nApplying…`);
  let n = 0;
  for (const p of repoint) {
    await db
      .collection('content')
      .doc(p.docId)
      .update({
        [p.field]: p.permanentUrl,
        [`brokenUrlArchived_${p.field}`]: p.url,
        mediaUrlRepairedAt: new Date(),
        mediaUrlRepairedReason: 'ephemeral_cdn_url_expired_rescued_from_generations',
      });
    if (++n % 20 === 0) console.log(`  ${n}/${repoint.length} repointed`);
  }
  console.log(`  ${n}/${repoint.length} repointed`);

  // Group hides by doc so we only write contentStatus once per doc.
  const hideDocs = [...new Set(hide.map((h) => h.docId))];
  n = 0;
  for (const docId of hideDocs) {
    const fields = hide.filter((h) => h.docId === docId);
    const patch: Record<string, unknown> = {
      contentStatus: 'hidden',
      contentStatusUpdatedAt: new Date(),
      contentStatusUpdatedBy: 'repair-ephemeral-content-media',
      contentStatusReason: 'ephemeral_cdn_url_expired_no_rescue',
    };
    for (const f of fields) patch[`brokenUrlArchived_${f.field}`] = f.url;
    await db.collection('content').doc(docId).update(patch);
    if (++n % 20 === 0) console.log(`  ${n}/${hideDocs.length} docs hidden`);
  }
  console.log(`  ${n}/${hideDocs.length} docs hidden`);
  console.log(`\nDone.`);
}

main().then(() => process.exit(0));
