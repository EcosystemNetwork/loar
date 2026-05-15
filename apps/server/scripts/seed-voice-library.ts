/**
 * Seed the curated LOAR Voice Library by minting each entry on ElevenLabs
 * and persisting voiceLibrary/{slug} docs in Firestore.
 *
 * Usage:
 *   pnpm -F server tsx scripts/seed-voice-library.ts
 *   pnpm seed:voices    (from repo root)
 *
 * Idempotent: an entry whose slug already has a non-empty voiceId is skipped.
 * Re-running fills in any gaps (e.g., entries that previously failed).
 *
 * Required env:
 *   ELEVENLABS_API_KEY
 *   FIREBASE_SERVICE_ACCOUNT (or FIREBASE_SERVICE_ACCOUNT_PATH)
 *
 * Cost: ~$0.08 per entry via designVoice (~$4 total for 51 entries).
 * During the unlimited window this is essentially free.
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

if (!process.env.ELEVENLABS_API_KEY) {
  console.error('ELEVENLABS_API_KEY not set in env. Aborting.');
  process.exit(1);
}

const { db } = await import('../src/lib/firebase.js');
const { elevenLabsService } = await import('../src/services/elevenlabs.js');
const { firebaseStorageService } = await import('../src/services/firebase-storage.js');
const { VOICE_LIBRARY_SEED } = await import('../src/data/voice-library-seed.js');

const DRY_RUN = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force'); // re-mint even entries that already have voiceId

const col = db.collection('voiceLibrary');

let minted = 0;
let skipped = 0;
let failed = 0;

console.log(
  `Seeding LOAR voice library — ${VOICE_LIBRARY_SEED.length} entries (dryRun=${DRY_RUN}, force=${FORCE})`
);

for (const entry of VOICE_LIBRARY_SEED) {
  try {
    const docRef = col.doc(entry.slug);
    const existing = await docRef.get();
    if (!FORCE && existing.exists && (existing.data() as { voiceId?: string }).voiceId) {
      console.log(
        `  ✓ skip ${entry.slug} (already minted: ${(existing.data() as { voiceId: string }).voiceId})`
      );
      skipped++;
      continue;
    }

    console.log(`  → mint ${entry.slug} (${entry.category}/${entry.gender}/${entry.age})`);

    if (DRY_RUN) {
      minted++;
      continue;
    }

    const result = await elevenLabsService.designVoice({
      name: entry.name,
      description: entry.description,
      text: entry.previewText,
      gender: entry.gender,
      age: entry.age,
      accent: entry.accent,
      accentStrength: entry.accentStrength,
    });

    let previewUrl: string | null = null;
    if (result.audioBuffer && result.audioBuffer.byteLength > 0) {
      try {
        const key = await firebaseStorageService.upload(
          result.audioBuffer,
          `voice-library/${entry.slug}.mp3`
        );
        previewUrl = firebaseStorageService.getPublicUrl(key);
      } catch (uploadErr) {
        console.warn(`    preview upload failed for ${entry.slug}:`, uploadErr);
      }
    }

    await docRef.set({
      id: entry.slug,
      slug: entry.slug,
      voiceId: result.voiceId,
      name: entry.name,
      description: entry.description,
      category: entry.category,
      tags: entry.tags,
      previewUrl,
      gender: entry.gender,
      age: entry.age,
      accent: entry.accent ?? null,
      previewText: entry.previewText,
      createdAt: new Date(),
    });
    console.log(`    ✓ voiceId=${result.voiceId} preview=${previewUrl ? 'yes' : 'no'}`);
    minted++;
  } catch (err) {
    console.error(`  ✗ ${entry.slug} failed:`, err instanceof Error ? err.message : err);
    failed++;
  }
}

console.log(`\nDone. minted=${minted} skipped=${skipped} failed=${failed}`);
process.exit(failed > 0 ? 1 : 0);
