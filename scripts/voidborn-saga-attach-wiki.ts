/**
 * VOIDBORN SAGA — Wiki Attachment Migration
 *
 * Reassigns all standalone Voidborn Saga wiki entities (created with
 * universeAddress: null) to the deployed Voidborn Saga universe address.
 *
 * The public entities.update tRPC route strips universeAddress from input,
 * so this migration writes directly to Firestore via Firebase Admin.
 *
 * Usage: VOIDBORN_ADDR=0xF5c6f8f56F69898C42fBbc58754B9b45C5faD3b2 \
 *        pnpm tsx scripts/voidborn-saga-attach-wiki.ts
 *
 * Safe: only updates entities where name matches the pilot wiki set AND
 * universeAddress is currently null AND creator matches PRIVATE_KEY signer.
 */
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { initializeApp, cert, type ServiceAccount } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import { privateKeyToAccount } from 'viem/accounts';

const rawKey = process.env.PRIVATE_KEY ?? '';
const PRIVATE_KEY = (rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`) as `0x${string}`;
const account = privateKeyToAccount(PRIVATE_KEY);
const CREATOR = account.address.toLowerCase();

const UNIVERSE_ADDR = (process.env.VOIDBORN_ADDR ?? '').toLowerCase();
if (!UNIVERSE_ADDR || !UNIVERSE_ADDR.startsWith('0x') || UNIVERSE_ADDR.length !== 42) {
  console.error('ERROR: Set VOIDBORN_ADDR to the deployed universe address');
  process.exit(1);
}

const VOIDBORN_ENTITY_NAMES = new Set([
  'Zix',
  'Mora',
  'Pebb',
  'Drael',
  'Nuni',
  'The Hiker',
  'The Convenience Store Clerk',
  'Hector',
  'The Meteor Hunters',
  'The Sleeper Network Voice',
  'Santa Mira County',
  'The Ravine',
  'The Strip Mall',
  'The 24-Hour Convenience Store',
  'The Abandoned Car Wash',
  'The Old Observatory',
  'The Moon Casinos of Jath',
  'The Hilltop Lookout',
  'The Starling',
  'The Camouflage Field Generator',
  "Mora's Improvised Radio Rig",
  'Glow Fruit',
  'Voidborn',
  'Humans',
  'The Voidborn Sleeper Network',
  'The Crash Landing',
  'First Contact with the Hiker',
  'The Strip Mall Expedition',
  'The Convenience Store Escape',
  'The Sleeper Network Contact',
  'The Meteor Hunter Sighting',
  'The Pre-Dawn Resolve',
  'Voidborn Heritage',
  'Earth Changes You',
  "Nuni's Misinformation",
  'Voidborn Daily Life',
]);

function loadServiceAccount(): ServiceAccount {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  }
  if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
    const abs = path.resolve(process.cwd(), process.env.FIREBASE_SERVICE_ACCOUNT_PATH);
    return JSON.parse(readFileSync(abs, 'utf-8'));
  }
  throw new Error(
    'Firebase Admin credentials missing — set FIREBASE_SERVICE_ACCOUNT or FIREBASE_SERVICE_ACCOUNT_PATH'
  );
}

async function main() {
  console.log('\n' + '═'.repeat(60));
  console.log('  VOIDBORN SAGA — Attach Wiki Entities to Universe');
  console.log('═'.repeat(60));
  console.log(`  Universe: ${UNIVERSE_ADDR}`);
  console.log(`  Creator:  ${CREATOR}`);
  console.log('');

  const serviceAccount = loadServiceAccount();
  const app = initializeApp({ credential: cert(serviceAccount) });
  const db = getFirestore(app);
  db.settings({ ignoreUndefinedProperties: true });

  const snap = await db.collection('entities').where('creator', '==', CREATOR).get();
  console.log(`  Found ${snap.size} entities for creator`);

  const toUpdate: string[] = [];
  const skipped: string[] = [];
  for (const doc of snap.docs) {
    const data = doc.data() as { name: string; universeAddress: string | null };
    if (!VOIDBORN_ENTITY_NAMES.has(data.name)) continue;
    if (data.universeAddress && data.universeAddress !== UNIVERSE_ADDR) {
      skipped.push(`${data.name} (already assigned to ${data.universeAddress})`);
      continue;
    }
    if (data.universeAddress === UNIVERSE_ADDR) {
      skipped.push(`${data.name} (already on this universe)`);
      continue;
    }
    toUpdate.push(doc.id);
  }

  console.log(`  To attach: ${toUpdate.length}`);
  if (skipped.length) {
    console.log(`  Skipping ${skipped.length}:`);
    for (const s of skipped) console.log(`    - ${s}`);
  }
  if (toUpdate.length === 0) {
    console.log('\n  Nothing to do.\n');
    return;
  }

  const batch = db.batch();
  const now = new Date();
  for (const id of toUpdate) {
    batch.update(db.collection('entities').doc(id), {
      universeAddress: UNIVERSE_ADDR,
      updatedAt: now,
    });
  }
  await batch.commit();
  console.log(`\n  Attached ${toUpdate.length} entities to universe ${UNIVERSE_ADDR}`);
  console.log('');
}

main().catch((err) => {
  console.error('FAILED:', err.message ?? err);
  process.exit(1);
});
