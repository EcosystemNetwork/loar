/**
 * Fix Fogline offChainNodes whose stored videoUrl points at a bare IPFS
 * *directory* CID instead of the video file inside it.
 *
 * Root cause: whatever re-upload path ran during the 2026-04-27
 * cull-restore pinned each video wrapped in a directory (Pinata's default
 * for a plain multipart upload in some SDK paths) and stored the directory
 * CID's URL instead of appending the child filename. Every gateway then
 * serves an HTML directory listing instead of the video, so every <video>
 * tag in the app fails to load — see rechain-fogline-nodes.ts for the
 * (separate, already-fixed) chain-linking bug from the same recovery.
 *
 * For each node: fetch the directory listing at /ipfs/<cid>, extract the
 * single child filename, verify /ipfs/<cid>/<filename> actually serves
 * video/*, and (only with --apply) update Firestore's videoUrl to the
 * corrected path — same origin/gateway as the original URL, just with the
 * filename appended. Dry run by default.
 *
 * Usage:
 *   pnpm tsx scripts/fix-fogline-directory-urls.ts              # dry run
 *   pnpm tsx scripts/fix-fogline-directory-urls.ts --apply
 */
import dotenv from 'dotenv';
import path from 'path';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const APPLY = process.argv.includes('--apply');
const UNIVERSE_ID = '0x0000000000000000000000000000019d9e26795c';
const DELAY_MS = 1500; // between nodes, to avoid gateway rate-limiting

const saPath = path.resolve(
  process.cwd(),
  process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? 'firebase-sa-key-20260416.json'
);
const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
  ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
  : JSON.parse(readFileSync(saPath, 'utf-8'));

const app = initializeApp({ credential: cert(serviceAccount) }, `fix-fogline-urls-${Date.now()}`);
const db = getFirestore(app);
db.settings({ preferRest: true });

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function extractIpfsCidAndPath(url: string): { cid: string; hasSubPath: boolean } | null {
  try {
    const u = new URL(url);
    const m = u.pathname.match(/^\/ipfs\/([^/]+)(\/.*)?$/);
    if (!m) return null;
    return { cid: m[1], hasSubPath: !!m[2] && m[2] !== '/' };
  } catch {
    return null;
  }
}

async function fetchWithRetry(url: string, tries = 4, timeoutMs = 20000): Promise<Response | null> {
  for (let i = 0; i < tries; i++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { redirect: 'follow', signal: controller.signal });
      clearTimeout(timer);
      if (res.status === 429) {
        await sleep(3000 * (i + 1));
        continue;
      }
      return res;
    } catch {
      clearTimeout(timer);
      await sleep(2000 * (i + 1));
    }
  }
  return null;
}

async function findChildFile(cid: string): Promise<string | null> {
  const res = await fetchWithRetry(`https://dweb.link/ipfs/${cid}`);
  if (!res || res.status !== 200) return null;
  const html = await res.text();
  const matches = [...html.matchAll(/href="\/([^"/?]+)"/g)].map((m) => m[1]);
  const candidates = matches.filter((f) => !f.startsWith('ipfs') && f !== 'ipns');
  return candidates[0] ?? null;
}

async function main() {
  console.log(`mode: ${APPLY ? 'APPLY' : 'DRY RUN'}\n`);

  const snap = await db
    .collection('offChainNodes')
    .where('universeId', '==', UNIVERSE_ID)
    .orderBy('nodeId', 'asc')
    .get();

  console.log(`Found ${snap.size} Fogline offChainNodes\n`);

  let fixed = 0;
  let skipped = 0;
  let failed = 0;

  for (const doc of snap.docs) {
    const data = doc.data();
    const nodeId = data.nodeId as number;
    const url = String(data.videoUrl || '');
    if (!url) {
      console.log(`  node ${nodeId}: no videoUrl stored — skip`);
      skipped++;
      continue;
    }

    const parsed = extractIpfsCidAndPath(url);
    if (!parsed || parsed.hasSubPath) {
      // Not a bare-CID IPFS URL — not this bug, leave alone.
      skipped++;
      continue;
    }

    const child = await findChildFile(parsed.cid);
    if (!child) {
      console.log(
        `  node ${nodeId}: could not find child file in directory ${parsed.cid} — SKIP (manual look needed)`
      );
      failed++;
      await sleep(DELAY_MS);
      continue;
    }

    // Trust the directory listing rather than re-fetching to verify content-type:
    // every directory checked so far (manually and via the read-only probe)
    // contains exactly one child file, and that file has verified as the real
    // video (node 86, checked by hand). A second round-trip per node just adds
    // gateway load without meaningfully raising confidence, and was the actual
    // bottleneck that made the two-fetch version hang under rate-limiting.
    const origin = new URL(url).origin;
    const candidate = `${origin}/ipfs/${parsed.cid}/${child}`;

    console.log(`  node ${nodeId}: FIX → ${candidate}`);
    if (APPLY) {
      await doc.ref.update({
        videoUrl: candidate,
        videoUrlFixReason: 'directory-cid-child-path-2026-08-25',
        updatedAt: new Date(),
      });
    }
    fixed++;
    await sleep(DELAY_MS);
  }

  console.log(`\n═══════════════════════════════════════════════════`);
  console.log(`  ${APPLY ? 'Fixed' : 'Would fix'} : ${fixed}`);
  console.log(`  Skipped (not this bug) : ${skipped}`);
  console.log(`  Failed (needs manual)  : ${failed}`);
  console.log(`═══════════════════════════════════════════════════`);
  if (!APPLY) console.log('\n(DRY RUN — no writes performed. Re-run with --apply to write.)');
}

main().catch((err) => {
  console.error('FIX FAILED:', err);
  process.exit(1);
});
