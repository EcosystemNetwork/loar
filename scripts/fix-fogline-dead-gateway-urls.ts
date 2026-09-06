/**
 * Repair FALLOUT: FOGLINE media URLs pointing at the dead private Pinata
 * gateway (peach-impressive-moth-978.mypinata.cloud), which now 401s all
 * unauthenticated requests (ERR_ID:00024 — dedicated gateway access
 * restriction, disabled 2026-08-24).
 *
 * Fogline is an OFF-CHAIN universe, so its timeline lives in `offChainNodes`
 * (61 docs, nodeId 86..146) — that collection is the main surface here, plus
 * the same content/entity/universe-image fields the Monerochan repair
 * covered. Every affected field is rewritten to the public gateway
 * equivalent (same /ipfs/<path>, just a live host) and the old value is
 * archived alongside for reversibility.
 *
 * Unlike the Monerochan CIDs (which were verified live before that script
 * shipped), a spot-probe of Fogline's CIDs across public gateways was
 * inconclusive (429 / timeout), so this script HEAD-checks every rewritten
 * URL against the public gateway and reports any that don't resolve —
 * those need re-pinning / regen (cf. repair-nexus-protocol-offchain-nodes.ts)
 * rather than a host swap.
 *
 * Usage:
 *   DRY_RUN=1 pnpm tsx scripts/fix-fogline-dead-gateway-urls.ts   # preview + liveness probe
 *   pnpm tsx scripts/fix-fogline-dead-gateway-urls.ts             # apply
 *
 * Env:
 *   FIREBASE_SERVICE_ACCOUNT_PATH  (default: ~/.config/loar/loar-db-sa.json)
 *   VERIFY=0                       skip the per-URL liveness probe
 *   PUBLIC_GATEWAY                 override target gateway (default gateway.pinata.cloud)
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';
import fs from 'fs';
import path from 'path';

// This script talks to PRODUCTION Firestore. The repo .env wires firebase-admin
// to the local emulator + a fake SA key; deliberately do NOT load it, and clear
// the emulator host in case the shell exported it.
delete process.env.FIRESTORE_EMULATOR_HOST;
delete process.env.FIREBASE_SERVICE_ACCOUNT;
delete process.env.FIREBASE_SERVICE_ACCOUNT_PATH;

const DRY_RUN = process.env.DRY_RUN === '1';
const VERIFY = process.env.VERIFY !== '0';
const UNIVERSE_ID = '0x0000000000000000000000000000019d9e26795c';
const DEAD_HOST = 'peach-impressive-moth-978.mypinata.cloud';
const PUBLIC_GATEWAY = (process.env.PUBLIC_GATEWAY || 'https://gateway.pinata.cloud').replace(
  /\/$/,
  ''
);
// Extra gateways to try when the primary probe fails, before declaring a CID dead.
const PROBE_FALLBACKS = ['https://ipfs.io', 'https://dweb.link', 'https://w3s.link'];

function rewrite(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.host !== DEAD_HOST) return null;
    return `${PUBLIC_GATEWAY}${u.pathname}${u.search}`;
  } catch {
    return null;
  }
}

function ipfsPath(url: string): string | null {
  try {
    return new URL(url).pathname; // /ipfs/<cid>[/<child>]
  } catch {
    return null;
  }
}

async function headOk(url: string, timeoutMs = 20000): Promise<boolean> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    // Range GET rather than HEAD — some gateways don't answer HEAD but will
    // serve a 1-byte range fast.
    const res = await fetch(url, {
      method: 'GET',
      headers: { Range: 'bytes=0-1' },
      redirect: 'follow',
      signal: ctrl.signal,
    });
    return res.status === 200 || res.status === 206;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

async function probeCid(pathname: string): Promise<{ live: boolean; via: string | null }> {
  for (const gw of [PUBLIC_GATEWAY, ...PROBE_FALLBACKS]) {
    if (await headOk(`${gw}${pathname}`)) return { live: true, via: gw };
  }
  return { live: false, via: null };
}

interface Change {
  coll: string;
  id: string;
  field: string;
  oldUrl: string;
  newUrl: string;
}

async function main() {
  const saPath = path.resolve(
    process.cwd(),
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? `${process.env.HOME}/.config/loar/loar-db-sa.json`
  );
  const sa = JSON.parse(fs.readFileSync(saPath, 'utf-8'));
  const app = initializeApp({ credential: cert(sa) }, `fg-gw-fix-${Date.now()}`);
  const db: Firestore = getFirestore(app);
  db.settings({ preferRest: true });

  console.log(`\n=== Fogline dead-gateway URL repair (${DRY_RUN ? 'DRY-RUN' : 'LIVE'}) ===`);
  console.log(`Target public gateway: ${PUBLIC_GATEWAY}`);
  console.log(`Liveness probe: ${VERIFY ? 'on' : 'off'}\n`);

  const changes: Change[] = [];
  const writes: Array<() => Promise<void>> = [];

  // ── 1. offChainNodes.videoUrl (primary — the timeline editor surface) ──
  const nodeSnap = await db
    .collection('offChainNodes')
    .where('universeId', '==', UNIVERSE_ID)
    .orderBy('nodeId', 'asc')
    .get();
  for (const doc of nodeSnap.docs) {
    const x = doc.data() as any;
    const nu = typeof x.videoUrl === 'string' ? rewrite(x.videoUrl) : null;
    if (!nu) continue;
    changes.push({
      coll: 'offChainNodes',
      id: doc.id,
      field: `videoUrl (node ${x.nodeId})`,
      oldUrl: x.videoUrl,
      newUrl: nu,
    });
    writes.push(() =>
      doc.ref.update({
        videoUrl: nu,
        videoUrlArchived: x.videoUrl,
        videoUrlFixReason: 'dead_dedicated_pinata_gateway_401_rewritten_to_public',
        updatedAt: new Date(),
      })
    );
  }

  // ── 2. content.mediaUrl / videoUrl ───────────────────────────────────
  const contentSnap = await db.collection('content').where('universeId', '==', UNIVERSE_ID).get();
  for (const doc of contentSnap.docs) {
    const x = doc.data() as any;
    const update: Record<string, unknown> = {};
    for (const field of ['mediaUrl', 'videoUrl', 'thumbnailUrl']) {
      const v = x[field];
      if (typeof v !== 'string') continue;
      const nu = rewrite(v);
      if (!nu) continue;
      changes.push({ coll: 'content', id: doc.id, field, oldUrl: v, newUrl: nu });
      update[field] = nu;
      update[`${field}Archived`] = v;
    }
    if (Object.keys(update).length > 0) {
      update.mediaUrlRepairedAt = new Date();
      update.mediaUrlRepairedReason = 'dead_dedicated_pinata_gateway_401_rewritten_to_public';
      writes.push(() => doc.ref.update(update));
    }
  }

  // ── 3. videoGenerations.videoUrl / permanentVideoUrl ─────────────────
  const vgSnap = await db
    .collection('videoGenerations')
    .where('universeId', '==', UNIVERSE_ID)
    .get();
  for (const doc of vgSnap.docs) {
    const x = doc.data() as any;
    const update: Record<string, unknown> = {};
    for (const field of ['videoUrl', 'permanentVideoUrl']) {
      const v = x[field];
      if (typeof v !== 'string') continue;
      const nu = rewrite(v);
      if (!nu) continue;
      changes.push({ coll: 'videoGenerations', id: doc.id, field, oldUrl: v, newUrl: nu });
      update[field] = nu;
      update[`${field}Archived`] = v;
    }
    if (Object.keys(update).length > 0) writes.push(() => doc.ref.update(update));
  }

  // ── 4. cinematicUniverses.image_url ──────────────────────────────────
  const uDoc = await db.collection('cinematicUniverses').doc(UNIVERSE_ID).get();
  {
    const x = uDoc.data() as any;
    const nu = x?.image_url ? rewrite(x.image_url) : null;
    if (nu) {
      changes.push({
        coll: 'cinematicUniverses',
        id: uDoc.id,
        field: 'image_url',
        oldUrl: x.image_url,
        newUrl: nu,
      });
      writes.push(() =>
        uDoc.ref.update({
          image_url: nu,
          image_url_archived: x.image_url,
          updated_at: new Date(),
        })
      );
    }
  }

  // ── 5. entities.imageUrl ─────────────────────────────────────────────
  const entSnap = await db.collection('entities').where('universeAddress', '==', UNIVERSE_ID).get();
  for (const doc of entSnap.docs) {
    const x = doc.data() as any;
    const nu = x.imageUrl ? rewrite(x.imageUrl) : null;
    if (!nu) continue;
    changes.push({
      coll: 'entities',
      id: doc.id,
      field: `imageUrl (${x.name ?? ''})`,
      oldUrl: x.imageUrl,
      newUrl: nu,
    });
    writes.push(() =>
      doc.ref.update({
        imageUrl: nu,
        imageUrlArchived: x.imageUrl,
        updatedAt: new Date(),
      })
    );
  }

  const byColl: Record<string, number> = {};
  for (const c of changes) byColl[c.coll] = (byColl[c.coll] ?? 0) + 1;
  console.log(`Found ${changes.length} field(s) to repair across ${writes.length} doc(s):`);
  for (const [coll, n] of Object.entries(byColl)) console.log(`  ${coll}: ${n}`);

  // ── Liveness probe (unique CID paths only) ───────────────────────────
  if (VERIFY && changes.length > 0) {
    const uniquePaths = [
      ...new Set(changes.map((c) => ipfsPath(c.newUrl)).filter(Boolean)),
    ] as string[];
    console.log(`\nProbing ${uniquePaths.length} unique CID path(s) for liveness...`);
    const dead: string[] = [];
    let i = 0;
    for (const p of uniquePaths) {
      const { live, via } = await probeCid(p);
      i++;
      if (!live) dead.push(p);
      if (i % 10 === 0 || !live) {
        console.log(`  [${i}/${uniquePaths.length}] ${live ? `live via ${via}` : 'DEAD'} — ${p}`);
      }
    }
    console.log(`\nLiveness: ${uniquePaths.length - dead.length} live, ${dead.length} DEAD`);
    if (dead.length > 0) {
      console.log(`\n⚠️  ${dead.length} CID path(s) not retrievable from any public gateway.`);
      console.log(`   Host-swapping these will still render blank — they need re-pinning/regen.`);
      for (const d of dead.slice(0, 20)) console.log(`     ${d}`);
      fs.writeFileSync(
        path.resolve(process.cwd(), `fogline-dead-cids-${Date.now()}.json`),
        JSON.stringify({ deadPaths: dead }, null, 2)
      );
    }
  }

  if (DRY_RUN) {
    console.log(`\n=== SAMPLE (first 5) ===`);
    for (const c of changes.slice(0, 5)) {
      console.log(`  [${c.coll}/${c.id}] ${c.field}`);
      console.log(`    old: ${c.oldUrl}`);
      console.log(`    new: ${c.newUrl}`);
    }
    console.log(`\n(DRY_RUN — no writes performed.)`);
    process.exit(0);
  }

  const backupPath = path.resolve(process.cwd(), `repair-fogline-gateway-urls-${Date.now()}.json`);
  fs.writeFileSync(backupPath, JSON.stringify({ changes }, null, 2));
  console.log(`\nBackup manifest written: ${backupPath}`);

  console.log(`\nApplying ${writes.length} doc update(s)...`);
  let done = 0;
  for (const w of writes) {
    await w();
    done++;
    if (done % 10 === 0) console.log(`  ${done}/${writes.length}`);
  }
  console.log(`  ${done}/${writes.length} applied\n\nDone.`);
  process.exit(0);
}

main().catch((err) => {
  console.error('REPAIR FAILED:', err);
  process.exit(1);
});
