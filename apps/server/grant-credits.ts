import { readFileSync } from 'fs';
try {
  const envContent = readFileSync('/home/god/Desktop/LOAR/loar/.env', 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
} catch {}

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

if (getApps().length === 0) {
  const serviceAccount = JSON.parse(
    readFileSync(
      process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
        '/home/god/Desktop/LOAR/loar/firebase-service-account.json',
      'utf-8'
    )
  );
  initializeApp({ credential: cert(serviceAccount) });
}

const db = getFirestore();
const uid = '0x116c28e6dcabca363f83217c712d79dce168d90e';
const CREDITS = 10000;

async function main() {
  const ref = db.collection('userCredits').doc(uid);
  const doc = await ref.get();
  const currentBalance = doc.exists ? doc.data()?.balance || 0 : 0;

  await ref.set(
    {
      balance: currentBalance + CREDITS,
      totalPurchased: doc.data()?.totalPurchased || 0,
      totalSpent: doc.data()?.totalSpent || 0,
      totalBonusReceived: (doc.data()?.totalBonusReceived || 0) + CREDITS,
      totalLoarPurchases: doc.data()?.totalLoarPurchases || 0,
      totalFiatPurchases: doc.data()?.totalFiatPurchases || 0,
      updatedAt: new Date(),
      createdAt: doc.data()?.createdAt || new Date(),
    },
    { merge: true }
  );

  console.log(`Granted ${CREDITS} credits to ${uid}. New balance: ${currentBalance + CREDITS}`);
}
main().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
