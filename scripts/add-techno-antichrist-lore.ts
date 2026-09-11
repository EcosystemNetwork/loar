/**
 * One-off: add a handful of new wiki entities to the Techno Antichrist universe
 * — texture from later development material, fictionalized (no real names).
 * Additive only — does not touch the existing 48 entities.
 *
 *   railway run --service loar -- pnpm tsx scripts/add-techno-antichrist-lore.ts --live --dry-run
 *   railway run --service loar -- pnpm tsx scripts/add-techno-antichrist-lore.ts --live --commit
 */
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
if (process.argv.includes('--live')) delete process.env.FIRESTORE_EMULATOR_HOST;

const UNIVERSE_ID = 'H9E6T6KyaL4xZMhttKAprcayQGonswqUnvXmtcb8a9kL';
const CREATOR_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const COMMIT = process.argv.includes('--commit');

interface Seed {
  name: string;
  kind: string;
  description: string;
}

const NEW: Seed[] = [
  {
    name: 'The Mentors',
    kind: 'lore',
    description:
      'A doctrine unique to Rex\'s private notebooks — never preached from the pulpit. That the office speaks through whoever is already loudest: a founder, a fighter, a comic, a singer, none of whom have met him. Their posts, lyrics, interviews arrive to him as directives, warnings, blessings. He keeps a running private ledger of who reads as "clean signal" and who reads as "compromised." The show never names a real public figure and never confirms or denies that any of it is real — the mentors are described only by role (the builder, the strongman, the comic, the healer), because the point isn\'t which celebrity, it\'s that fame itself reads to Rex as ordination.',
  },
  {
    name: 'The Rides',
    kind: 'lore',
    description:
      "Rex's late-night rideshare habit, reframed in his private notebooks as border-crossing — every driver and passenger a possible agent, angel, or demon in plainclothes, every route a diplomatic corridor. Most rides are just rides. A few, in his account, are negotiations: a favor asked, a debt acknowledged, a warning delivered as small talk. Merx has learned to check the app's trip history on the mornings after a bad week, the way other people check a sobriety count.",
  },
  {
    name: "The Sister's House",
    kind: 'place',
    description:
      "The one address that never makes the pilgrimage itinerary. Two hours from anywhere the Congregation knows to look. Rex goes there when a leg of the tour breaks him, sleeps without an alarm, lets someone else answer the door. The season's quietest location — no follow-spot, no haze, just a couch and a sister who has stopped asking which version of him showed up this time.",
  },
  {
    name: 'The Courtroom',
    kind: 'place',
    description:
      'Where the Ep 7 arrest resolves — fluorescent, procedural, indifferent to doctrine. Rex represents the office to a judge who has never heard of the office. The driest scene the season plays: no score, no rank, no follow-spot, just a docket number and a public defender checking the clock.',
  },
  {
    name: 'The Proof Ledger',
    kind: 'lore',
    description:
      "A private checklist Rex keeps and never publishes to the Congregation — Proof of Luck, Proof of Fortune, Proof of Fraud, Proof of Time — categories he is still trying to fill in, each one a box he believes the universe owes him evidence for. Merx found a draft of it once and didn't know whether to laugh or take his phone away. It's the clearest window the show gives into the gap between the doctrine he sells at the Briefings and the bookkeeping he does alone at 3 a.m.",
  },
];

async function main() {
  const saPath = path.resolve(
    process.cwd(),
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? `${process.env.HOME}/.config/loar/loar-db-sa.json`
  );
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    : JSON.parse(fs.readFileSync(saPath, 'utf-8'));
  initializeApp({ credential: cert(sa) });
  const db = getFirestore();
  db.settings({ preferRest: true });

  const existing = await db
    .collection('entities')
    .where('universeAddress', '==', UNIVERSE_ID)
    .get();
  const existingNames = new Set(existing.docs.map((d) => (d.data() as any).name));
  const toAdd = NEW.filter((s) => !existingNames.has(s.name));

  console.log(`Existing entities: ${existing.size}`);
  console.log(`New to add: ${toAdd.length}/${NEW.length}`);
  for (const s of toAdd) console.log(`  + [${s.kind.toUpperCase()}] ${s.name}`);

  if (!COMMIT) {
    console.log('\nDRY RUN — nothing written. Re-run with --commit to apply.');
    process.exit(0);
  }

  const now = new Date();
  for (const s of toAdd) {
    const id = randomUUID();
    await db.collection('entities').doc(id).set({
      id,
      name: s.name,
      kind: s.kind,
      description: s.description,
      universeAddress: UNIVERSE_ID,
      parentId: null,
      nodeIds: [],
      imageUrl: null,
      metadata: {},
      monetized: false,
      rightsDeclaration: null,
      unstoppableDomain: null,
      createdBy: CREATOR_ADDRESS.toLowerCase(),
      createdAt: now,
      updatedAt: now,
    });
    console.log(`  ✓ ${s.name}`);
  }
  console.log(`\nDone — ${toAdd.length} entities added.`);
  process.exit(0);
}

main().catch((err) => {
  console.error('FAILED:', err?.message ?? err);
  process.exit(1);
});
