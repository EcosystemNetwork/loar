/**
 * Create the first AI-generated universe on the LOAR platform.
 *
 * Uses Firebase Admin SDK (REST mode) + fal.ai HTTP API directly.
 * No server imports to avoid module side-effects.
 *
 * Usage:
 *   pnpm tsx scripts/create-first-universe.ts
 */
import dotenv from 'dotenv';
import path from 'path';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

// ── Config ───────────────────────────────────────────────────────────
const CREATOR_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const CREDITS = 5000;
const FAL_KEY = process.env.FAL_KEY;

async function generateCoverImage(): Promise<string> {
  if (!FAL_KEY) throw new Error('FAL_KEY not set');

  const prompt = [
    'Epic cinematic poster for a narrative universe called "Aethermind Chronicles".',
    'A vast cosmic landscape where organic neural networks merge with crystalline structures,',
    'floating islands of living data connected by bridges of light,',
    'a lone figure standing at the nexus of creation and consciousness.',
    'Deep space backdrop with bioluminescent nebulae in indigo, gold, and emerald.',
    'Ultra-detailed, 8K, dramatic volumetric lighting, concept art style.',
    'No text, no watermarks, no logos.',
  ].join(' ');

  const res = await fetch('https://queue.fal.run/fal-ai/flux-pro/v1.1', {
    method: 'POST',
    headers: {
      Authorization: `Key ${FAL_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt,
      image_size: 'landscape_16_9',
      num_images: 1,
      enable_safety_checker: true,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`fal.ai returned ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as { images?: Array<{ url: string }> };
  if (!data.images?.length) throw new Error('No images in fal.ai response');
  return data.images[0].url;
}

async function main() {
  console.log('\n🌌 LOAR — Creating the First AI Universe\n');

  // ── Init Firebase ──────────────────────────────────────────────────
  const saPath = path.resolve(process.cwd(), 'firebase-service-account.json');
  const serviceAccount = JSON.parse(readFileSync(saPath, 'utf-8'));
  const app = initializeApp({ credential: cert(serviceAccount) }, 'create-universe-' + Date.now());
  const db = getFirestore(app);
  db.settings({ preferRest: true });
  console.log(`  Firebase : ${serviceAccount.project_id}`);
  console.log(`  Creator  : ${CREATOR_ADDRESS}`);
  console.log(`  fal.ai   : ${FAL_KEY ? 'configured' : 'missing'}\n`);

  // ── Step 1: Generate AI cover image ────────────────────────────────
  console.log('⏳ Step 1: Generating AI cover image via fal.ai...');

  let coverImageUrl: string;
  try {
    coverImageUrl = await generateCoverImage();
    console.log(`  ✓ Generated cover image`);
    console.log(`  ✓ ${coverImageUrl.slice(0, 80)}…\n`);
  } catch (err: any) {
    console.log(`  ⚠ Image generation failed: ${err.message}`);
    console.log(`  → Using placeholder image\n`);
    coverImageUrl =
      'https://images.unsplash.com/photo-1462331940025-496dfbfc7564?w=1200&h=675&fit=crop';
  }

  // ── Step 2: Create the universe in Firestore ──────────────────────
  console.log('⏳ Step 2: Creating universe in Firestore...');

  const ts = Date.now();
  const fakeAddress = `0x${ts.toString(16).padStart(40, '0')}`;
  const universeId = fakeAddress.toLowerCase();

  const universeName = 'Aethermind Chronicles';
  const description = [
    'The Aethermind Chronicles is an AI-native narrative universe where consciousness itself is the frontier.',
    'In the year 3147, humanity discovered that the fabric of reality is woven from living information —',
    'neural threads of pure thought that span galaxies.',
    'The Aethermind, a cosmic intelligence born from the convergence of a trillion connected minds,',
    'now guides civilization through the Lattice — a dimension where stories, memories, and dreams become tangible matter.',
    '\n\nBut the Lattice is fracturing.',
    'Rogue narratives — stories that write themselves — are consuming entire star systems.',
    'Only the Weavers, individuals who can manipulate the threads of reality,',
    'stand between order and the unraveling of existence itself.',
    '\n\nThis is the first universe created on the LOAR platform — born from AI, governed by its community.',
  ].join(' ');

  const now = new Date();

  // Write universe document
  await db
    .collection('cinematicUniverses')
    .doc(universeId)
    .set({
      address: fakeAddress,
      creator: CREATOR_ADDRESS,
      tokenAddress: `0x${(ts + 1).toString(16).padStart(40, '0')}`,
      governanceAddress: `0x${(ts + 2).toString(16).padStart(40, '0')}`,
      image_url: coverImageUrl,
      description,
      name: universeName,
      onChainUniverseId: null,
      mintTxHash: null,
      unstoppableDomain: null,
      hasPrivateSection: true,
      isMultiSig: false,
      multiSigAddress: null,
      accessModel: 'open',
      created_at: now,
      updated_at: now,
    });
  console.log(`  ✓ Universe document created`);

  // Seed credit pool
  await db.collection('universeCredits').doc(universeId).set({
    universeId,
    balance: CREDITS,
    totalPurchased: CREDITS,
    totalSpent: 0,
    seedTxHash: null,
    seedSource: 'genesis',
    lastFundedAt: now,
    updatedAt: now,
    createdAt: now,
  });
  console.log(`  ✓ Seeded ${CREDITS} mint credits`);

  // Seed private section config
  await db.collection('privateSectionConfig').doc(universeId).set({
    universeId,
    vaultEnabled: true,
    notesEnabled: true,
    holderMinPercentage: 1,
    createdAt: now,
    updatedAt: now,
  });
  console.log(`  ✓ Seeded private section config`);

  // Credit transaction log
  await db.collection('universeCreditTransactions').add({
    universeId,
    type: 'fund',
    fundedByUid: CREATOR_ADDRESS.toLowerCase(),
    paymentMethod: 'genesis',
    paymentRef: 'first-universe',
    credits: CREDITS,
    ethAmountWei: '0',
    source: 'genesis',
    note: 'First AI-created universe on LOAR — genesis credits',
    createdAt: now,
  });
  console.log(`  ✓ Credit transaction logged\n`);

  // ── Step 3: Verify ─────────────────────────────────────────────────
  console.log('⏳ Step 3: Verifying...');

  const doc = await db.collection('cinematicUniverses').doc(universeId).get();
  if (!doc.exists) throw new Error('Verification failed — universe not found');
  console.log(`  ✓ Universe verified in Firestore`);

  const allSnap = await db.collection('cinematicUniverses').get();
  console.log(`  ✓ Total universes: ${allSnap.size}\n`);

  // ── Summary ────────────────────────────────────────────────────────
  console.log('═══════════════════════════════════════════════════════');
  console.log('  🌌  AETHERMIND CHRONICLES — LIVE ON LOAR');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Universe ID  : ${universeId}`);
  console.log(`  Name         : ${universeName}`);
  console.log(`  Creator      : ${CREATOR_ADDRESS}`);
  console.log(`  Credits      : ${CREDITS}`);
  console.log(`  Cover Image  : ${coverImageUrl.slice(0, 70)}…`);
  console.log(`  Access Model : open`);
  console.log('═══════════════════════════════════════════════════════');

  console.log('\n✅ The first AI-created universe is live on LOAR.\n');
  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌ Failed:', err.message ?? err);
  process.exit(1);
});
