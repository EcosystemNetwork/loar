/**
 * Debug — show what's in the content collection for Fogline.
 */
import dotenv from 'dotenv';
import path from 'path';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const saPathEnv = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
const saPath = path.resolve(process.cwd(), saPathEnv ?? 'firebase-sa-key-20260416.json');
const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
  ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
  : JSON.parse(readFileSync(saPath, 'utf-8'));

const app = initializeApp({ credential: cert(serviceAccount) }, `debug-${Date.now()}`);
const db = getFirestore(app);
db.settings({ preferRest: true });

const UNIVERSE_ID = '0x0000000000000000000000000000019d9e26795c';

async function main() {
  // Check content docs
  const content = await db.collection('content').where('universeId', '==', UNIVERSE_ID).get();
  console.log(`\nContent docs with universeId=${UNIVERSE_ID}: ${content.size}\n`);

  content.docs.slice(0, 3).forEach((d, i) => {
    const data = d.data();
    console.log(`[${i + 1}] ${d.id}`);
    console.log(`    title: ${data.title}`);
    console.log(`    mediaType: ${data.mediaType}`);
    console.log(`    visibility: ${data.visibility}`);
    console.log(`    universeId: ${data.universeId}`);
    console.log(`    mediaUrl: ${data.mediaUrl?.slice(0, 80)}...`);
    console.log(`    createdAt: ${data.createdAt}`);
    console.log(`    contentStatus: ${data.contentStatus || '(none)'}`);
    console.log('');
  });

  // Try the gallery browse query directly
  console.log('\n--- Simulating gallery.browse query ---');
  let q: any = db.collection('content').where('visibility', '==', 'public');
  q = q.where('universeId', '==', UNIVERSE_ID);
  q = q.where('mediaType', 'in', ['video', 'ai-video', 'image', 'ai-image', 'audio', '3d']);
  q = q.orderBy('createdAt', 'desc').limit(20);

  try {
    const result = await q.get();
    console.log(`Gallery browse returned ${result.size} items`);
  } catch (err: any) {
    console.log(`Gallery browse FAILED: ${err.message}`);
    if (err.message.includes('index')) {
      console.log(`\n⚠️  Missing Firestore index. Look for the URL in the error message above.`);
    }
  }
}

main().catch(console.error);
