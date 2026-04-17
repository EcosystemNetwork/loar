/**
 * Create the "E Combonator" universe on the LOAR platform.
 *
 * A story about a solo tech founder in the Bay Area who has the most
 * advanced technology, travels the world winning hackathons, but no one
 * takes him seriously — until one day...
 *
 * Uses Firebase Admin SDK (REST mode) + Google Imagen 4 + Firebase Storage.
 *
 * Usage:
 *   pnpm tsx scripts/create-ecombonator-universe.ts
 *
 * Required env: GOOGLE_API_KEY, FIREBASE_STORAGE_BUCKET
 */
import dotenv from 'dotenv';
import path from 'path';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync, writeFileSync } from 'fs';
import { GoogleAuth } from 'google-auth-library';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

// ── Config ───────────────────────────────────────────────────────────
const CREATOR_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const CREDITS = 5000;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY!;
const STORAGE_BUCKET = process.env.FIREBASE_STORAGE_BUCKET!;

const UNIVERSE_NAME = 'E Combonator';
const TOKEN_SYMBOL = '$ECOMB';

const DESCRIPTION = [
  'E Combonator is the story of a solo tech founder operating out of a cramped apartment in the Bay Area,',
  'building technology so advanced it borders on science fiction.',
  'Armed with nothing but a laptop, an obsessive work ethic, and code that rewrites the rules,',
  'he travels the globe entering hackathon after hackathon — and winning every single one.',
  '\n\nBut nobody takes him seriously.',
  'The VCs laugh him out of Sand Hill Road. The accelerators ghost his applications.',
  'Twitter threads calling him a "hackathon tourist" go viral.',
  'Conference organizers stop inviting him. His demos get more views than his cap table has zeros.',
  '\n\nHe keeps building anyway. Alone. Relentless. Invisible.',
  "\n\nUntil one day, the technology he's been quietly assembling in that apartment",
  'does something that no one — not the big labs, not the megacorps, not the three-letter agencies —',
  'thought was possible. And suddenly, every door that was closed is trying to open at once.',
  "\n\nBut by then, he's already walking through a different one.",
].join(' ');

const COVER_PROMPT = [
  `Cinematic movie poster for "E Combonator".`,
  'A lone young tech founder silhouetted against the San Francisco skyline at night,',
  'standing on a rooftop with a glowing laptop open in front of him,',
  'holographic code and neural network diagrams spiraling upward from the screen into the sky.',
  'Below him, the city is a sea of startup logos and neon lights.',
  'Hackathon winner badges and trophies scattered at his feet, half-buried and forgotten.',
  'In the distance, a massive glowing portal or breakthrough phenomenon forming in the clouds.',
  'Color palette: deep midnight blue, electric cyan, warm amber from the city lights, hints of gold.',
  'Mood: defiant, solitary genius, the calm before everything changes.',
  'Ultra-detailed 8K concept art, dramatic volumetric lighting, no text, no watermarks, no logos.',
].join(' ');

function log(step: string, msg: string) {
  console.log(`  [${step}] ${msg}`);
}

// ── Step 1: Generate cover image via Google Imagen 4 ─────────────────

async function generateCoverImage(): Promise<Buffer> {
  log('IMAGE', 'Generating cover image via Google Imagen 4...');

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict?key=${GOOGLE_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instances: [{ prompt: COVER_PROMPT }],
        parameters: {
          sampleCount: 1,
          aspectRatio: '16:9',
          personGeneration: 'allow_adult',
        },
      }),
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Imagen 4 failed: ${res.status} ${errText.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    predictions?: Array<{ bytesBase64Encoded: string; mimeType: string }>;
  };

  if (!data.predictions?.length) {
    throw new Error('No images returned from Imagen 4');
  }

  const imageBase64 = data.predictions[0].bytesBase64Encoded;
  const buffer = Buffer.from(imageBase64, 'base64');
  log('IMAGE', `Generated: ${(buffer.length / 1024).toFixed(0)} KB`);

  return buffer;
}

// ── Step 2: Upload to Firebase Storage ───────────────────────────────

async function uploadToFirebaseStorage(imageBuffer: Buffer, filename: string): Promise<string> {
  log('STORAGE', 'Uploading to Firebase Storage via REST API...');

  const saPath = path.resolve(process.cwd(), 'firebase-service-account.json');
  const auth = new GoogleAuth({
    keyFile: saPath,
    scopes: ['https://www.googleapis.com/auth/devstorage.full_control'],
  });
  const accessToken = await auth.getAccessToken();

  const key = `universes/${filename}`;
  const uploadUrl = `https://storage.googleapis.com/upload/storage/v1/b/${STORAGE_BUCKET}/o?uploadType=media&name=${encodeURIComponent(key)}`;

  const res = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'image/png',
    },
    body: imageBuffer,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GCS upload failed: ${res.status} ${text.slice(0, 300)}`);
  }

  // Make the object publicly readable
  const aclUrl = `https://storage.googleapis.com/storage/v1/b/${STORAGE_BUCKET}/o/${encodeURIComponent(key)}/acl`;
  await fetch(aclUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ entity: 'allUsers', role: 'READER' }),
  });

  const publicUrl = `https://storage.googleapis.com/${STORAGE_BUCKET}/${key}`;
  log('STORAGE', `Uploaded: ${key} (${(imageBuffer.length / 1024).toFixed(0)} KB)`);
  log('STORAGE', `URL: ${publicUrl}`);

  return publicUrl;
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.log('\n LOAR — Creating E Combonator Universe\n');

  // ── Validate env ──────────────────────────────────────────────────
  if (!GOOGLE_API_KEY) throw new Error('GOOGLE_API_KEY not set');
  if (!STORAGE_BUCKET) throw new Error('FIREBASE_STORAGE_BUCKET not set');

  // ── Init Firebase ──────────────────────────────────────────────────
  const saPath = path.resolve(process.cwd(), 'firebase-service-account.json');
  const serviceAccount = JSON.parse(readFileSync(saPath, 'utf-8'));
  const app = initializeApp(
    { credential: cert(serviceAccount) },
    'create-ecombonator-' + Date.now()
  );
  const db = getFirestore(app);
  db.settings({ preferRest: true });
  console.log(`  Firebase   : ${serviceAccount.project_id}`);
  console.log(`  Creator    : ${CREATOR_ADDRESS}`);
  console.log(`  Imagen     : configured`);
  console.log(`  Storage    : ${STORAGE_BUCKET}\n`);

  // ── Step 1: Generate AI cover image ────────────────────────────────
  console.log('Step 1: Generating AI cover image via Google Imagen 4...');

  const imageBuffer = await generateCoverImage();

  // ── Step 2: Upload to Firebase Storage ──────────────────────────────
  console.log('\nStep 2: Uploading cover image to Firebase Storage...');

  const coverImageUrl = await uploadToFirebaseStorage(imageBuffer, 'ecombonator-cover.png');

  // ── Step 3: Create the universe in Firestore ──────────────────────
  console.log('\nStep 3: Creating universe in Firestore...');

  const ts = Date.now();
  const fakeAddress = `0x${ts.toString(16).padStart(40, '0')}`;
  const universeId = fakeAddress.toLowerCase();

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
      description: DESCRIPTION,
      name: UNIVERSE_NAME,
      symbol: TOKEN_SYMBOL,
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
  log('FIRESTORE', 'Universe document created');

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
  log('FIRESTORE', `Seeded ${CREDITS} mint credits`);

  // Seed private section config
  await db.collection('privateSectionConfig').doc(universeId).set({
    universeId,
    vaultEnabled: true,
    notesEnabled: true,
    holderMinPercentage: 1,
    createdAt: now,
    updatedAt: now,
  });
  log('FIRESTORE', 'Seeded private section config');

  // Credit transaction log
  await db.collection('universeCreditTransactions').add({
    universeId,
    type: 'fund',
    fundedByUid: CREATOR_ADDRESS.toLowerCase(),
    paymentMethod: 'genesis',
    paymentRef: 'ecombonator-genesis',
    credits: CREDITS,
    ethAmountWei: '0',
    source: 'genesis',
    note: 'E Combonator universe genesis credits',
    createdAt: now,
  });
  log('FIRESTORE', 'Credit transaction logged');

  // ── Step 4: Verify ─────────────────────────────────────────────────
  console.log('\nStep 4: Verifying...');

  const doc = await db.collection('cinematicUniverses').doc(universeId).get();
  if (!doc.exists) throw new Error('Verification failed — universe not found');
  log('VERIFY', 'Universe verified in Firestore');

  const allSnap = await db.collection('cinematicUniverses').get();
  log('VERIFY', `Total universes: ${allSnap.size}`);

  // ── Summary ────────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(60));
  console.log('  E COMBONATOR — LIVE ON LOAR');
  console.log('='.repeat(60));
  console.log(`  Universe ID  : ${universeId}`);
  console.log(`  Name         : ${UNIVERSE_NAME}`);
  console.log(`  Symbol       : ${TOKEN_SYMBOL}`);
  console.log(`  Creator      : ${CREATOR_ADDRESS}`);
  console.log(`  Credits      : ${CREDITS}`);
  console.log(`  Cover Image  : ${coverImageUrl}`);
  console.log(`  Access Model : open`);
  console.log('='.repeat(60));

  console.log('\nE Combonator is live on LOAR.\n');
  process.exit(0);
}

main().catch((err) => {
  console.error('\nFailed:', err.message ?? err);
  process.exit(1);
});
