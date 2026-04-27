/**
 * Read-only: dump the full key list + sample field values for a few hidden
 * content docs and their linked source generations, so we can see what URL
 * fields actually live where. Also scan offChainNodes for rehost URLs that
 * could repair the same scenes.
 */
import dotenv from 'dotenv';
import path from 'path';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const PINATA_TOKEN = process.env.PINATA_GATEWAY_TOKEN || '';
function authedUrl(raw: string): string {
  if (!raw) return raw;
  try {
    const u = new URL(raw);
    if (
      /\.mypinata\.cloud$/i.test(u.host) &&
      PINATA_TOKEN &&
      !u.searchParams.has('pinataGatewayToken')
    ) {
      u.searchParams.set('pinataGatewayToken', PINATA_TOKEN);
      return u.toString();
    }
  } catch {}
  return raw;
}
async function probeOk(rawUrl: string): Promise<boolean> {
  if (!rawUrl) return false;
  try {
    const r = await fetch(authedUrl(rawUrl), { method: 'HEAD', redirect: 'follow' });
    return r.ok;
  } catch {
    return false;
  }
}

async function main() {
  const sa = JSON.parse(
    readFileSync(
      process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? 'firebase-sa-key-20260416.json',
      'utf-8'
    )
  );
  const app = getApps()[0] ?? initializeApp({ credential: cert(sa) });
  const db = getFirestore(app);
  if (!getApps()[0]) db.settings({ preferRest: true });

  const cSnap = await db
    .collection('content')
    .where('contentStatusUpdatedBy', '==', 'repair-broken-media-urls')
    .limit(5)
    .get();

  for (const d of cSnap.docs) {
    const data = d.data() as any;
    console.log(`\n── content ${d.id} ──`);
    console.log(`  keys: ${Object.keys(data).sort().join(', ')}`);
    console.log(`  mediaUrl: ${String(data.mediaUrl ?? '').slice(0, 80)}`);
    console.log(`  thumbnailUrl: ${String(data.thumbnailUrl ?? '').slice(0, 80)}`);
    console.log(`  generationId: ${data.generationId}`);
    console.log(`  generationModel: ${data.generationModel}`);

    const gid = data.generationId;
    if (!gid) continue;
    let gen: any = null;
    let collName = '';
    const v = await db.collection('videoGenerations').doc(gid).get();
    if (v.exists) {
      gen = v.data();
      collName = 'videoGenerations';
    } else {
      const i = await db.collection('imageGenerations').doc(gid).get();
      if (i.exists) {
        gen = i.data();
        collName = 'imageGenerations';
      }
    }
    if (!gen) {
      console.log(`  ↳ no gen doc found`);
      continue;
    }
    console.log(`  ↳ ${collName} keys: ${Object.keys(gen).sort().join(', ')}`);
    const urlKeys = Object.keys(gen).filter((k) => /url|cid|ipfs/i.test(k));
    for (const k of urlKeys) {
      const val = gen[k];
      const valStr = typeof val === 'string' ? val.slice(0, 80) : JSON.stringify(val).slice(0, 80);
      const ok = typeof val === 'string' ? await probeOk(val) : false;
      console.log(`    ${k}: ${ok ? '✓' : '✗'}  ${valStr}`);
    }
    // Look for offChainNodes for the same universe + sceneId
    const uni = String(data.universeId ?? '').toLowerCase();
    const sceneId = gen.sceneId ?? gen.nodeId;
    if (uni && sceneId != null) {
      const ocSnap = await db.collection('offChainNodes').where('universeId', '==', uni).get();
      const matching = ocSnap.docs
        .map((od) => od.data() as any)
        .filter((od) => od.sceneId === sceneId || String(od.nodeId) === String(sceneId));
      if (matching.length) {
        for (const m of matching.slice(0, 2)) {
          const ok = await probeOk(m.videoUrl);
          console.log(
            `    offChainNode  scene=${m.sceneId} node=${m.nodeId}  ${ok ? '✓' : '✗'} ${String(
              m.videoUrl ?? ''
            ).slice(0, 80)}`
          );
        }
      }
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
