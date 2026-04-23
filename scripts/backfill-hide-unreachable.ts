/**
 * Hide content whose mediaUrl is unreachable across all known gateways.
 *
 * Some content docs point at Pinata-gateway URLs whose CIDs were never
 * actually pinned on our account (or on any public IPFS replica). The
 * gateway host-check alone isn't sufficient — a `.mypinata.cloud` URL
 * can still 403 with our token if the CID isn't pinned here.
 *
 * For every content doc whose mediaUrl fails HEAD across dedicated (with
 * token) + public Pinata + w3s.link + ipfs.io, we mark
 * `contentStatus: 'hidden'` so it stops surfacing in feeds. The record
 * stays (no deletion) so admins can reinstate or audit.
 *
 * Usage:
 *   pnpm tsx scripts/backfill-hide-unreachable.ts              # dry run
 *   pnpm tsx scripts/backfill-hide-unreachable.ts --apply      # write
 *   pnpm tsx scripts/backfill-hide-unreachable.ts --apply --limit 50
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

const GATEWAY_TOKEN = process.env.PINATA_GATEWAY_TOKEN || '';
const CONCURRENCY = 8;

function cidPathFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const m = parsed.pathname.match(/^\/ipfs\/(.+)$/);
    if (m) return m[1];
    // subdomain form: <cid>.ipfs.dweb.link/path
    const sub = parsed.host.match(/^([^.]+)\.ipfs\./);
    if (sub) {
      const rest = parsed.pathname.replace(/^\//, '');
      return rest ? `${sub[1]}/${rest}` : sub[1];
    }
  } catch {
    /* noop */
  }
  return null;
}

function candidates(url: string): string[] {
  const cidPath = cidPathFromUrl(url);
  if (!cidPath) return [url];
  const out: string[] = [];
  if (GATEWAY_TOKEN && url.includes('.mypinata.cloud')) {
    const u = new URL(url);
    u.searchParams.set('pinataGatewayToken', GATEWAY_TOKEN);
    out.push(u.toString());
  }
  out.push(`https://gateway.pinata.cloud/ipfs/${cidPath}`);
  out.push(`https://w3s.link/ipfs/${cidPath}`);
  out.push(`https://ipfs.io/ipfs/${cidPath}`);
  return out;
}

async function headOk(url: string): Promise<boolean> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 5000);
    const res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: ctl.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

async function isReachable(url: string): Promise<boolean> {
  for (const candidate of candidates(url)) {
    if (await headOk(candidate)) return true;
  }
  return false;
}

function initDb(): Firestore {
  const existing = getApps()[0];
  if (existing) return getFirestore(existing);
  const sa = JSON.parse(
    readFileSync(
      process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? 'firebase-sa-key-20260416.json',
      'utf-8'
    )
  );
  const app = initializeApp({ credential: cert(sa) });
  const db = getFirestore(app);
  db.settings({ preferRest: true });
  return db;
}

async function main() {
  console.log(`mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);
  if (Number.isFinite(LIMIT)) console.log(`limit: ${LIMIT}`);

  const db = initDb();
  const snap = await db.collection('content').get();
  console.log(`scanning ${snap.size} content docs...`);

  // Only check docs that are currently active. No point HEADing already-hidden.
  const candidateDocs = snap.docs.filter((d) => {
    const data = d.data();
    const status = data.contentStatus || 'active';
    return (
      (status === 'active' || status === 'reinstated') &&
      typeof data.mediaUrl === 'string' &&
      data.mediaUrl.startsWith('https://')
    );
  });
  console.log(`${candidateDocs.length} active docs with https mediaUrl`);

  const counts = { reachable: 0, hidden: 0 };
  const queue = candidateDocs.slice(0, Number.isFinite(LIMIT) ? LIMIT : candidateDocs.length);

  async function worker() {
    while (queue.length > 0) {
      const doc = queue.shift();
      if (!doc) break;
      const data = doc.data();
      const reachable = await isReachable(data.mediaUrl);
      if (reachable) {
        counts.reachable++;
        continue;
      }
      counts.hidden++;
      console.log(
        `  ${doc.id.slice(0, 6)}… (${data.mediaType || '?'}) ${(data.title || '').slice(0, 40)}  → HIDDEN`
      );
      if (APPLY) {
        await doc.ref.update({
          contentStatus: 'hidden',
          contentStatusUpdatedAt: new Date().toISOString(),
          contentStatusUpdatedBy: 'backfill:unreachable-media',
          contentStatusReason: 'mediaUrl not reachable on any IPFS gateway',
        });
      }
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
