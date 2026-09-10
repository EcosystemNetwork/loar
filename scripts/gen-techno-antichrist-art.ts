/**
 * Generate the Techno Antichrist wiki artwork by calling Google (Nano Banana /
 * Gemini image) and LOAR Firebase Storage DIRECTLY — no dependency on the deployed api.loar.fun
 * server or its BYOK key resolution. Mirrors how scripts/create-*-universe.ts
 * seeders make their cover art.
 *
 * Reads GOOGLE_API_KEY and the Firebase Admin + Storage credentials straight
 * from the environment, so run it through `railway run --service loar --`, which
 * injects all three:
 *
 *   railway run --service loar -- pnpm tsx scripts/gen-techno-antichrist-art.ts --live --dry-run
 *   railway run --service loar -- pnpm tsx scripts/gen-techno-antichrist-art.ts --live --only="Rex Duce"
 *   railway run --service loar -- pnpm tsx scripts/gen-techno-antichrist-art.ts --live
 *
 * Flags:
 *   --live        ignore a local .env FIRESTORE_EMULATOR_HOST (talk to real Firestore)
 *   --dry-run     print the plan + prompts, generate/write nothing
 *   --covers      only entity covers            (default: covers + hero)
 *   --hero        only the universe key art
 *   --force       regenerate entities that already have an imageUrl
 *   --only=Sub    restrict to entities whose name contains Sub (case-insensitive)
 *   --limit=N     cap the number of entities
 *   --model=ID    Gemini image model id (default: tries gemini-2.5-flash-image
 *                 then gemini-3-pro-image-preview)
 */
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { firebaseStorageService } from '../apps/server/src/services/firebase-storage';
import { STYLE, KIND_FRAMING, VISUAL, EPISODE_VISUAL } from './lib/ta-visual';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const args = process.argv.slice(2);
const has = (f: string) => args.includes(f);
const val = (f: string) => {
  const a = args.find((x) => x.startsWith(`${f}=`));
  return a ? a.slice(f.length + 1) : undefined;
};

if (has('--live')) delete process.env.FIRESTORE_EMULATOR_HOST;

const UNIVERSE_ID = 'H9E6T6KyaL4xZMhttKAprcayQGonswqUnvXmtcb8a9kL';
const DRY_RUN = has('--dry-run');
const FORCE = has('--force');
const ONLY = val('--only')?.toLowerCase();
const LIMIT = val('--limit') ? Number(val('--limit')) : Infinity;
const MODELS = val('--model')
  ? [val('--model') as string]
  : ['gemini-2.5-flash-image', 'gemini-3-pro-image-preview'];
let phases = { covers: has('--covers'), hero: has('--hero') };
if (!phases.covers && !phases.hero) phases = { covers: true, hero: true };

const GOOGLE_API_KEY = process.env.GEN_GOOGLE_KEY?.trim() || process.env.GOOGLE_API_KEY; // GEN_GOOGLE_KEY = drop-in second AI Studio key for fresh Veo quota

// ── helpers ─────────────────────────────────────────────────────────────────
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function promptFor(name: string, kind: string, description: string): string {
  const subject =
    EPISODE_VISUAL[name] ?? VISUAL[name] ?? `${name} — ${(description ?? '').slice(0, 240)}.`;
  const framing =
    KIND_FRAMING[kind] ?? 'grounded photoreal cinematic still, one striking central image';
  return [subject, framing + '.', STYLE].join(' ');
}

function aspectFor(name: string, kind: string): string {
  if (name.startsWith('Ep ')) return '16:9';
  if (kind === 'place' || kind === 'event' || kind === 'faction') return '16:9';
  return '1:1';
}

/** Call Gemini image gen directly; return { base64, mimeType }. Tries each model in MODELS. */
async function generate(
  prompt: string,
  aspectRatio: string
): Promise<{ base64: string; mimeType: string }> {
  let lastErr = '';
  for (const model of MODELS) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GOOGLE_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: `Generate an image: ${prompt}` }] }],
            generationConfig: {
              responseModalities: ['image', 'text'],
              temperature: 1,
              imageConfig: { aspectRatio },
            },
          }),
        }
      );
      if (!res.ok) {
        lastErr = `${model} → ${res.status}: ${(await res.text()).slice(0, 200)}`;
        continue;
      }
      const data = (await res.json()) as any;
      for (const c of data.candidates ?? []) {
        for (const p of c.content?.parts ?? []) {
          if (p.inlineData?.data) {
            return { base64: p.inlineData.data, mimeType: p.inlineData.mimeType || 'image/png' };
          }
        }
      }
      lastErr = `${model} → no inlineData in response`;
    } catch (err: any) {
      lastErr = `${model} → ${err?.message ?? err}`;
    }
  }
  throw new Error(lastErr || 'all models failed');
}

/** Upload a generated image to LOAR's Firebase Storage (same path the server uses). */
async function host(base64: string, _mimeType: string, filename: string): Promise<string> {
  const buf = Buffer.from(base64, 'base64');
  const key = await firebaseStorageService.upload(buf, filename);
  return firebaseStorageService.getPublicUrl(key);
}

// ── main ────────────────────────────────────────────────────────────────────
async function main() {
  if (!GOOGLE_API_KEY)
    throw new Error('GOOGLE_API_KEY not in env — run through `railway run --service loar --`');
  // FIREBASE_STORAGE_BUCKET + FIREBASE_STORAGE_TOKEN_SECRET (or SIWE_JWT_SECRET) come from railway env.

  const saPath = path.resolve(
    process.cwd(),
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? `${process.env.HOME}/.config/loar/loar-db-sa.json`
  );
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    : JSON.parse(fs.readFileSync(saPath, 'utf-8'));
  initializeApp({ credential: cert(sa) }); // default app — firebaseStorageService's getStorage() needs it
  const db = getFirestore();
  db.settings({ preferRest: true });

  console.log('\n' + '='.repeat(66));
  console.log('  Techno Antichrist — wiki art (direct Google + Firebase Storage)');
  console.log('='.repeat(66));
  console.log(
    `  Firestore : ${process.env.FIRESTORE_EMULATOR_HOST ? `EMULATOR ${process.env.FIRESTORE_EMULATOR_HOST}` : 'LIVE'}`
  );
  console.log(`  Models    : ${MODELS.join(' → ')}`);
  console.log(
    `  Storage   : ${process.env.FIREBASE_STORAGE_BUCKET ?? '(FIREBASE_STORAGE_BUCKET unset!)'}`
  );
  console.log(
    `  Phases    : ${Object.entries(phases)
      .filter(([, v]) => v)
      .map(([k]) => k)
      .join(', ')}`
  );
  console.log(`  Dry run   : ${DRY_RUN}${FORCE ? '   force: true' : ''}`);
  console.log('');

  // ── covers ────────────────────────────────────────────────────────────────
  if (phases.covers) {
    const snap = await db.collection('entities').where('universeAddress', '==', UNIVERSE_ID).get();
    let targets = snap.docs
      .map((d) => ({ ref: d.ref, ...(d.data() as any) }))
      .filter((e) => FORCE || !e.imageUrl);
    if (ONLY) targets = targets.filter((e) => String(e.name).toLowerCase().includes(ONLY));
    targets.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    if (LIMIT !== Infinity) targets = targets.slice(0, LIMIT);

    console.log(`  covers: ${snap.size} entities, ${targets.length} to (re)generate\n`);
    let ok = 0;
    for (const e of targets) {
      const ar = aspectFor(e.name, e.kind);
      const prompt = promptFor(e.name, e.kind, e.description);
      console.log(`  • ${e.name} (${e.kind}, ${ar})`);
      if (DRY_RUN) {
        console.log(`      ${prompt.slice(0, 140)}…`);
        continue;
      }
      try {
        const img = await generate(prompt, ar);
        const url = await host(
          img.base64,
          img.mimeType,
          `ta-${String(e.name)
            .replace(/[^a-z0-9]+/gi, '-')
            .toLowerCase()}.png`
        );
        await e.ref.update({ imageUrl: url, updatedAt: new Date() });
        console.log(`      ✓ ${url}`);
        ok++;
      } catch (err: any) {
        console.log(`      ✗ ${err?.message?.slice(0, 240) ?? err}`);
      }
      await sleep(1500);
    }
    console.log(`\n  covers done — ${ok}/${targets.length}\n`);
  }

  // ── hero ──────────────────────────────────────────────────────────────────
  if (phases.hero) {
    const landscape =
      'Key art for "TECHNO ANTICHRIST": a lean, sleep-starved South Asian American man in dark plain tech-founder clothes at a lectern in a rented hall, ' +
      'lit by one follow-spot through heavy haze, a gilt Bitcoin-rune slab on the podium; behind and above him a fluorescent conference-room ceiling dissolves into an orbital weapons platform over a night city; ' +
      'a faint branching node-graph of gods projected across the back wall. Cinematic poster composition, wide. ' +
      STYLE;
    const portrait =
      'Vertical key art for "TECHNO ANTICHRIST": close on the same man, three-day stubble, a hairline nosebleed he is ignoring, amber follow-spot on one side of his face and cold fluorescent on the other, ' +
      'a gilt rune inscription out of focus behind him, a single strip of aluminium foil catching light at frame edge. Portrait poster composition. ' +
      STYLE;

    console.log('  hero: landscape + portrait');
    if (DRY_RUN) {
      console.log(`      L: ${landscape.slice(0, 120)}…`);
      console.log(`      P: ${portrait.slice(0, 120)}…`);
    } else {
      const patch: Record<string, unknown> = { updated_at: new Date() };
      try {
        const l = await generate(landscape, '16:9');
        patch.image_url = await host(l.base64, l.mimeType, 'ta-hero-landscape.png');
        console.log(`      ✓ landscape ${patch.image_url}`);
      } catch (err: any) {
        console.log(`      ✗ landscape ${err?.message?.slice(0, 200) ?? err}`);
      }
      await sleep(1500);
      try {
        const p = await generate(portrait, '9:16');
        patch.portrait_image_url = await host(p.base64, p.mimeType, 'ta-hero-portrait.png');
        console.log(`      ✓ portrait ${patch.portrait_image_url}`);
      } catch (err: any) {
        console.log(`      ✗ portrait ${err?.message?.slice(0, 200) ?? err}`);
      }
      if (patch.image_url || patch.portrait_image_url) {
        await db.collection('cinematicUniverses').doc(UNIVERSE_ID).update(patch);
        console.log('      universe doc updated');
      }
    }
  }

  console.log('\n' + '='.repeat(66));
  console.log(`  Done — /universe/${UNIVERSE_ID}`);
  console.log('='.repeat(66) + '\n');
  process.exit(0);
}

main().catch((err) => {
  console.error('\nFAILED:', err?.message ?? err);
  process.exit(1);
});
