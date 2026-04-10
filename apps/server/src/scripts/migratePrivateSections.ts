/**
 * Migration: Add private section config to all existing universes.
 *
 * Run once:
 *   npx tsx apps/server/src/scripts/migratePrivateSections.ts
 *
 * Idempotent — skips universes that already have a config doc.
 */
import { config } from 'dotenv';
import { resolve } from 'path';

// Load root .env before Firebase init
config({ path: resolve(__dirname, '../../../../.env') });

import { db } from '../lib/firebase';

async function migrate() {
  if (!db) {
    console.error('Firebase not configured. Check .env');
    process.exit(1);
  }

  const universesSnap = await db.collection('cinematicUniverses').get();
  console.log(`Found ${universesSnap.size} universes to migrate.`);

  // Check existing tokenGates for holderMinPercentage defaults
  const tokenGatesSnap = await db.collection('tokenGates').get();
  const gateMap = new Map<string, number>();
  tokenGatesSnap.docs.forEach((doc) => {
    const data = doc.data();
    if (data.enabled && data.minPercentage) {
      gateMap.set(doc.id, data.minPercentage);
    }
  });

  let created = 0;
  let skipped = 0;

  for (const universeDoc of universesSnap.docs) {
    const universeId = universeDoc.id;

    // Set hasPrivateSection flag on universe doc
    if (!universeDoc.data().hasPrivateSection) {
      await universeDoc.ref.update({ hasPrivateSection: true });
    }

    // Create privateSectionConfig if it doesn't exist
    const configRef = db.collection('privateSectionConfig').doc(universeId);
    const existing = await configRef.get();

    if (existing.exists) {
      skipped++;
      continue;
    }

    const holderMinPercentage = gateMap.get(universeId) ?? 1;
    const now = new Date();

    await configRef.set({
      universeId,
      vaultEnabled: true,
      notesEnabled: true,
      holderMinPercentage,
      createdAt: now,
      updatedAt: now,
    });

    created++;
    console.log(`  [+] ${universeId} (holder threshold: ${holderMinPercentage}%)`);
  }

  console.log(`\nDone. Created: ${created}, Skipped: ${skipped}`);
  process.exit(0);
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
