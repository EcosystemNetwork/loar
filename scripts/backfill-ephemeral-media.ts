/**
 * Backfill ephemeral media URLs across `content` and `entities` collections.
 *
 * After-launch the gallery pipeline started rehosting provider CDN URLs
 * (fal.media, volces.com, replicate.delivery, etc.) to Pinata, but existing
 * docs still point at expired signed URLs that 403 in the browser.
 *
 * For each doc:
 *   - If the ephemeral URL is still live (<24h old), re-download and pin.
 *   - If it's already expired (403/404), fall back:
 *       content  → set thumbnailUrl = mediaUrl when mediaUrl is permanent,
 *                  else null (UI shows placeholder).
 *       entities → null the imageUrl (no way to recover the image).
 *
 * Usage:
 *   pnpm tsx scripts/backfill-ephemeral-media.ts              # dry run, reports
 *   pnpm tsx scripts/backfill-ephemeral-media.ts --apply      # actually write
 *   pnpm tsx scripts/backfill-ephemeral-media.ts --apply --limit 20
 */
import dotenv from 'dotenv';
import path from 'path';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const APPLY = process.argv.includes('--apply');
const limitArgIdx = process.argv.indexOf('--limit');
const LIMIT = limitArgIdx !== -1 ? Number(process.argv[limitArgIdx + 1]) : Infinity;

const EPHEMERAL_HOSTS = [
  'volces.com',
  'fal.media',
  'replicate.delivery',
  'pbxt.replicate.delivery',
  'oaidalleapiprodscus.blob.core.windows.net',
  'ark-acg',
];

function isEphemeralUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).host.toLowerCase();
    return EPHEMERAL_HOSTS.some((ep) => host.includes(ep));
  } catch {
    return false;
  }
}

function isPermanentUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).host.toLowerCase();
    return host.endsWith('.mypinata.cloud') || host === 'gateway.pinata.cloud';
  } catch {
    return false;
  }
}

async function headOk(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    return res.ok;
  } catch {
    return false;
  }
}

// ── Firebase init ────────────────────────────────────────────────────
function initDb(): Firestore {
  const existing = getApps()[0];
  if (existing) return getFirestore(existing);
  const saPath = path.resolve(
    process.cwd(),
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? 'firebase-sa-key-20260416.json'
  );
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    : JSON.parse(readFileSync(saPath, 'utf-8'));
  const app = initializeApp({ credential: cert(serviceAccount) });
  const db = getFirestore(app);
  db.settings({ preferRest: true });
  return db;
}

// ── Pinata upload (direct — avoids pulling in the whole server) ──────
async function pinFromUrl(url: string, filename: string): Promise<string | null> {
  const jwt = process.env.PINATA_JWT;
  if (!jwt) {
    console.warn('[backfill] PINATA_JWT not set, cannot pin');
    return null;
  }

  try {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get('content-type') || 'application/octet-stream';

    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(buf)], { type: contentType }), filename);

    const pinRes = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}` },
      body: form,
    });
    if (!pinRes.ok) {
      console.warn(`[backfill] pinata upload failed: ${pinRes.status}`);
      return null;
    }
    const { IpfsHash } = (await pinRes.json()) as { IpfsHash: string };
    const gateway = (process.env.PINATA_GATEWAY_URL || 'https://gateway.pinata.cloud').replace(
      /\/$/,
      ''
    );
    return `${gateway}/ipfs/${IpfsHash}`;
  } catch (err) {
    console.warn(`[backfill] pin failed for ${url.slice(0, 60)}:`, (err as Error).message);
    return null;
  }
}

// ── Content backfill ────────────────────────────────────────────────
interface ContentPlan {
  mediaUpdate?: { kind: 'pin' | 'null'; value: string | null };
  thumbUpdate?: { kind: 'pin' | 'copy-media' | 'null'; value: string | null };
}

async function planContentDoc(
  id: string,
  data: Record<string, unknown>
): Promise<ContentPlan | null> {
  const mediaUrl = data.mediaUrl as string | undefined;
  const thumbnailUrl = data.thumbnailUrl as string | undefined;
  const mediaType = data.mediaType as string | undefined;

  const mediaEphemeral = isEphemeralUrl(mediaUrl);
  const thumbEphemeral = isEphemeralUrl(thumbnailUrl);
  if (!mediaEphemeral && !thumbEphemeral) return null;

  const plan: ContentPlan = {};
  let newMedia = mediaUrl;

  if (mediaEphemeral && mediaUrl) {
    const live = await headOk(mediaUrl);
    if (live) {
      const ext = mediaType?.includes('image') ? 'png' : 'mp4';
      const pinned = await pinFromUrl(mediaUrl, `content-${id}.${ext}`);
      if (pinned) {
        plan.mediaUpdate = { kind: 'pin', value: pinned };
        newMedia = pinned;
      }
    }
  }

  if (thumbEphemeral && thumbnailUrl) {
    const live = await headOk(thumbnailUrl);
    if (live) {
      const pinned = await pinFromUrl(thumbnailUrl, `content-${id}-thumb.jpg`);
      if (pinned) {
        plan.thumbUpdate = { kind: 'pin', value: pinned };
      } else if (isPermanentUrl(newMedia) && mediaType?.includes('image')) {
        plan.thumbUpdate = { kind: 'copy-media', value: newMedia! };
      } else {
        plan.thumbUpdate = { kind: 'null', value: null };
      }
    } else if (isPermanentUrl(newMedia) && mediaType?.includes('image')) {
      plan.thumbUpdate = { kind: 'copy-media', value: newMedia! };
    } else {
      plan.thumbUpdate = { kind: 'null', value: null };
    }
  }

  // If nothing could be recovered, still record that we inspected this doc
  // (no updates). Callers can log "skip" based on empty plan.
  if (!plan.mediaUpdate && !plan.thumbUpdate) return null;
  return plan;
}

async function backfillContent(db: Firestore) {
  console.log('\n━━━ content ━━━');
  const snap = await db.collection('content').get();
  console.log(`scanning ${snap.size} content docs...`);

  let processed = 0;
  const counts = {
    pinMedia: 0,
    pinThumb: 0,
    copyMedia: 0,
    nullThumb: 0,
    clean: 0,
    dead: 0,
  };

  for (const doc of snap.docs) {
    if (processed >= LIMIT) break;
    const data = doc.data();
    const plan = await planContentDoc(doc.id, data);
    if (!plan) {
      if (isEphemeralUrl(data.mediaUrl as string) || isEphemeralUrl(data.thumbnailUrl as string)) {
        counts.dead++;
      } else {
        counts.clean++;
      }
      continue;
    }
    processed++;

    const update: Record<string, unknown> = { updatedAt: new Date() };
    const labels: string[] = [];

    if (plan.mediaUpdate) {
      update.mediaUrl = plan.mediaUpdate.value;
      counts.pinMedia++;
      labels.push(`pin-media → ${(plan.mediaUpdate.value || '').slice(0, 60)}`);
    }
    if (plan.thumbUpdate) {
      update.thumbnailUrl = plan.thumbUpdate.value;
      if (plan.thumbUpdate.kind === 'pin') {
        counts.pinThumb++;
        labels.push(`pin-thumb → ${(plan.thumbUpdate.value || '').slice(0, 60)}`);
      } else if (plan.thumbUpdate.kind === 'copy-media') {
        counts.copyMedia++;
        labels.push(`copy-media-to-thumb`);
      } else {
        counts.nullThumb++;
        labels.push(`null-thumb (expired)`);
      }
    }

    console.log(`  ${doc.id.slice(0, 6)}… ${labels.join(', ')}`);
    if (APPLY) {
      await doc.ref.update(update);
    }
  }

  console.log('\nsummary:', counts);
}

// ── Entity backfill ─────────────────────────────────────────────────
async function backfillEntities(db: Firestore) {
  console.log('\n━━━ entities ━━━');
  const snap = await db.collection('entities').get();
  console.log(`scanning ${snap.size} entity docs...`);

  let processed = 0;
  const counts = { pinned: 0, nulled: 0, clean: 0 };

  for (const doc of snap.docs) {
    if (processed >= LIMIT) break;
    const data = doc.data();
    const imageUrl = data.imageUrl as string | undefined;
    if (!isEphemeralUrl(imageUrl)) {
      counts.clean++;
      continue;
    }
    processed++;

    const live = await headOk(imageUrl!);
    if (live) {
      const pinned = await pinFromUrl(imageUrl!, `entity-${doc.id}.jpg`);
      if (pinned) {
        console.log(`  ${doc.id.slice(0, 6)}… (${data.kind}) pinned → ${pinned.slice(0, 70)}`);
        counts.pinned++;
        if (APPLY) {
          await doc.ref.update({ imageUrl: pinned, updatedAt: new Date() });
        }
        continue;
      }
    }
    console.log(
      `  ${doc.id.slice(0, 6)}… (${data.kind}) nulled — expired (${(imageUrl || '').slice(0, 60)})`
    );
    counts.nulled++;
    if (APPLY) {
      await doc.ref.update({ imageUrl: null, updatedAt: new Date() });
    }
  }

  console.log('\nsummary:', counts);
}

// ── Main ─────────────────────────────────────────────────────────────
async function main() {
  console.log(`mode: ${APPLY ? 'APPLY (writes to Firestore)' : 'DRY RUN (no writes)'}`);
  if (Number.isFinite(LIMIT)) console.log(`limit: ${LIMIT} per collection`);

  const db = initDb();
  await backfillContent(db);
  await backfillEntities(db);

  console.log('\n✓ done');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
