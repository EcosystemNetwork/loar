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

const DRY_RUN = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force'); // re-mint even entries that already have voiceId

// Live runs hit the ElevenLabs API; dry runs do not. We still load creds for
// dry runs when present, but missing creds in dry-run mode is fine — it's the
// "what would happen" preview useful in CI / pre-deploy validation.
if (!DRY_RUN && !process.env.ELEVENLABS_API_KEY) {
  console.error('ELEVENLABS_API_KEY not set in env. Aborting.');
  process.exit(1);
}

const { initFirebase } = await import('../src/lib/firebase.js');
initFirebase();
// Re-import after init so the module-level `db` reflects the initialized
// Firestore instance (the export is mutated by initFirebase).
const { db } = await import('../src/lib/firebase.js');
const { elevenLabsService } = await import('../src/services/elevenlabs.js');
const { firebaseStorageService } = await import('../src/services/firebase-storage.js');
const { VOICE_LIBRARY_SEED } = await import('../src/data/voice-library-seed.js');

if (!db) {
  if (!DRY_RUN) {
    console.error('Firebase not configured (no service account). Aborting.');
    process.exit(1);
  }
  console.warn('Firebase not configured — running dry-run in offline mode (no existence checks).');
}

const col = db ? db.collection('voiceLibrary') : null;

let minted = 0;
let skipped = 0;
let failed = 0;

console.log(
  `Seeding LOAR voice library — ${VOICE_LIBRARY_SEED.length} entries (dryRun=${DRY_RUN}, force=${FORCE})`
);

for (const entry of VOICE_LIBRARY_SEED) {
  try {
    // Existence check is only possible when Firestore is reachable. Offline
    // dry-runs treat every entry as "would mint" — fine since we're not
    // actually writing anything.
    const docRef = col ? col.doc(entry.slug) : null;
    if (docRef) {
      const existing = await docRef.get();
      if (!FORCE && existing.exists && (existing.data() as { voiceId?: string }).voiceId) {
        console.log(
          `  ✓ skip ${entry.slug} (already minted: ${(existing.data() as { voiceId: string }).voiceId})`
        );
        skipped++;
        continue;
      }
    }

    console.log(`  → mint ${entry.slug} (${entry.category}/${entry.gender}/${entry.age})`);

    if (DRY_RUN) {
      minted++;
      continue;
    }
    if (!docRef) {
      // Unreachable: we hard-exit above when !db && !DRY_RUN, but TS doesn't
      // know that. Keep the guard so a future code edit doesn't silently NPE.
      throw new Error('Firestore unavailable for live seed');
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
