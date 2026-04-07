/**
 * Seed script — populates Firestore with sample data for development.
 *
 * Usage:
 *   pnpm -F server tsx scripts/seed.ts
 *   make db-seed
 *
 * Requires FIREBASE_SERVICE_ACCOUNT (or FIREBASE_SERVICE_ACCOUNT_PATH) in root .env
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

// Import firebase after env is loaded
const { db } = await import('../src/lib/firebase.js');

const SAMPLE_CHARACTERS = [
  {
    character_name: 'Aria Stormweaver',
    collection: 'Sample Characters',
    token_id: 'sample-001',
    traits: { style: 'fantasy', generated_with: 'seed-script', seed: '42' },
    rarity_rank: 1,
    rarity_percentage: null,
    image_url: 'https://placehold.co/512x512/1a1a2e/e94560?text=Aria',
    description:
      'A powerful sorceress who commands the storms. Born in the floating city of Aethermount, she wields lightning as a weapon and rain as a shield.',
    detailed_visual_description: null,
    created_at: new Date(),
    updated_at: new Date(),
  },
  {
    character_name: 'Kael Ironforge',
    collection: 'Sample Characters',
    token_id: 'sample-002',
    traits: { style: 'steampunk', generated_with: 'seed-script', seed: '99' },
    rarity_rank: 2,
    rarity_percentage: 15.5,
    image_url: 'https://placehold.co/512x512/16213e/0f3460?text=Kael',
    description:
      'A master engineer from the underground forges. He builds sentient machines and believes technology can save the world above.',
    detailed_visual_description: null,
    created_at: new Date(),
    updated_at: new Date(),
  },
  {
    character_name: 'Lyra Nightbloom',
    collection: 'Sample Characters',
    token_id: 'sample-003',
    traits: { style: 'gothic', generated_with: 'seed-script', seed: '7' },
    rarity_rank: 3,
    rarity_percentage: 22.3,
    image_url: 'https://placehold.co/512x512/533483/e94560?text=Lyra',
    description:
      'A botanist who discovered that certain flowers can open portals between dimensions. She tends a garden that exists in multiple realities simultaneously.',
    detailed_visual_description: null,
    created_at: new Date(),
    updated_at: new Date(),
  },
  {
    character_name: 'Zephyr Ashwalker',
    collection: 'Sample Characters',
    token_id: 'sample-004',
    traits: { style: 'post-apocalyptic', generated_with: 'seed-script', seed: '256' },
    rarity_rank: 4,
    rarity_percentage: 30.0,
    image_url: 'https://placehold.co/512x512/0f3460/e94560?text=Zephyr',
    description:
      'A wanderer of the scorched wastelands. He carries the last known map of the old world and seeks the mythical Oasis of Renewal.',
    detailed_visual_description: null,
    created_at: new Date(),
    updated_at: new Date(),
  },
];

const SAMPLE_UNIVERSE = {
  address: '0x0000000000000000000000000000000000000001',
  creator: '0x0000000000000000000000000000000000000000',
  tokenAddress: '0x0000000000000000000000000000000000000002',
  governanceAddress: '0x0000000000000000000000000000000000000003',
  imageUrl: 'https://placehold.co/800x400/16213e/e94560?text=Sample+Universe',
  description:
    'A sample cinematic universe for development and testing. Features four characters across different genres exploring interconnected storylines.',
  createdAt: new Date(),
  updatedAt: new Date(),
};

async function seed() {
  console.log('Seeding Firestore with sample data...\n');

  const batch = db.batch();

  // Seed characters
  for (const char of SAMPLE_CHARACTERS) {
    const ref = db.collection('characters').doc(char.token_id);
    batch.set(ref, char, { merge: true });
  }
  console.log(`  Characters: ${SAMPLE_CHARACTERS.length} entries`);

  // Seed cinematic universe
  const universeRef = db.collection('cinematicUniverses').doc('sample-universe');
  batch.set(universeRef, SAMPLE_UNIVERSE, { merge: true });
  console.log('  Cinematic Universes: 1 entry');

  await batch.commit();

  console.log('\nSeed complete!');
  process.exit(0);
}

seed().catch((error) => {
  console.error('Seed failed:', error.message);
  if (error.message.includes('FIREBASE_SERVICE_ACCOUNT')) {
    console.error('\nMake sure FIREBASE_SERVICE_ACCOUNT is set in your root .env file.');
    console.error('See docs/environment.md for setup instructions.');
  }
  process.exit(1);
});
