/**
 * Re-verify the `mypinata.cloud`-pattern docs that repair-broken-media-urls.ts
 * just hid. That pattern's liveness check races the CID against the public
 * ipfs.io gateway — a single congested gateway with a 5s timeout produced
 * wildly different broken/live counts across two consecutive runs (2123 vs
 * 1677 broken out of the same 2381 candidates), which means real false
 * positives are likely mixed into the last apply. The volces.com/ark-acg
 * (expired presigned URL, "Request has expired" body) and
 * generativelanguage.googleapis.com (401, key-scoped) entries in the same
 * manifest are deterministic dead links and are NOT re-checked here.
 *
 * For each mypinata.cloud doc in the manifest: race the CID against three
 * public gateways with a generous per-gateway timeout; if ANY responds 2xx,
 * treat it as genuinely alive and revert the doc's hide (repointing the
 * mediaUrl/thumbnailUrl/videoUrl fields at the archived original URL and
 * clearing contentStatus back to 'active').
 *
 * Usage:
 *   DRY_RUN=1 pnpm tsx scripts/reverify-pinata-hides.ts <manifest.json>
 *   pnpm tsx scripts/reverify-pinata-hides.ts <manifest.json>
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
import path from 'path';

const DRY_RUN = process.env.DRY_RUN === '1';
const CONCURRENCY = Math.max(1, parseInt(process.env.REVERIFY_CONCURRENCY ?? '6', 10));
const manifestPath = process.argv[2];
if (!manifestPath) {
  console.error('Usage: pnpm tsx scripts/reverify-pinata-hides.ts <manifest.json>');
  process.exit(1);
}

const GATEWAYS = [
  'https://ipfs.io/ipfs/',
  'https://dweb.link/ipfs/',
  'https://gateway.pinata.cloud/ipfs/',
];

function extractCid(url: string): string | null {
  const m = url.match(/\/ipfs\/([a-zA-Z0-9]+)/);
  return m ? m[1] : null;
}

// Race all gateways for one CID; alive if any responds 2xx within its own
// timeout. Each gateway gets its own timeout rather than sharing a deadline
// so a slow-but-alive gateway response isn't starved by a fast-failing one.
async function isAliveAnywhere(
  cid: string,
  timeoutMs = 12000
): Promise<{ alive: boolean; via?: string }> {
  const attempts = GATEWAYS.map(async (gw) => {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), timeoutMs);
    try {
      const r = await fetch(`${gw}${cid}`, {
        method: 'HEAD',
        signal: c.signal,
        redirect: 'follow',
      });
      if (r.status >= 200 && r.status < 300) return gw;
      throw new Error(`status ${r.status}`);
    } finally {
      clearTimeout(t);
    }
  });
  try {
    const via = await Promise.any(attempts);
    return { alive: true, via };
  } catch {
    return { alive: false };
  }
}

async function main() {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as {
    results: Array<{
      docId: string;
      field: string;
      brokenUrl: string;
    }>;
  };

  const pinataRows = manifest.results.filter((r) => r.brokenUrl.includes('mypinata.cloud'));
  console.log(`${manifest.results.length} total hidden rows in manifest`);
  console.log(`${pinataRows.length} are mypinata.cloud rows — re-verifying those\n`);

  const sa = JSON.parse(
    fs.readFileSync(
      process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? 'firebase-sa-key-20260416.json',
      'utf-8'
    )
  );
  const app = initializeApp({ credential: cert(sa) }, `reverify-${Date.now()}`);
  const db = getFirestore(app);
  db.settings({ preferRest: true });

  const reallyAlive: typeof pinataRows = [];
  const confirmedDead: typeof pinataRows = [];
  const queue = [...pinataRows];
  let checked = 0;

  async function worker() {
    while (queue.length) {
      const row = queue.shift();
      if (!row) break;
      const cid = extractCid(row.brokenUrl);
      checked++;
      if (!cid) {
        confirmedDead.push(row);
        continue;
      }
      const { alive, via } = await isAliveAnywhere(cid);
      if (alive) {
        reallyAlive.push(row);
        console.log(`  ALIVE  ${row.docId.slice(0, 8)}  ${row.field}  ${cid}  via ${via}`);
      } else {
        confirmedDead.push(row);
      }
      if (checked % 100 === 0) console.log(`  ...checked ${checked}/${pinataRows.length}`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  console.log(
    `\nRe-verify result: ${reallyAlive.length} were false positives (actually alive), ${confirmedDead.length} confirmed genuinely dead`
  );

  if (DRY_RUN) {
    console.log('\n(DRY_RUN — no writes performed.)');
    return;
  }

  console.log(`\nReverting hide on ${reallyAlive.length} docs...`);
  let done = 0;
  // Group by docId since one doc can have multiple hidden fields (mediaUrl +
  // thumbnailUrl, etc.) all needing the same contentStatus revert but each
  // field restored to its own archived URL.
  const byDoc = new Map<string, typeof reallyAlive>();
  for (const row of reallyAlive) {
    if (!byDoc.has(row.docId)) byDoc.set(row.docId, []);
    byDoc.get(row.docId)!.push(row);
  }
  for (const [docId] of byDoc) {
    try {
      // repair-broken-media-urls.ts's "hide" path never touched the media
      // URL fields themselves — only contentStatus + archival metadata — so
      // reverting is just flipping contentStatus back; no field to restore.
      await db.collection('content').doc(docId).update({
        contentStatus: 'active',
        contentStatusUpdatedAt: new Date(),
        contentStatusUpdatedBy: 'reverify-pinata-hides',
        contentStatusReason: 'false_positive_ipfs.io_gateway_flakiness_confirmed_alive_on_recheck',
      });
      done++;
    } catch (err) {
      console.error(`  revert ${docId} failed:`, err);
    }
  }
  console.log(`  ${done}/${byDoc.size} docs reverted`);

  const backupPath = path.resolve(process.cwd(), `reverify-pinata-hides-${Date.now()}.json`);
  fs.writeFileSync(backupPath, JSON.stringify({ reallyAlive, confirmedDead }, null, 2));
  console.log(`\nBackup manifest: ${backupPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('REVERIFY FAILED:', err);
    process.exit(1);
  });
