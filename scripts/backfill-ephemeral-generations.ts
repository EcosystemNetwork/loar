/**
 * Backfill ephemeral media URLs across the generation + attachment collections.
 *
 * Companion to `backfill-ephemeral-media.ts`, which covers only `content` and
 * `entities`. This one covers the collections that were never wired into the
 * rehost path at all:
 *
 *   videoGenerations, imageGenerations, audioGenerations,
 *   mediaAttachments, episodes
 *
 * Provider CDN URLs (fal.media, volces.com, replicate.delivery, …) are signed
 * and expire. Any doc still pointing at one is a broken asset the moment the
 * signature lapses — and once it lapses the bytes are unrecoverable, so this
 * script is only useful while the URL is still live. Run it often.
 *
 * Rather than hardcode field names per collection (they differ: `imageUrl`,
 * `imageUrls[]`, `audioUrl`, `url`, `clips[].url`, …), this walks each document
 * recursively and rewrites any string that is an ephemeral URL, wherever it
 * sits. That also repairs docs where a "permanent" field was mistakenly filled
 * with an ephemeral URL (observed on audioGenerations.permanentAudioUrl).
 *
 * Usage:
 *   pnpm tsx scripts/backfill-ephemeral-generations.ts             # dry run
 *   pnpm tsx scripts/backfill-ephemeral-generations.ts --apply     # write
 *   pnpm tsx scripts/backfill-ephemeral-generations.ts --apply --collection videoGenerations
 */
import dotenv from 'dotenv';
import path from 'path';
import { initializeApp, cert, applicationDefault, getApps } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const APPLY = process.argv.includes('--apply');
const colArgIdx = process.argv.indexOf('--collection');
const ONLY_COLLECTION = colArgIdx !== -1 ? process.argv[colArgIdx + 1] : null;

const COLLECTIONS = [
  'videoGenerations',
  'imageGenerations',
  'audioGenerations',
  'mediaAttachments',
  'episodes',
];

// Keep in sync with apps/server/src/lib/rehost-ephemeral.ts
const EPHEMERAL_HOSTS = [
  'volces.com',
  'ark-acg',
  'fal.media',
  'replicate.delivery',
  'pbxt.replicate.delivery',
  'oaidalleapiprodscus.blob.core.windows.net',
  'generativelanguage.googleapis.com', // Google-direct Veo/Gemini Files API — key-scoped, expires
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

// Google's Gemini Files API (Google-direct Veo) scopes downloads to the API
// key that created them — an unauthenticated fetch 403s even on a still-live
// file. Keep in sync with fetchToBuffer's isGeminiFilesHost check
// (apps/server/src/services/storage/types.ts), which the production rehost
// path already goes through.
function geminiAuthHeaders(url: string): Record<string, string> | undefined {
  try {
    if (new URL(url).hostname !== 'generativelanguage.googleapis.com') return undefined;
  } catch {
    return undefined;
  }
  return process.env.GOOGLE_API_KEY ? { 'x-goog-api-key': process.env.GOOGLE_API_KEY } : undefined;
}

function extFor(contentType: string): string {
  if (contentType.includes('mp4') || contentType.includes('video')) return 'mp4';
  if (contentType.includes('png')) return 'png';
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'jpg';
  if (contentType.includes('wav')) return 'wav';
  if (contentType.includes('mpeg') || contentType.includes('mp3')) return 'mp3';
  if (contentType.includes('gltf') || contentType.includes('glb')) return 'glb';
  return 'bin';
}

// ── Firebase init ────────────────────────────────────────────────────
/**
 * The repo `.env` sets FIRESTORE_EMULATOR_HOST for local dev. dotenv.config()
 * above loads it, and firebase-admin silently honours it — so without this
 * guard a "rescue" run would read an empty emulator, report zero work, and
 * look like a success while production kept rotting. Require an explicit
 * --emulator to target the emulator; otherwise strip the var.
 */
function resolveTarget() {
  const wantEmulator = process.argv.includes('--emulator');
  const emuHost = process.env.FIRESTORE_EMULATOR_HOST;
  if (wantEmulator) {
    if (!emuHost) throw new Error('--emulator passed but FIRESTORE_EMULATOR_HOST is not set');
    console.log(`target: EMULATOR ${emuHost}`);
    return;
  }
  if (emuHost) {
    console.log(`(ignoring FIRESTORE_EMULATOR_HOST=${emuHost}; pass --emulator to use it)`);
    delete process.env.FIRESTORE_EMULATOR_HOST;
  }
  console.log('target: PRODUCTION loar-db');
}

function initDb(): Firestore {
  const existing = getApps()[0];
  if (existing) return getFirestore(existing);
  resolveTarget();

  // Prefer an explicit service account; fall back to Application Default
  // Credentials (gcloud auth application-default login) when the configured
  // key has no production access — the checked-in `local-emulator` key does not.
  const saPath = path.resolve(
    process.cwd(),
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? 'firebase-sa-key-20260416.json'
  );
  let credential;
  try {
    const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
      ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
      : JSON.parse(readFileSync(saPath, 'utf-8'));
    if (
      /local-emulator/.test(String(serviceAccount.client_email)) &&
      !process.env.FIRESTORE_EMULATOR_HOST
    ) {
      console.log('(configured key is the local-emulator SA — using ADC instead)');
      credential = applicationDefault();
    } else {
      credential = cert(serviceAccount);
    }
  } catch {
    console.log('(no usable service account file — using ADC)');
    credential = applicationDefault();
  }

  const app = initializeApp({ credential, projectId: 'loar-db' });
  const db = getFirestore(app);
  db.settings({ preferRest: true });
  return db;
}

// ── Fetch + pin ──────────────────────────────────────────────────────
/** url → pinned gateway URL, or null when the source is already dead. */
const pinCache = new Map<string, string | null>();

async function pinFromUrl(url: string, basename: string): Promise<string | null> {
  if (pinCache.has(url)) return pinCache.get(url)!;

  // Dry run must not write to Pinata. Probe liveness only, and report the
  // source as rescuable without actually pinning it.
  if (!APPLY) {
    let alive = false;
    try {
      const res = await fetch(url, {
        redirect: 'follow',
        headers: { Range: 'bytes=0-2047', ...geminiAuthHeaders(url) },
      });
      alive = res.ok;
      if (!alive) console.log(`      source dead (${res.status})`);
    } catch (err) {
      console.log(`      source unreachable (${(err as Error).message})`);
    }
    const placeholder = alive ? `<would pin: ${url.slice(0, 60)}…>` : null;
    pinCache.set(url, placeholder);
    return placeholder;
  }

  const jwt = process.env.PINATA_JWT;
  if (!jwt) {
    console.warn('[backfill] PINATA_JWT not set, cannot pin');
    pinCache.set(url, null);
    return null;
  }

  let result: string | null = null;
  try {
    const res = await fetch(url, { redirect: 'follow', headers: geminiAuthHeaders(url) });
    if (!res.ok) {
      // 403/404 => signature already expired. Nothing to recover.
      console.log(`      source dead (${res.status})`);
      pinCache.set(url, null);
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get('content-type') || 'application/octet-stream';
    const filename = `${basename}.${extFor(contentType)}`;

    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(buf)], { type: contentType }), filename);

    const pinRes = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}` },
      body: form,
    });
    if (!pinRes.ok) {
      console.warn(`      pinata upload failed: ${pinRes.status} ${await pinRes.text()}`);
      pinCache.set(url, null);
      return null;
    }
    const { IpfsHash } = (await pinRes.json()) as { IpfsHash: string };
    const gateway = (process.env.PINATA_GATEWAY_URL || 'https://gateway.pinata.cloud').replace(
      /\/$/,
      ''
    );
    result = `${gateway}/ipfs/${IpfsHash}`;
    console.log(`      pinned ${(buf.length / 1024).toFixed(0)}KB -> ${result}`);
  } catch (err) {
    console.warn(`      pin failed: ${(err as Error).message}`);
    result = null;
  }
  pinCache.set(url, result);
  return result;
}

// ── Deep rewrite ─────────────────────────────────────────────────────
interface WalkStats {
  found: number;
  rewritten: number;
}

/**
 * Recursively copy `value`, replacing ephemeral URL strings with pinned ones.
 * Returns the new value; `stats` accumulates counts. Firestore Timestamps and
 * other class instances are returned by reference so they survive the round trip.
 */
async function rewrite(value: unknown, basename: string, stats: WalkStats): Promise<unknown> {
  if (isEphemeralUrl(value)) {
    stats.found++;
    const pinned = await pinFromUrl(value, basename);
    if (pinned) {
      stats.rewritten++;
      return pinned;
    }
    return value; // leave the dead URL in place; nothing better to put there
  }

  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (const v of value) out.push(await rewrite(v, basename, stats));
    return out;
  }

  // Plain objects only — leave Timestamps/GeoPoints/DocumentReferences alone.
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = await rewrite(v, basename, stats);
    }
    return out;
  }

  return value;
}

async function backfillCollection(db: Firestore, col: string) {
  console.log(`\n━━━ ${col} ━━━`);
  const snap = await db.collection(col).get();
  console.log(`scanning ${snap.size} docs...`);

  let touched = 0;
  let totalFound = 0;
  let totalRewritten = 0;

  for (const doc of snap.docs) {
    const data = doc.data();
    // Cheap pre-filter so we don't deep-walk every document.
    if (!EPHEMERAL_HOSTS.some((h) => JSON.stringify(data).includes(h))) continue;

    console.log(`  ${doc.id}`);
    const stats: WalkStats = { found: 0, rewritten: 0 };
    const next = (await rewrite(data, `${col}-${doc.id}`, stats)) as Record<string, unknown>;

    totalFound += stats.found;
    totalRewritten += stats.rewritten;

    if (stats.rewritten > 0) {
      touched++;
      // Only write the top-level fields that actually changed. A full-document
      // set() would rewrite every field to push a one-URL edit, turning any
      // serialization quirk in an untouched field into data loss.
      const changed: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(next)) {
        if (JSON.stringify(v) !== JSON.stringify(data[k])) changed[k] = v;
      }
      if (APPLY) {
        await doc.ref.update(changed);
        console.log(
          `      WROTE ${stats.rewritten}/${stats.found} url(s) [${Object.keys(changed).join(', ')}]`
        );
      } else {
        console.log(
          `      would write ${stats.rewritten}/${stats.found} url(s) [${Object.keys(changed).join(', ')}]`
        );
      }
    } else if (stats.found > 0) {
      console.log(`      ${stats.found} url(s) unrecoverable`);
    }
  }

  console.log(
    `${col}: ${touched} doc(s) ${APPLY ? 'updated' : 'to update'}, ` +
      `${totalRewritten}/${totalFound} url(s) rescued`
  );
  return { touched, totalFound, totalRewritten };
}

async function main() {
  console.log(APPLY ? '⚠️  APPLY MODE — writing to Firestore' : '🔍 DRY RUN — no writes');
  const db = initDb();

  const cols = ONLY_COLLECTION ? [ONLY_COLLECTION] : COLLECTIONS;
  let found = 0;
  let rescued = 0;
  for (const c of cols) {
    const r = await backfillCollection(db, c);
    found += r.totalFound;
    rescued += r.totalRewritten;
  }

  console.log('\n══════════════════════════════════════');
  console.log(`ephemeral urls found:    ${found}`);
  console.log(`rescued (pinned to IPFS): ${rescued}`);
  console.log(`unrecoverable (expired):  ${found - rescued}`);
  if (!APPLY && rescued > 0) console.log('\nRe-run with --apply to persist.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
