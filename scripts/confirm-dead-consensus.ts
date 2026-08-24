/**
 * Final consensus check for the docs still marked contentStatus='hidden'
 * after reverify-pinata-hides.ts. Liveness checks against these public
 * gateways have proven noisy run-to-run (2123→1677→711-alive→1214-alive
 * across four consecutive passes on the same candidate set), so a single
 * pass — however many gateways it races — isn't trustworthy evidence of
 * "genuinely dead." This runs N independent rounds, with a real pause
 * between them so transient congestion has a chance to clear, and only
 * treats a doc as confirmed-dead if it fails to resolve on EVERY round.
 * Anything alive on even one round gets its hide reverted immediately.
 *
 * Usage:
 *   DRY_RUN=1 pnpm tsx scripts/confirm-dead-consensus.ts <manifest.json>
 *   pnpm tsx scripts/confirm-dead-consensus.ts <manifest.json>
 *
 * <manifest.json> must have a `confirmedDead` array of {docId, field, brokenUrl}.
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
import path from 'path';

const DRY_RUN = process.env.DRY_RUN === '1';
const CONCURRENCY = Math.max(1, parseInt(process.env.CONSENSUS_CONCURRENCY ?? '4', 10));
const ROUNDS = Math.max(1, parseInt(process.env.CONSENSUS_ROUNDS ?? '3', 10));
const ROUND_GAP_MS = 15000;
const manifestPath = process.argv[2];
if (!manifestPath) {
  console.error('Usage: pnpm tsx scripts/confirm-dead-consensus.ts <manifest.json>');
  process.exit(1);
}

const GATEWAYS = [
  'https://ipfs.io/ipfs/',
  'https://dweb.link/ipfs/',
  'https://gateway.pinata.cloud/ipfs/',
  'https://w3s.link/ipfs/',
];

function extractCid(url: string): string | null {
  const m = url.match(/\/ipfs\/([a-zA-Z0-9]+)/);
  return m ? m[1] : null;
}

async function isAliveAnywhere(
  cid: string,
  timeoutMs = 20000
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

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as {
    confirmedDead: Array<{ docId: string; field: string; brokenUrl: string }>;
  };
  let candidates = manifest.confirmedDead;
  console.log(`${candidates.length} docs to run through ${ROUNDS}-round consensus check\n`);

  const everAlive: typeof candidates = [];

  for (let round = 1; round <= ROUNDS && candidates.length > 0; round++) {
    console.log(`--- round ${round}/${ROUNDS}: checking ${candidates.length} remaining ---`);
    const stillDead: typeof candidates = [];
    const queue = [...candidates];
    async function worker() {
      while (queue.length) {
        const row = queue.shift();
        if (!row) break;
        const cid = extractCid(row.brokenUrl);
        if (!cid) {
          stillDead.push(row);
          continue;
        }
        const { alive, via } = await isAliveAnywhere(cid);
        if (alive) {
          everAlive.push(row);
          console.log(
            `  ALIVE (round ${round})  ${row.docId.slice(0, 8)}  ${row.field}  via ${via}`
          );
        } else {
          stillDead.push(row);
        }
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    console.log(
      `  round ${round}: ${candidates.length - stillDead.length} resolved alive, ${stillDead.length} still dead\n`
    );
    candidates = stillDead;
    if (round < ROUNDS && candidates.length > 0) {
      console.log(`  waiting ${ROUND_GAP_MS / 1000}s before next round...\n`);
      await sleep(ROUND_GAP_MS);
    }
  }

  console.log(
    `\nConsensus result: ${everAlive.length} resolved alive on at least one round, ${candidates.length} failed ALL ${ROUNDS} rounds (truly dead)`
  );

  if (DRY_RUN) {
    console.log('\n(DRY_RUN — no writes performed.)');
    return;
  }

  const sa = JSON.parse(
    fs.readFileSync(
      process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? 'firebase-sa-key-20260416.json',
      'utf-8'
    )
  );
  const app = initializeApp({ credential: cert(sa) }, `consensus-${Date.now()}`);
  const db = getFirestore(app);
  db.settings({ preferRest: true });

  const byDoc = new Map<string, (typeof everAlive)[number]>();
  for (const row of everAlive) byDoc.set(row.docId, row);
  console.log(`\nReverting hide on ${byDoc.size} docs (resolved alive on at least one round)...`);
  let done = 0;
  for (const [docId] of byDoc) {
    try {
      await db.collection('content').doc(docId).update({
        contentStatus: 'active',
        contentStatusUpdatedAt: new Date(),
        contentStatusUpdatedBy: 'confirm-dead-consensus',
        contentStatusReason: 'resolved_alive_on_at_least_one_of_N_consensus_rounds',
      });
      done++;
    } catch (err) {
      console.error(`  revert ${docId} failed:`, err);
    }
  }
  console.log(`  ${done}/${byDoc.size} docs reverted`);

  const backupPath = path.resolve(process.cwd(), `confirm-dead-consensus-${Date.now()}.json`);
  fs.writeFileSync(backupPath, JSON.stringify({ everAlive, trulyDead: candidates }, null, 2));
  console.log(`\nBackup manifest: ${backupPath}`);
  console.log(
    `\n${candidates.length} docs remain hidden — dead on all ${ROUNDS} independent rounds.`
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('CONSENSUS CHECK FAILED:', err);
    process.exit(1);
  });
