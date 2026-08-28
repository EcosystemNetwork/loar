import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
initializeApp({ projectId: 'loar-db' });
const db = getFirestore();
const U = '0x0000000000000000000000000000000000000001';
for (const nid of [1,2,3]) await db.collection('offChainNodes').doc(`seed-${U}-${nid}`).delete();
await db.collection('offChainNodeCounters').doc(U).delete();
console.log('removed seeded test nodes + counter');
