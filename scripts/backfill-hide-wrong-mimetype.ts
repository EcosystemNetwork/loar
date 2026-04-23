/**
 * Hide content whose mediaUrl resolves to a non-matching MIME type.
 *
 * Some Fogline/Dostopia docs have CIDs that 200 on public gateways but
 * serve HTML (directory listings) instead of the actual video. ffmpeg
 * can't extract thumbnails from those, and users see broken video cards.
 *
 * For every ai-video / video content doc, HEAD the mediaUrl. If the
 * content-type doesn't start with `video/`, mark the doc `contentStatus:
 * 'hidden'` with a specific reason.
 *
 * Usage:
 *   pnpm tsx scripts/backfill-hide-wrong-mimetype.ts              # dry run
 *   pnpm tsx scripts/backfill-hide-wrong-mimetype.ts --apply
 */
import dotenv from 'dotenv';
import path from 'path';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const APPLY = process.argv.includes('--apply');
const GATEWAY_TOKEN = process.env.PINATA_GATEWAY_TOKEN || '';
const CONCURRENCY = 8;

function cidFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const m = parsed.pathname.match(/^\/ipfs\/(.+)$/);
    if (m) return m[1];
  } catch {
    /* noop */
  }
  return null;
}

async function probeContentType(url: string): Promise<string | null> {
  const candidates: string[] = [];
  const cid = cidFromUrl(url);
  if (GATEWAY_TOKEN && url.includes('.mypinata.cloud')) {
    const u = new URL(url);
    u.searchParams.set('pinataGatewayToken', GATEWAY_TOKEN);
    candidates.push(u.toString());
  }
  if (cid) {
    candidates.push(`https://gateway.pinata.cloud/ipfs/${cid}`);
    candidates.push(`https://w3s.link/ipfs/${cid}`);
  } else {
    candidates.push(url);
  }

  for (const c of candidates) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 6000);
      const res = await fetch(c, { method: 'HEAD', redirect: 'follow', signal: ctl.signal });
      clearTimeout(t);
      if (res.ok) {
        return (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      }
    } catch {
      /* try next */
    }
  }
  return null;
}

async function main() {
  console.log(`mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);

  const sa = JSON.parse(readFileSync('firebase-sa-key-20260416.json', 'utf-8'));
  const app = getApps()[0] || initializeApp({ credential: cert(sa) });
  const db = getFirestore(app);
  db.settings({ preferRest: true });

  const snap = await db.collection('content').get();
  const candidates = snap.docs.filter((d) => {
    const data = d.data();
    const status = data.contentStatus || 'active';
    const isVideo = data.mediaType === 'video' || data.mediaType === 'ai-video';
    return (
      isVideo &&
      (status === 'active' || status === 'reinstated') &&
      typeof data.mediaUrl === 'string' &&
      data.mediaUrl.startsWith('https://')
    );
  });
  console.log(`\n${candidates.length} active video docs with https mediaUrl`);

  const counts = { ok: 0, wrongMime: 0, unreachable: 0 };
  const queue = [...candidates];

  async function worker() {
    while (queue.length > 0) {
      const doc = queue.shift();
      if (!doc) break;
      const data = doc.data();
      const ct = await probeContentType(data.mediaUrl);

      if (ct === null) {
        counts.unreachable++;
        console.log(
          `  ${doc.id.slice(0, 6)}… (no ct) UNREACHABLE — ${(data.title || '').slice(0, 40)}`
        );
        if (APPLY) {
          await doc.ref.update({
            contentStatus: 'hidden',
            contentStatusUpdatedAt: new Date().toISOString(),
            contentStatusUpdatedBy: 'backfill:wrong-mimetype',
            contentStatusReason: 'video mediaUrl unreachable',
          });
        }
        continue;
      }
      if (!ct.startsWith('video/') && ct !== 'application/octet-stream') {
        counts.wrongMime++;
        console.log(
          `  ${doc.id.slice(0, 6)}… ct=${ct} NOT-VIDEO — ${(data.title || '').slice(0, 40)}`
        );
        if (APPLY) {
          await doc.ref.update({
            contentStatus: 'hidden',
            contentStatusUpdatedAt: new Date().toISOString(),
            contentStatusUpdatedBy: 'backfill:wrong-mimetype',
            contentStatusReason: `video mediaUrl content-type=${ct} (not video)`,
          });
        }
        continue;
      }
      counts.ok++;
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log('\nsummary:', counts);
  console.log('✓ done');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
