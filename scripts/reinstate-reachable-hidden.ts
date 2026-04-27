/**
 * Phase 1 — flip contentStatus from 'hidden' to 'reinstated' for content docs
 * whose mediaUrl HEADs as 200 across the IPFS gateways. The original hide
 * was done by `backfill-hide-unreachable.ts` based on a stale snapshot; the
 * URLs work now. We log this as a retroactive admin reinstate.
 *
 * Usage:
 *   pnpm tsx scripts/reinstate-reachable-hidden.ts                # dry-run
 *   pnpm tsx scripts/reinstate-reachable-hidden.ts --apply        # write
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

function cidPathFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const m = u.pathname.match(/^\/ipfs\/(.+)$/);
    if (m) return m[1];
    const sub = u.host.match(/^([^.]+)\.ipfs\./);
    if (sub) {
      const rest = u.pathname.replace(/^\//, '');
      return rest ? `${sub[1]}/${rest}` : sub[1];
    }
  } catch {
    /* noop */
  }
  return null;
}

function candidates(url: string): string[] {
  const cid = cidPathFromUrl(url);
  if (!cid) return [url];
  const out: string[] = [];
  if (GATEWAY_TOKEN && url.includes('.mypinata.cloud')) {
    const u = new URL(url);
    u.searchParams.set('pinataGatewayToken', GATEWAY_TOKEN);
    out.push(u.toString());
  }
  out.push(`https://gateway.pinata.cloud/ipfs/${cid}`);
  out.push(`https://w3s.link/ipfs/${cid}`);
  out.push(`https://ipfs.io/ipfs/${cid}`);
  return out;
}

async function headOk(url: string): Promise<boolean> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 6000);
    const res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: ctl.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

async function reachable(url: string): Promise<{ ok: boolean; via: string | null }> {
  for (const c of candidates(url)) {
    if (await headOk(c)) return { ok: true, via: c };
  }
  return { ok: false, via: null };
}

async function main() {
  const existing = getApps()[0];
  let db;
  if (existing) {
    db = getFirestore(existing);
  } else {
    const sa = JSON.parse(readFileSync('firebase-sa-key-20260416.json', 'utf-8'));
    const app = initializeApp({ credential: cert(sa) });
    db = getFirestore(app);
    db.settings({ preferRest: true });
  }

  const snap = await db.collection('content').where('contentStatus', '==', 'hidden').get();
  const docs = snap.docs;
  console.log(`scanning ${docs.length} hidden docs…`);

  const queue = [...docs];
  const reachableDocs: typeof docs = [];

  async function worker() {
    while (queue.length) {
      const doc = queue.shift();
      if (!doc) break;
      const data = doc.data() as any;
      if (!data.mediaUrl) continue;
      const r = await reachable(data.mediaUrl);
      if (r.ok) reachableDocs.push(doc);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  console.log(`${reachableDocs.length} of ${docs.length} are reachable now.`);

  if (!APPLY) {
    console.log('dry-run — re-run with --apply to flip status');
    return;
  }

  let writes = 0;
  const now = new Date().toISOString();
  // Audit log + content.update batched 200 at a time (Firestore batch limit).
  let batch = db.batch();
  let batchCount = 0;
  for (const doc of reachableDocs) {
    batch.update(doc.ref, {
      contentStatus: 'reinstated',
      contentStatusUpdatedAt: now,
      contentStatusUpdatedBy: 'admin:retroactive-reinstate-phase1',
      contentStatusReason: 'reachable on IPFS gateway after re-check 2026-04-27',
    });
    const auditRef = db.collection('contentAuditLog').doc();
    batch.set(auditRef, {
      contentId: doc.id,
      action: 'reinstate',
      previousStatus: 'hidden',
      newStatus: 'reinstated',
      reason: 'reachable on IPFS gateway after re-check 2026-04-27',
      actor: 'admin:retroactive-reinstate-phase1',
      createdAt: now,
    });
    batchCount += 2;
    writes++;
    if (batchCount >= 400) {
      await batch.commit();
      batch = db.batch();
      batchCount = 0;
    }
  }
  if (batchCount > 0) await batch.commit();
  console.log(`reinstated ${writes} docs (with audit log)`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
