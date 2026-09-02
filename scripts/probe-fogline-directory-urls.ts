/**
 * Read-only probe: for every Fogline offChainNode, check whether its stored
 * videoUrl points at a bare IPFS *directory* CID (serves an HTML directory
 * listing instead of the video — every <video> tag fails to load it) rather
 * than the actual file inside that directory.
 *
 * Makes no writes. Prints a report of affected node IDs plus the corrected
 * URL (gateway + CID + child filename) for each, so a follow-up fix script
 * can target exactly those nodes.
 *
 * Usage:
 *   pnpm tsx scripts/probe-fogline-directory-urls.ts
 */
import dotenv from 'dotenv';
import path from 'path';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const UNIVERSE_ID = '0x0000000000000000000000000000019d9e26795c';

const saPath = path.resolve(
  process.cwd(),
  process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? `${process.env.HOME}/.config/loar/loar-db-sa.json`
);
const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
  ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
  : JSON.parse(readFileSync(saPath, 'utf-8'));

const app = initializeApp({ credential: cert(serviceAccount) }, `probe-fogline-${Date.now()}`);
const db = getFirestore(app);
db.settings({ preferRest: true });

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

async function probe(
  url: string,
  timeoutMs = 15000
): Promise<{ status: number; contentType: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { redirect: 'follow', signal: controller.signal });
    return { status: res.status, contentType: res.headers.get('content-type') || '' };
  } catch (e) {
    return { status: 0, contentType: `ERROR: ${(e as Error).message}` };
  } finally {
    clearTimeout(timer);
  }
}

async function findChildFile(cid: string): Promise<string | null> {
  const res = await probe(`https://dweb.link/ipfs/${cid}`);
  if (res.status !== 200) return null;
  const html = await (await fetch(`https://dweb.link/ipfs/${cid}`)).text();
  // Directory listing links look like: href="/<filename>"
  const matches = [...html.matchAll(/href="\/([^"/?]+)"/g)].map((m) => m[1]);
  const candidates = matches.filter((f) => !f.startsWith('ipfs') && f !== 'ipns');
  return candidates[0] ?? null;
}

async function main() {
  const snap = await db
    .collection('offChainNodes')
    .where('universeId', '==', UNIVERSE_ID)
    .orderBy('nodeId', 'asc')
    .get();

  console.log(`Probing ${snap.size} Fogline offChainNodes...\n`);

  const broken: Array<{ nodeId: number; docId: string; oldUrl: string; fixedUrl: string | null }> =
    [];
  const ok: number[] = [];
  const unknown: Array<{ nodeId: number; url: string; status: number; contentType: string }> = [];

  for (const doc of snap.docs) {
    const data = doc.data();
    const nodeId = data.nodeId as number;
    const url = String(data.videoUrl || '');
    if (!url) {
      unknown.push({ nodeId, url, status: 0, contentType: 'NO URL STORED' });
      continue;
    }

    const parsed = extractIpfsCidAndPath(url);
    if (!parsed) {
      // Not a recognizable /ipfs/<cid> URL — probe directly.
      const res = await probe(url);
      if (res.status === 200 && res.contentType.startsWith('video/')) {
        ok.push(nodeId);
      } else {
        unknown.push({ nodeId, url, status: res.status, contentType: res.contentType });
      }
      continue;
    }

    if (parsed.hasSubPath) {
      // Already has a sub-path — probe as-is.
      const res = await probe(url);
      if (res.status === 200 && res.contentType.startsWith('video/')) {
        ok.push(nodeId);
      } else {
        unknown.push({ nodeId, url, status: res.status, contentType: res.contentType });
      }
      continue;
    }

    // Bare CID — probe it directly first (some bare CIDs ARE the file, not a dir).
    const bareRes = await probe(`https://dweb.link/ipfs/${parsed.cid}`);
    if (bareRes.status === 200 && bareRes.contentType.startsWith('video/')) {
      ok.push(nodeId);
      continue;
    }
    if (bareRes.contentType.includes('text/html')) {
      // Directory listing — find the child file.
      const child = await findChildFile(parsed.cid);
      let fixedUrl: string | null = null;
      if (child) {
        const candidate = `https://dweb.link/ipfs/${parsed.cid}/${child}`;
        const childRes = await probe(candidate);
        if (childRes.status === 200 && childRes.contentType.startsWith('video/')) {
          fixedUrl = `${new URL(url).origin}/ipfs/${parsed.cid}/${child}`;
        }
      }
      broken.push({ nodeId, docId: doc.id, oldUrl: url, fixedUrl });
      console.log(
        `  node ${nodeId}: DIRECTORY CID — child="${child ?? '???'}" fixedUrl=${fixedUrl ?? 'COULD NOT VERIFY'}`
      );
    } else {
      unknown.push({ nodeId, url, status: bareRes.status, contentType: bareRes.contentType });
      console.log(`  node ${nodeId}: UNKNOWN status=${bareRes.status} type=${bareRes.contentType}`);
    }
  }

  console.log(`\n═══════════════════════════════════════════════════`);
  console.log(`  OK (video loads fine)        : ${ok.length}`);
  console.log(`  BROKEN (directory-wrapped)    : ${broken.length}`);
  console.log(`    — fixable (child found)     : ${broken.filter((b) => b.fixedUrl).length}`);
  console.log(`    — needs manual look         : ${broken.filter((b) => !b.fixedUrl).length}`);
  console.log(`  UNKNOWN (other failure mode)  : ${unknown.length}`);
  console.log(`═══════════════════════════════════════════════════`);

  if (broken.length > 0) {
    console.log(`\nBroken node IDs: ${broken.map((b) => b.nodeId).join(', ')}`);
  }
  if (unknown.length > 0) {
    console.log(`\nUnknown-status nodes:`);
    for (const u of unknown)
      console.log(
        `  node ${u.nodeId}: status=${u.status} type=${u.contentType} url=${u.url.slice(0, 100)}`
      );
  }
}

main().catch((err) => {
  console.error('PROBE FAILED:', err);
  process.exit(1);
});
