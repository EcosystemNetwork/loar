import dotenv from 'dotenv';
import path from 'path';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

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

  // Fogline addr
  const FOGLINE = '0x0000000000000000000000000000019d9e26795c';
  const epSnap = await db.collection('episodes').where('universeId', '==', FOGLINE).get();

  for (const d of epSnap.docs) {
    const data = d.data() as any;
    const clip0 = (data.clips || [])[0];
    console.log(
      `${d.id.slice(0, 12)}…  isCanon=${data.isCanon}  clipCount=${data.clipCount ?? data.clips?.length ?? 0}`
    );
    console.log(`  title: ${data.title}`);
    console.log(
      `  clip[0]: nodeId=${clip0?.nodeId ?? '—'}  videoUrl=${(clip0?.videoUrl || '').slice(0, 70)}`
    );
  }

  // Probe one fogline node URL fully
  const ocSnap = await db
    .collection('offChainNodes')
    .where('universeId', '==', FOGLINE)
    .limit(5)
    .get();
  console.log('\nProbe 5 fogline nodes with token:');
  const PINATA_TOKEN = process.env.PINATA_GATEWAY_TOKEN || '';
  for (const d of ocSnap.docs) {
    const data = d.data() as any;
    const url = String(data.videoUrl || '');
    let probeUrl = url;
    try {
      const u = new URL(url);
      if (/\.mypinata\.cloud$/i.test(u.host) && PINATA_TOKEN) {
        u.searchParams.set('pinataGatewayToken', PINATA_TOKEN);
        probeUrl = u.toString();
      }
    } catch {}
    try {
      const r = await fetch(probeUrl, { method: 'GET', redirect: 'follow' });
      const ct = r.headers.get('content-type') || '';
      const len = (await r.arrayBuffer()).byteLength;
      console.log(`  node=${data.nodeId}  status=${r.status}  ct=${ct}  bytes=${len}`);
    } catch (e: any) {
      console.log(`  node=${data.nodeId}  err=${e?.message}`);
    }
  }
}
main().then(() => process.exit(0));
