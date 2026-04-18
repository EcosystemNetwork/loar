/**
 * Quick status check — counts what's in Firestore for the Fogline universe.
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

const app = initializeApp({ credential: cert(serviceAccount) }, `fogline-status-${Date.now()}`);
const db = getFirestore(app);
db.settings({ preferRest: true });

const UNIVERSE_ID = '0x0000000000000000000000000000019d9e26795c';

async function main() {
  // Entities
  const entities = await db
    .collection('entities')
    .where('universeAddress', '==', UNIVERSE_ID)
    .get();
  const entitiesWithImages = entities.docs.filter((d) => d.data().imageUrl).length;

  // Videos
  const videos = await db
    .collection('videoGenerations')
    .where('universeId', '==', UNIVERSE_ID)
    .get();
  const videosByScene = new Map<number, any>();
  videos.docs.forEach((d) => {
    const data = d.data();
    if (data.sceneId) videosByScene.set(data.sceneId, data);
  });

  // Episodes
  const episodes = await db.collection('episodes').where('universeId', '==', UNIVERSE_ID).get();

  // Gallery content
  const gallery = await db.collection('content').where('universeId', '==', UNIVERSE_ID).get();
  const galleryVideos = gallery.docs.filter((d) => d.data().mediaType === 'ai-video').length;

  console.log(`
═══════════════════════════════════════════════════
  FALLOUT: FOGLINE — Status
═══════════════════════════════════════════════════
  Universe ID: ${UNIVERSE_ID}

  WIKI:
    Entities       : ${entities.size}
    With images    : ${entitiesWithImages} / ${entities.size}

  VIDEOS:
    Total clips    : ${videos.size}
    Unique scenes  : ${videosByScene.size} / 61
    Gallery items  : ${galleryVideos}
    Episodes       : ${episodes.size}
`);

  if (videosByScene.size > 0) {
    console.log('  Scenes generated:');
    const sorted = Array.from(videosByScene.keys()).sort((a, b) => a - b);
    console.log(`    ${sorted.join(', ')}`);
    console.log('');
    const missing: number[] = [];
    for (let i = 1; i <= 61; i++) if (!videosByScene.has(i)) missing.push(i);
    if (missing.length > 0) {
      console.log(`  Missing scenes (${missing.length}):`);
      console.log(`    ${missing.join(', ')}`);
    }
  }

  if (episodes.size > 0) {
    console.log('\n  Episodes:');
    episodes.docs.forEach((d) => {
      const data = d.data();
      console.log(
        `    ${d.id}: "${data.title}" (${data.totalClips || data.clips?.length || 0} clips)`
      );
    });
  }

  console.log('\n═══════════════════════════════════════════════════');
}

main().catch(console.error);
