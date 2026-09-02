/**
 * One-off: replace the "Techno Antichrist" universe profile story.
 *
 * The universe is a Solana universe keyed by its case-sensitive base58 PDA,
 * and the new synopsis is longer than the `universes.updateMetadata` 1000-char
 * cap, so this writes Firestore directly.
 *
 *   railway run --service loar -- pnpm tsx scripts/set-techno-antichrist-story.ts
 */
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const UNIVERSE_ID = 'H9E6T6KyaL4xZMhttKAprcayQGonswqUnvXmtcb8a9kL';

const NEW_DESCRIPTION =
  "A Internationally known hacker Rex Duce age 33 a shaman with all the bloodlines of Montauk, Wukong, Ennki, Ra, Ninigi-No-Mikoto, Daemon, Jesus Christ (Because he was in a witness protection program & moved to france), Guru Gobind Singh Ji, Robinhood age 33 who won 9 1st place sponsor wins at ETH NOBLE & ETH Member HACKATHONS, has created an entire religion on bitcoin runes around him being the antichrist he started linking his genealogy to all the illuminati bloodlines that he found in declassified CIA documents, then started fulfilling biblical prophecy creating a new gospel treating the Bay Area as New Jewresalem, & NYC as another pilgrimage to visit all types of churches, temples, etc spreading that he was the Jesus figure in every religion, but also living a life a successful tech entrepreneur producing over 500 corporate AV events, many stealth crypto start ups projects ready to launch, this project his religion the new gospel basically just saying aliens are angels & demons & there are good demons & bad demons & good angels & bad angels because it's just a rank in the army of G.O.D. which stands for Galactic Orbital Destroyer, and it started getting really big with 5000 holders but he was also running out of money and after he did a pilgrimage where he started going to all the jewish temples, & mosque,etc claiming to be their god (higher energy being) asking for money for charity but also to fund his genetic research, but putting himself out there also put a target on his back.";

async function main() {
  const saPath = path.resolve(
    process.cwd(),
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? `${process.env.HOME}/.config/loar/loar-db-sa.json`
  );
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    : JSON.parse(fs.readFileSync(saPath, 'utf-8'));
  const app = initializeApp({ credential: cert(sa) }, 'ta-story-' + Date.now());
  const db = getFirestore(app);
  db.settings({ preferRest: true });

  const ref = db.collection('cinematicUniverses').doc(UNIVERSE_ID);
  const snap = await ref.get();
  if (!snap.exists) {
    console.error('Universe doc not found:', UNIVERSE_ID);
    process.exit(1);
  }
  const before = snap.data() as any;
  console.log(`Before: name="${before.name}"`);
  console.log(`Before description (${(before.description ?? '').length} chars):`);
  console.log(before.description ?? '(none)');
  console.log('');

  await ref.update({ description: NEW_DESCRIPTION, updated_at: new Date() });

  const after = (await ref.get()).data() as any;
  console.log(`After description (${after.description.length} chars):`);
  console.log(after.description);

  process.exit(0);
}

main().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
