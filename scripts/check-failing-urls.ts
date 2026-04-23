import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

async function main() {
  const sa = JSON.parse(readFileSync('firebase-sa-key-20260416.json', 'utf-8'));
  const app = initializeApp({ credential: cert(sa) });
  const db = getFirestore(app);
  db.settings({ preferRest: true });
  const ids = ['06VSo89ncijpANqH9TXm', '09f2ZZzlDPwQhbQQQWac'];
  for (const id of ids) {
    const doc = await db.collection('content').doc(id).get();
    const d = doc.data()!;
    console.log(`\n${id}`);
    console.log(`  mediaType: ${d.mediaType}`);
    console.log(`  url: ${d.mediaUrl}`);
    const u = new URL(d.mediaUrl);
    if (process.env.PINATA_GATEWAY_TOKEN) {
      u.searchParams.set('pinataGatewayToken', process.env.PINATA_GATEWAY_TOKEN);
    }
    const r = await fetch(u.toString(), { method: 'HEAD' });
    console.log(
      `  HEAD w/ token: ${r.status} ct=${r.headers.get('content-type')} len=${r.headers.get('content-length')}`
    );
    // Also try public gateway
    const pub = new URL(d.mediaUrl);
    pub.host = 'gateway.pinata.cloud';
    pub.search = '';
    const r2 = await fetch(pub.toString(), { method: 'HEAD' });
    console.log(
      `  HEAD public:   ${r2.status} ct=${r2.headers.get('content-type')} len=${r2.headers.get('content-length')}`
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
