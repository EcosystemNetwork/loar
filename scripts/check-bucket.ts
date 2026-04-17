import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function main() {
  const { initializeApp, cert } = await import('firebase-admin/app');
  const { getStorage } = await import('firebase-admin/storage');
  const { readFileSync } = await import('fs');

  const saPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (!saPath) {
    console.error('No FIREBASE_SERVICE_ACCOUNT_PATH');
    return;
  }
  const sa = JSON.parse(readFileSync(path.resolve(__dirname, '..', saPath), 'utf-8'));
  const app = initializeApp({ credential: cert(sa) }, 'bucket-check');
  const storage = getStorage(app);

  for (const name of [
    'loar-db.firebasestorage.app',
    'loar-db.appspot.com',
    'loar-db.firebasestorage.app',
  ]) {
    try {
      const bucket = storage.bucket(name);
      const [exists] = await bucket.exists();
      console.log(`${name} -> exists: ${exists}`);
    } catch (e: any) {
      console.log(`${name} -> error: ${e.message?.slice(0, 200)}`);
    }
  }
}
main();
