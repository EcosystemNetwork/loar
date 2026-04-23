/**
 * Backfill missing video thumbnails by extracting a frame from each video
 * whose mediaUrl is already pinned on Pinata but whose thumbnailUrl is null.
 *
 * Runs ffmpeg against the HTTPS mediaUrl (with protocol_whitelist to block
 * file:// / concat: tricks), pins the resulting JPEG to Pinata, and writes
 * the gateway URL back to the content doc.
 *
 * Usage:
 *   pnpm tsx scripts/backfill-video-thumbnails.ts             # dry run
 *   pnpm tsx scripts/backfill-video-thumbnails.ts --apply     # write
 *   pnpm tsx scripts/backfill-video-thumbnails.ts --apply --limit 20
 */
import dotenv from 'dotenv';
import path from 'path';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { readFile, unlink } from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const APPLY = process.argv.includes('--apply');
const limitArgIdx = process.argv.indexOf('--limit');
const LIMIT = limitArgIdx !== -1 ? Number(process.argv[limitArgIdx + 1]) : Infinity;

const execFileAsync = promisify(execFile);

function isPermanentUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).host.toLowerCase();
    return host.endsWith('.mypinata.cloud') || host === 'gateway.pinata.cloud';
  } catch {
    return false;
  }
}

function isHttpsUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

const GATEWAY_TOKEN = process.env.PINATA_GATEWAY_TOKEN || '';

/**
 * Produce an ordered list of gateway URLs to try for ffmpeg.
 * Dedicated gateway with token is fastest, but only works for CIDs pinned
 * on *this* Pinata account. For unpinned-here-but-live-on-IPFS CIDs we
 * fall back to public gateways.
 */
function gatewayCandidates(url: string): string[] {
  let cidPath: string | null = null;
  try {
    const parsed = new URL(url);
    if (parsed.host.endsWith('.mypinata.cloud') || parsed.host === 'gateway.pinata.cloud') {
      const m = parsed.pathname.match(/^\/ipfs\/(.+)$/);
      if (m) cidPath = m[1];
    }
  } catch {
    /* noop */
  }

  if (!cidPath) return [url];

  const out: string[] = [];
  if (GATEWAY_TOKEN && url.includes('.mypinata.cloud')) {
    const dedicated = new URL(url);
    dedicated.searchParams.set('pinataGatewayToken', GATEWAY_TOKEN);
    out.push(dedicated.toString());
  }
  out.push(`https://gateway.pinata.cloud/ipfs/${cidPath}`);
  out.push(`https://w3s.link/ipfs/${cidPath}`);
  out.push(`https://ipfs.io/ipfs/${cidPath}`);
  return out;
}

/**
 * Fast HEAD check with a 4s timeout — weeds out dead CIDs before we waste
 * time spinning up ffmpeg. Returns the first gateway URL that responds with
 * a 2xx, or null if none are reachable.
 */
async function findReachableGateway(url: string): Promise<string | null> {
  for (const candidate of gatewayCandidates(url)) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 4000);
      const res = await fetch(candidate, {
        method: 'HEAD',
        redirect: 'follow',
        signal: ctl.signal,
      });
      clearTimeout(t);
      if (res.ok) return candidate;
    } catch {
      /* try next */
    }
  }
  return null;
}

async function extractFrame(videoUrl: string, idHint: string): Promise<Buffer | null> {
  const outPath = join(tmpdir(), `thumb-${idHint}.jpg`);
  const reachable = await findReachableGateway(videoUrl);
  if (!reachable) return null;

  try {
    await execFileAsync(
      'ffmpeg',
      [
        '-y',
        '-protocol_whitelist',
        'https,tls,tcp',
        '-i',
        reachable,
        '-ss',
        '0.5',
        '-frames:v',
        '1',
        '-q:v',
        '2',
        '-vf',
        'scale=640:-1',
        outPath,
      ],
      { timeout: 20000 }
    );
    const buf = await readFile(outPath);
    unlink(outPath).catch(() => {});
    return buf;
  } catch (err) {
    unlink(outPath).catch(() => {});
    console.warn(`  ffmpeg failed for ${idHint}: ${(err as Error).message.slice(0, 80)}`);
    return null;
  }
}

async function pinBuffer(buf: Buffer, filename: string): Promise<string | null> {
  const jwt = process.env.PINATA_JWT;
  if (!jwt) {
    console.warn('[backfill] PINATA_JWT not set');
    return null;
  }
  try {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(buf)], { type: 'image/jpeg' }), filename);
    const res = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}` },
      body: form,
    });
    if (!res.ok) {
      console.warn(`  pin failed ${res.status}`);
      return null;
    }
    const { IpfsHash } = (await res.json()) as { IpfsHash: string };
    const gateway = (process.env.PINATA_GATEWAY_URL || 'https://gateway.pinata.cloud').replace(
      /\/$/,
      ''
    );
    return `${gateway}/ipfs/${IpfsHash}`;
  } catch (err) {
    console.warn('  pin error:', (err as Error).message);
    return null;
  }
}

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

async function main() {
  console.log(`mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);
  if (Number.isFinite(LIMIT)) console.log(`limit: ${LIMIT}`);

  const db = initDb();
  const snap = await db.collection('content').get();
  console.log(`scanning ${snap.size} content docs for video thumbnails...`);

  const candidates = snap.docs.filter((doc) => {
    const d = doc.data();
    const isVideo = d.mediaType === 'video' || d.mediaType === 'ai-video';
    return (
      isVideo &&
      !d.thumbnailUrl &&
      isPermanentUrl(d.mediaUrl as string) &&
      isHttpsUrl(d.mediaUrl as string)
    );
  });
  console.log(`found ${candidates.length} videos needing a thumbnail`);

  const counts = { extracted: 0, pinned: 0, failed: 0 };
  const work = candidates.slice(0, Number.isFinite(LIMIT) ? LIMIT : candidates.length);
  const CONCURRENCY = 4;

  async function processOne(doc: FirebaseFirestore.QueryDocumentSnapshot) {
    const data = doc.data();
    const mediaUrl = data.mediaUrl as string;
    const label = `${doc.id.slice(0, 6)}… ${(data.title || '').slice(0, 40)}`;

    const frame = await extractFrame(mediaUrl, doc.id);
    if (!frame) {
      counts.failed++;
      console.log(`${label}  ✗ no frame`);
      return;
    }
    counts.extracted++;

    const pinned = await pinBuffer(frame, `video-thumb-${doc.id}.jpg`);
    if (!pinned) {
      counts.failed++;
      console.log(`${label}  ✗ pin failed`);
      return;
    }
    counts.pinned++;
    console.log(`${label}  ✓ ${pinned.slice(0, 70)}`);

    if (APPLY) {
      await doc.ref.update({ thumbnailUrl: pinned, updatedAt: new Date() });
    }
  }

  const queue = [...work];
  const workers: Promise<void>[] = [];
  for (let i = 0; i < CONCURRENCY; i++) {
    workers.push(
      (async () => {
        while (queue.length > 0) {
          const doc = queue.shift();
          if (!doc) break;
          await processOne(doc);
        }
      })()
    );
  }
  await Promise.all(workers);

  console.log('\nsummary:', counts);
  console.log('✓ done');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
