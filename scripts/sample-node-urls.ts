/**
 * Probe a small sample of offChainNode videoUrls and report the per-URL
 * status code. Used to sanity-check whether cull-dead-nodes-all is hitting
 * gateway rate-limits before we let it delete anything.
 */
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

  const ocSnap = await db.collection('offChainNodes').get();
  const sample = ocSnap.docs.slice(0, 20).map((d) => {
    const data = d.data() as any;
    return {
      docId: d.id,
      universeId: String(data.universeId || ''),
      nodeId: data.nodeId,
      url: String(data.videoUrl || ''),
    };
  });

  for (const s of sample) {
    const host = (() => {
      try {
        return new URL(s.url).host;
      } catch {
        return '—';
      }
    })();
    let head = 'no-url';
    let get = '—';
    if (s.url) {
      try {
        const r = await fetch(s.url, { method: 'HEAD', redirect: 'follow' });
        head = String(r.status);
      } catch (e: any) {
        head = `err:${e?.code || e?.message}`.slice(0, 40);
      }
      try {
        const r = await fetch(s.url, {
          method: 'GET',
          redirect: 'follow',
          headers: { Range: 'bytes=0-0' },
        });
        get = String(r.status);
      } catch (e: any) {
        get = `err:${e?.code || e?.message}`.slice(0, 40);
      }
    }
    console.log(`${head.padEnd(8)} GET=${get.padEnd(8)} ${host.padEnd(28)} node=${s.nodeId}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
