/**
 * Dry-run preview for the ZAI regen sample. Read-only — no ZAI calls, no
 * Pinata pinning, no Firestore writes. Just shows:
 *
 *   - which universes will be touched
 *   - which entities are used as the seed for the video prompt
 *   - the actual prompt string that would go to viduq1-text + glm-image
 *   - which entities will get an image portrait
 *
 * Once the operator is happy, the real script flips dry-run off and burns
 * the budget.
 */
import dotenv from 'dotenv';
import path from 'path';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

type Pick = {
  uniName: string;
  uniAddr: string;
  uniDesc: string;
  // Entities used to seed the scene
  scenePerson?: any;
  scenePlace?: any;
  // Entity portraits for the 5 images
  imageTargets: any[];
  videoPrompt: string;
};

function pickRandom<T>(arr: T[]): T | undefined {
  return arr[Math.floor(Math.random() * arr.length)];
}

function buildVideoPrompt(opts: {
  uniName: string;
  uniDesc: string;
  person?: any;
  place?: any;
}): string {
  const personLine = opts.person
    ? `${opts.person.name}${opts.person.description ? ` — ${String(opts.person.description).slice(0, 200)}` : ''}`
    : null;
  const placeLine = opts.place
    ? `${opts.place.name}${opts.place.description ? ` — ${String(opts.place.description).slice(0, 200)}` : ''}`
    : null;

  // Cinematic-scene-from-entities template. Designed for viduq1-text (5s clip).
  return [
    `Cinematic establishing shot from "${opts.uniName}".`,
    placeLine ? `Setting: ${placeLine}` : null,
    personLine ? `Character: ${personLine}` : null,
    `Style: ${opts.uniDesc.slice(0, 240)}`,
    `Camera: slow dolly-in, atmospheric lighting, photoreal, 5 seconds.`,
  ]
    .filter(Boolean)
    .join('\n');
}

async function main() {
  const existing = getApps()[0];
  let db;
  if (existing) {
    db = getFirestore(existing);
  } else {
    const sa = JSON.parse(readFileSync('firebase-sa-key-20260416.json', 'utf-8'));
    const app = initializeApp({ credential: cert(sa) });
    db = getFirestore(app);
    db.settings({ preferRest: true });
  }

  // The 2 target universes for video
  const TARGET_VIDEO = [
    '0x228295466c531c1d55b9dfdd5cf15ad0b88782fa', // Space Fleet (real)
    '0x8e5cddb763534fe426766e4eb035449fb9e73913', // Vacation Bunny
  ];

  const picks: Pick[] = [];
  for (const addr of TARGET_VIDEO) {
    const uniDoc = await db.collection('cinematicUniverses').doc(addr).get();
    if (!uniDoc.exists) {
      console.log(`SKIP ${addr} — universe doc missing`);
      continue;
    }
    const u = uniDoc.data() as any;
    const entSnap = await db
      .collection('entities')
      .where('universeAddress', '==', addr.toLowerCase())
      .get();
    const entities = entSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));

    const persons = entities.filter((e) => e.kind === 'person');
    const places = entities.filter((e) => e.kind === 'place');
    const things = entities.filter((e) => e.kind === 'thing');

    const scenePerson = pickRandom(persons);
    const scenePlace = pickRandom(places);

    // 2-3 image targets per universe (will distribute 5 total across 2 universes)
    const imageTargets = [
      scenePerson,
      scenePlace,
      pickRandom(things) || pickRandom(persons),
    ].filter(Boolean);

    const videoPrompt = buildVideoPrompt({
      uniName: u.name,
      uniDesc: u.description || '',
      person: scenePerson,
      place: scenePlace,
    });

    picks.push({
      uniName: u.name,
      uniAddr: addr,
      uniDesc: (u.description || '').slice(0, 100),
      scenePerson,
      scenePlace,
      imageTargets,
      videoPrompt,
    });
  }

  console.log('\n══════════════ DRY RUN ══════════════');
  console.log('No paid API calls. No writes. Preview only.\n');

  for (const p of picks) {
    console.log(`\n━━━ ${p.uniName} (${p.uniAddr.slice(0, 10)}…) ━━━`);
    console.log(`Universe blurb: ${p.uniDesc}…\n`);
    console.log(`▸ Video seed entities:`);
    console.log(
      `    person: ${p.scenePerson ? `${p.scenePerson.name}  (id ${p.scenePerson.id.slice(0, 8)}…)` : '(none)'}`
    );
    console.log(
      `    place:  ${p.scenePlace ? `${p.scenePlace.name}  (id ${p.scenePlace.id.slice(0, 8)}…)` : '(none)'}`
    );
    console.log(`\n▸ Video prompt that would be sent to viduq1-text:`);
    console.log(
      p.videoPrompt
        .split('\n')
        .map((l) => `    ${l}`)
        .join('\n')
    );
    console.log(`\n▸ Image portraits to generate (glm-image):`);
    for (const t of p.imageTargets) {
      console.log(`    - ${t.kind.padEnd(8)} ${t.name}  (id ${t.id.slice(0, 8)}…)`);
    }
  }

  // Image-target distribution: limit to 5 total
  const allImageTargets = picks.flatMap((p) =>
    p.imageTargets.map((t) => ({ uniName: p.uniName, uniAddr: p.uniAddr, entity: t }))
  );
  console.log(
    `\nImage budget: 5. Available portrait targets: ${allImageTargets.length}. Will pick first 5 across both universes.`
  );

  console.log(`\n══════════════ COSTS ══════════════`);
  console.log(`  2× viduq1-text      ≈ $1.00  (Vidu Q1 ~$0.40-0.60/clip)`);
  console.log(`  5× glm-image        ≈ $0.05`);
  console.log(`  ~25× GLM-4.5-Flash  = $0      (free)`);
  console.log(`  Estimate: ~$1.05    Headroom on $10 budget: ~$8.95`);
  console.log(`\nReady to run for real? Re-run script with --apply (not yet implemented).`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
