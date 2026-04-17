/**
 * Grant credits to the deployer wallet for testing.
 * Directly writes to Firestore userCredits collection.
 *
 * Usage: pnpm tsx scripts/grant-credits.ts
 */
import dotenv from 'dotenv';
import path from 'path';
import { privateKeyToAccount } from 'viem/accounts';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

async function main() {
  const { initFirebase, db: _db } = await import('../apps/server/src/lib/firebase.js');
  initFirebase();
  const { db } = await import('../apps/server/src/lib/firebase.js');

  const rawKey = process.env.PRIVATE_KEY ?? '';
  const WALLET = (rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`) as `0x${string}`;
  const account = privateKeyToAccount(WALLET);
  const uid = account.address.toLowerCase();

  const CREDITS_TO_GRANT = 10000;

  const creditsRef = db.collection('userCredits').doc(uid);
  const doc = await creditsRef.get();

  if (doc.exists) {
    const data = doc.data()!;
    const currentBalance = data.balance || 0;
    await creditsRef.update({
      balance: currentBalance + CREDITS_TO_GRANT,
      totalBonusReceived: (data.totalBonusReceived || 0) + CREDITS_TO_GRANT,
      updatedAt: new Date(),
    });
    console.log(`✓ Granted ${CREDITS_TO_GRANT} credits to ${uid}`);
    console.log(`  Previous balance: ${currentBalance}`);
    console.log(`  New balance: ${currentBalance + CREDITS_TO_GRANT}`);
  } else {
    await creditsRef.set({
      uid,
      balance: CREDITS_TO_GRANT,
      totalPurchased: 0,
      totalSpent: 0,
      totalBonusReceived: CREDITS_TO_GRANT,
      totalLoarPurchases: 0,
      totalFiatPurchases: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    console.log(`✓ Created credit account for ${uid} with ${CREDITS_TO_GRANT} credits`);
  }

  await db.collection('creditTransactions').add({
    uid,
    type: 'grant',
    source: 'admin',
    credits: CREDITS_TO_GRANT,
    reason: 'Test credits for stress testing entity mint pipeline',
    createdAt: new Date(),
  });
  console.log(`✓ Grant transaction logged`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
