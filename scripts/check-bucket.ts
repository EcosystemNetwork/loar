import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

async function main() {
  const { initFirebase } = await import('../apps/server/src/lib/firebase.js');
  initFirebase();

  const { getStorage } = await import('firebase-admin/lib/storage/index.js');

  for (const name of ['loar-db.firebasestorage.app', 'loar-db.appspot.com']) {
    try {
      const bucket = getStorage().bucket(name);
      const [exists] = await bucket.exists();
      console.log(`${name} → exists: ${exists}`);
    } catch (e: any) {
      console.log(`${name} → error: ${e.message}`);
    }
  }
}
main();
