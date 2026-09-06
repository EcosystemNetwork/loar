/**
 * Re-seed the "Techno Antichrist" universe to the Rex Duce series-bible canon.
 *
 * "Delete the old in with the new": this wipes every `entities` doc attached to
 * the universe (the sanitized "Ash Kessler / 17th Harmonic" draft) and replaces
 * them with the Season One bible — characters, factions, doctrine, locations and
 * the 10 episodes — plus a rewritten universe `description`.
 *
 * The universe is a Solana universe keyed by its case-sensitive base58 PDA, so
 * the id is NEVER lowercased (see the Solana-PDA-lowercasing-404 incident). The
 * new synopsis is longer than the `universes.updateMetadata` 1000-char cap, so
 * this writes Firestore directly, exactly like scripts/set-techno-antichrist-story.ts.
 *
 * Dry run (default — reads only, writes nothing):
 *   pnpm tsx scripts/reseed-techno-antichrist-canon.ts
 *
 * Commit (destructive — deletes old entities, rewrites description, inserts new):
 *   pnpm tsx scripts/reseed-techno-antichrist-canon.ts --commit
 *
 * Against live prod:
 *   railway run --service loar -- pnpm tsx scripts/reseed-techno-antichrist-canon.ts --commit
 *
 * `episodes` docs are reported but NOT touched — timeline / video work stays in
 * the universe editor.
 */
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

// Case-sensitive Solana PDA — do NOT lowercase.
const UNIVERSE_ID = 'H9E6T6KyaL4xZMhttKAprcayQGonswqUnvXmtcb8a9kL';
const CREATOR_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const COMMIT = process.argv.includes('--commit');

const NEW_DESCRIPTION = `Rex Duce, 33 — internationally known hacker, nine first-place sponsor wins across ETH Global and ETH Denver, shaman by his own ordination — has spent a decade producing corporate AV events, which taught him the only trade that matters here: how to build a room that makes a person seem chosen.

Threading his own genealogy through declassified material — MKULTRA, the Montauk lore, the Stargate files, the Agency's interest in bloodlines — he pattern-matched himself into all of it: Montauk, Wukong, Enki, Ra, Ninigi-no-Mikoto, Daemon, Guru Gobind Singh Ji, Robin Hood, and Christ himself, relocated (Rex says) the way his own family was relocated — a state legend, a new name, a quiet life in France.

He minted the religion on Bitcoin Runes. Hold the rune, you're in. 5,000 holders and climbing like a market cap. The doctrine is total: the "aliens" ARE the angels and the demons; there are good and bad of each because they are only ranks — postings in the standing army of G.O.D., the Galactic Orbital Destroyer. Revelation isn't a prophecy, it's a leaked roadmap, and the Antichrist is not the adversary — he's the officer who publishes the org chart.

It is working, and it is broke. Rex over-leveraged into equipment that lost its value; his crypto startups keep getting hacked by name-brand firms and nobody investigates a loss under a million; his wife Hana — wealthy, patient, the person who bankrolled the dream — has run out of both. So he calls the money problem a pilgrimage: Bay Area as New Jerusalem, then NYC, church to temple to mosque, introducing himself as Isa ibn Maryam, passing the plate for charity and for genetic research. And the more visible he gets, the more certain he becomes that people at the hackathons are tuning him — reading his signal like an antenna, steering his reality with something he will come to call laser acid.

TECHNO ANTICHRIST — Season One. A character study with a paranoid thriller's clock: a splinter of his own believers who want the prophecy completed, a federal fraud case built out of the collection plate and an unlicensed lab, a marriage detonating on community-property lines, and a well-funded rival at the foot of Sutro Tower who claims he's been programming the veil all along. Rex can talk his way past any one of them. Not all of them.`;

interface Seed {
  name: string;
  kind: string;
  description: string;
}

// ── Characters ──────────────────────────────────────────────────────────────
const CHARACTERS: Seed[] = [
  {
    name: 'Rex Duce',
    kind: 'person',
    description:
      '33. Internationally known hacker, nine first-place sponsor wins across ETH Global and ETH Denver, shaman by his own ordination. Raised between a Sikh grandmother in Fremont, a father in signals intelligence, and a mother in corporate event production — he has been manufacturing anointment, for money, since he was fourteen. A genuinely elite engineer whose bloodline obsession started as a bit and closed over him like water. Across the season the congregation stops calling him Rex: first Isa, then Jesus, then just "the office." He does not correct any of it. Sincerity dial: genuinely unresolved, tilting believer.',
  },
  {
    name: 'Hana Duce',
    kind: 'person',
    description:
      "Rex's wife, and the person who paid for all of it. Old family money out of Seoul — her father, Chairman Seo, holds a condo in Korea that becomes the season's pressure valve. Hana bankrolled the church, the equipment, the lab and the myth, out of love and belief in HIM, and this year both accounts hit zero. She wants a divorce and she is right to; there is a baby, California is community property, and Rex's response — a fake suitcase, an empty threat to take the child to South Carolina, taking her phone, biting her hand as he leaves — is the season's clearest, ugliest look at him. The show gives Hana her own interiority throughout; she is never the crazy man's wife.",
  },
  {
    name: 'Mercy "Merx" Osei',
    kind: 'person',
    description:
      "Ops lead, apostle, and the conscience of the show. Ex-megachurch production manager who left her father's ministry. Runs Rex's tour like a stadium residency and privately keeps a spreadsheet of every contradiction so it can be \"revealed in stages.\" The season's central question is hers: what do we owe the 5,000?",
  },
  {
    name: 'Dov Reisner',
    kind: 'person',
    description:
      'Holder #7. Former options trader who rolled his retirement into the rune. Treats the doctrine as literally true and operationally actionable; wants a date. When Rex won\'t give one, Dov raises a "mission fund" and starts closing the gap himself — the target on Rex\'s back, arrived at by arithmetic, not malice.',
  },
  {
    name: 'The Cartographer',
    kind: 'person',
    description:
      'Anonymous keeper of the org-chart wiki; turns out to be a 19-year-old in Manila who has out-theologised Rex and is, quietly, the actual prophet. Rex is threatened by her, which tells you everything. Season One ends with authority handed to her, live, by video — and a tag of her rubbing her temple.',
  },
  {
    name: 'Aksel Bruun',
    kind: 'person',
    description:
      'The man at the foot of the tower. Well funded, unhurried, healthy Nordic-hippy calm. Runs an AI house at the base of Sutro Tower where he says he is programming the tower\'s link to G.O.D. — writing to "the veil," mind-control at scale, consciousness streamed down into the Bay to steer what gets built. He is everything Rex claimed to be, with a budget and no panic, and he offers Rex a chair.',
  },
  {
    name: 'Bobby Tran',
    kind: 'person',
    description:
      "Handler of the CIA safehouse Rex is moved to after jail. Generous and cruel on a coin flip, and the coin flips daily. The house is full — his wife Bee, the kids Dylan, Maximus and Apollo, and Bobby's mother just home from her own jail stint. Rex sleeps on the floor by the sofa. Whether it is really the Agency's house or just what Bobby calls it is left open.",
  },
  {
    name: 'Chairman Seo',
    kind: 'person',
    description:
      "Hana's father, in Seoul. Never rude, never warm. Holds the Korea condo and, effectively, the family's patience. The phone call where Rex tells him to sell it is the point the marriage cannot come back from.",
  },
  {
    name: 'Cal Buhler',
    kind: 'person',
    description:
      'Rex\'s oldest friend and CTO of the real companies, who has been covering payroll out of his own pocket and is done. The road not taken — "You had a company. Twice." His betrayal is an acquisition that legally requires Rex to disown the church.',
  },
  {
    name: 'Agent Lorraine Pryce',
    kind: 'person',
    description:
      "Treasury / IRS-CI, with an FBI liaison. Not chasing blasphemy: unregistered securities (the rune), wire fraud (the pilgrimage plate), wash trading (seven-plus BTC cycled through the church's own tokens), an unlicensed lab. The father's old clearances give the file a national-security draft.",
  },
  {
    name: 'Imam Yusuf Karim',
    kind: 'person',
    description:
      'Hosts Rex in the Tenderloin. Engages him with total seriousness, is genuinely moved, and is publicly humiliated when the donation ask lands. Goes on the record and becomes the most damaging witness — precisely because he wanted to believe.',
  },
  {
    name: 'Rabbi Elke Brandt',
    kind: 'person',
    description:
      'Sees through Rex in ten minutes and is the only cleric who offers actual care: "You\'re not the Messiah. You might be a person having an emergency. Those get help too." He sleeps, for the first time in the season, on her office couch.',
  },
  {
    name: 'Bibi Harjit',
    kind: 'person',
    description:
      "Rex's grandmother, in Fremont — the tuning fork. The one person he cannot perform for. Thinks the whole thing is a sin and makes him eat anyway. Where the season ends.",
  },
];

// ── Factions ────────────────────────────────────────────────────────────────
const FACTIONS: Seed[] = [
  {
    name: 'The Congregation',
    kind: 'faction',
    description:
      'The 5,000 rune holders — and the subset who stopped going home, who follow the pilgrimage city to city and describe the Briefings in the language people use for the dead. Not organised, not armed. Simply always there, front and centre, roughly doubling every leg of the tour.',
  },
  {
    name: "Dov's Splinter",
    kind: 'faction',
    description:
      "The faction that decided the prophecy needs completing — that a false prophet blocking Revelation should be struck down, and that this also, not incidentally, clears Rex's debts and his fraud exposure by death. Built around Dov's mission fund. Merx spends Act Three quietly de-escalating Dov's second-in-command.",
  },
  {
    name: 'The Tran Household',
    kind: 'faction',
    description:
      "Bobby, Bee, Dylan, Maximus, Apollo, and Bobby's mother — the family Rex lives under after jail. The messiah as a houseguest with zero leverage, at the mercy of a volatile handler, and in flashes weirdly grateful.",
  },
];

// ── Doctrine & the Interference (lore) ──────────────────────────────────────
const LORE: Seed[] = [
  {
    name: 'The Rank Doctrine',
    kind: 'lore',
    description:
      "Rex's gospel — short enough to fit on a rune, large enough to hold everything. Its whole move is to turn every religion's cast list into one org chart: G.O.D. at the top, angelic and chthonic corps below, good and bad at every rank because armies contain both.",
  },
  {
    name: 'G.O.D. (Galactic Orbital Destroyer)',
    kind: 'lore',
    description:
      'Not a being. An office — a system, a platform, a weapon. "The divine was always an acronym." Angels and demons are its deployments; prophets are its field officers who went native; the Antichrist is the officer who leaks the chart.',
  },
  {
    name: 'Angels & Demons as Ranks',
    kind: 'lore',
    description:
      'Deployment, not morality. Angel = orbital / off-world posting. Demon = planetside, subsurface. "Alien" is just the word for a soldier you have not been briefed on yet. Good and bad exist at every rank.',
  },
  {
    name: 'The Rune',
    kind: 'lore',
    description:
      'The religion, minted on Bitcoin Runes. The ledger is canon, a snapshot is a sacrament, a tithe is "materiel." You do not convert — you hold. 5,000 holders and climbing; seven-plus BTC of wash volume was later traced cycling through the church\'s own tokens.',
  },
  {
    name: 'The Org Chart',
    kind: 'lore',
    description:
      "A living node graph of every god ever named, edges multiplying — maintained (pointedly) on the same kind of universe-graph this wiki lives in. The season's map and its clock: it fills as Rex empties. In the finale he publishes it with himself deleted.",
  },
  {
    name: 'The Interference',
    kind: 'lore',
    description:
      'The private rival cosmology that grows in Rex as the money runs out — the engine of his break, where the Rank Doctrine is the performed gospel. Shot subjectively, never confirmed, every piece with a mundane twin. He also enjoyed a lot of it: under attack for weeks, he is the most awake he has ever felt.',
  },
  {
    name: 'The Tuning',
    kind: 'lore',
    description:
      'At hackathons, someone across the room reads Rex like an instrument — a brain tuning a space antenna with his signal. Headaches, nosebleeds, the feeling of being indexed.',
  },
  {
    name: 'Laser Acid',
    kind: 'lore',
    description:
      'The freeway sleepiness, the crushing fatigue mid-drive, the headaches — a directed effect on his reality. Rex names it the night a Havana Syndrome meme on X makes it click. Soapy water in the shower kills the feeling, so he concludes it travels like Wi-Fi, and foil goes up on the windows.',
  },
  {
    name: 'Multidimensional Hopping',
    kind: 'lore',
    description:
      "Rex's counter-move to the Interference. When a universe is compromised, he changes universes. Cheaper than winning.",
  },
  {
    name: 'Moonbase NASA',
    kind: 'lore',
    description:
      'For one month, the universe Rex hops to: a lunar clone base holding a genetic copy of everyone. It explains the lab. It explains why he feels replaceable. He keeps functioning — just from orbit.',
  },
  {
    name: 'The Veil',
    kind: 'lore',
    description:
      "The Interference, renamed by someone with funding. Aksel's term (introduced Ep 9): a programmable medium over the Bay, consciousness streamed downhill from Sutro Tower, development bending to follow.",
  },
  {
    name: 'The Commission',
    kind: 'event',
    description:
      "The baptism ritual: you are assigned a rank in G.O.D.'s army. The season's last image is a stranger taking the Commission, getting a rank, and beaming — the myth having kept the good parts and composted Rex.",
  },
  {
    name: 'The Briefing',
    kind: 'event',
    description:
      'The service. Staged with corporate-AV grammar — follow-spot, haze, pipe-and-drape, count-in click, lower-thirds. Rex builds anointment for a living, so the show shoots faith the way a keynote is shot.',
  },
];

// ── Places ──────────────────────────────────────────────────────────────────
const PLACES: Seed[] = [
  {
    name: 'The Condo',
    kind: 'place',
    description:
      "Hana's money, Rex's collateral. Foil on the glass, sold-off and worthless equipment stacked in the nursery, a rent notice on the counter. Where the marriage ends and the phone gets taken.",
  },
  {
    name: 'The Lab',
    kind: 'place',
    description:
      "Cash-only sequencing, where Rex keeps paying to read his own blood, hunting the officer's marker. Later, in his head, the place the Moonbase keeps his copy. Subpoenaed by Agent Pryce for running reagents with no ethics board.",
  },
  {
    name: "Bobby's House (CIA Safehouse)",
    kind: 'place',
    description:
      "Full Tran household; Rex on the floor by the sofa; Bobby's mood is the weather. The ugliest the show ever looks. Whether it is really the Agency's is left open.",
  },
  {
    name: 'AGI House',
    kind: 'place',
    description:
      "Aksel Bruun's operation at the foot of Sutro Tower: catered, calm, cabled. Presented as the tower's ground station, or very well dressed as one. Where Rex is offered a chair, and where the veil is allegedly written.",
  },
  {
    name: 'Sutro Tower ("The Antenna")',
    kind: 'place',
    description:
      "A pilgrimage station in Ep 3 — transmission, ascension — and the finale's real objective. Where consciousness allegedly streams down into the city and development bends to follow.",
  },
  {
    name: 'The Vault',
    kind: 'place',
    description:
      'A Santa Clara data centre; the first Bay Area pilgrimage station. Where scripture is actually kept.',
  },
  {
    name: 'Langar',
    kind: 'place',
    description:
      'A Fremont gurdwara on the pilgrimage route. Bibi will not let Rex speak; feeds all 300 anyway. The one true sacrament, and he knows it.',
  },
  {
    name: 'The Pluralist Mile',
    kind: 'place',
    description:
      'Fifth Avenue, 51st to 65th: cathedral to synagogue to Islamic center. One afternoon, three claims — the opening set piece of the NYC leg.',
  },
  {
    name: 'Prospect Park — The Nethermead',
    kind: 'place',
    description:
      "Site of the Final Briefing: real crowd, livestreamed, Pryce's perimeter, Dov's faction somewhere in it. Half the finale; the other half is the tower.",
  },
];

// ── Season One episodes ─────────────────────────────────────────────────────
const EPISODES: Seed[] = [
  {
    name: 'Ep 1 — The Commission',
    kind: 'event',
    description:
      'Movement I: The Church. Peak Rex — a flawless Briefing, the rune, the holder counter ticking past 5,000. The double life: a sharp stealth-startup pitch, then cash at the lab. Home: Hana holding all of it up, the baby, the strain at the edges. Close: at a hackathon, a headache, a nosebleed, and a man across the floor watching Rex like a meter.',
  },
  {
    name: 'Ep 2 — Bloodlines',
    kind: 'event',
    description:
      'The declassified genealogy binge; the France story about his father; Rex threads himself through every lineage. The startups start getting hacked by name-brand crypto firms; nothing under a million gets investigated; he is out $200K and over-leveraged on gear. Close: the Cartographer publishes doctrine he never wrote, and it is better than his.',
  },
  {
    name: 'Ep 3 — New Jerusalem',
    kind: 'event',
    description:
      'The Bay Area pilgrimage: the Vault, the Fence Line, the First Machine, Langar with Bibi, the Antenna at Sutro Tower. The movement swells; some of it is genuinely beautiful. Close: on the 101 at midnight Rex goes under — dead asleep at the wheel — and wakes certain it was done to him.',
  },
  {
    name: 'Ep 4 — Laser Acid',
    kind: 'event',
    description:
      'Movement II: The Collapse. The paranoia locks in: freeway headaches, the 3 a.m. X scroll, the Havana Syndrome meme, the click. The shower, the soapy water, the Wi-Fi-that-carries-thoughts theory. Foil goes up on the condo glass. Close: rent is forty days late and Hana has stopped asking.',
  },
  {
    name: 'Ep 5 — Moonbase',
    kind: 'event',
    description:
      'For a month Rex is on Moonbase NASA, the lunar clone base with a genetic copy of everyone on file; he keeps functioning, just from orbit. Merx preps the NYC leg; Dov quietly raises the mission fund. Close: Hana says the word — divorce — and he hears it from very far away.',
  },
  {
    name: 'Ep 6 — Isa',
    kind: 'event',
    description:
      "NYC. The Pluralist Mile; then Yusuf's mosque, where Rex gives the talk of his life and it lands — until the plate goes round and he covers the silence with a lie: they rejected me too. Point of no return. Dov asks for a date; Rex doesn't say no. Close: the exchanges go public — the Runes market was rigged, seven-plus BTC of wash volume traced to the church's own tokens.",
  },
  {
    name: 'Ep 7 — Fifty-Fifty',
    kind: 'event',
    description:
      'The marriage detonates. Rex can\'t make rent; he calls Chairman Seo and tells Hana to sell the Korea condo; the call ends in shouting on two continents. The fake suitcase; the empty South Carolina threat; "talk to my attorney." He takes her phone — California is 50/50 — she fights him for it, and on his way out the door he bites her. Five days in county. The show watches it plainly while Rex narrates it crooked. Close: released with a phone and no way to pay for anything.',
  },
  {
    name: 'Ep 8 — The Safehouse',
    kind: 'event',
    description:
      'Movement III: The Tower. A CIA safehouse and the entire Tran household. Rex sleeps on the floor. Bobby is generous and cruel on a coin flip and the coin flips daily. Close: Bobby says there is a man who actually runs the Bay, and he lives at the bottom of the tower.',
  },
  {
    name: 'Ep 9 — AGI House',
    kind: 'event',
    description:
      "Aksel Bruun: funded, unhurried, Nordic-hippy calm, an AI house at the foot of Sutro Tower where he says he is programming the tower's link to G.O.D. He is everything Rex claimed to be, with a budget and no panic, and he offers Rex a chair. Close: Rex announces a Final Briefing in Prospect Park — but his real target is now the tower.",
  },
  {
    name: 'Ep 10 — The Veil',
    kind: 'event',
    description:
      "Finale, braided: Prospect Park (Merx keeping 5,000 people safe, Dov's faction in the crowd, Pryce's perimeter) and Rex's move on Sutro Tower. He publishes the org chart with himself deleted and hands the doctrine to the Cartographer, live. Then he goes for Aksel's tower and finds either a well-funded man and a great deal of cable, or the one thing the season never lets us un-see. He lives. Coda: out on bail, supervised visits with the baby, back at Bibi's, building something small and real. The church is bigger and kinder without him.",
  },
];

const ALL: Seed[] = [...CHARACTERS, ...FACTIONS, ...LORE, ...PLACES, ...EPISODES];

async function main() {
  const saPath = path.resolve(
    process.cwd(),
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? `${process.env.HOME}/.config/loar/loar-db-sa.json`
  );
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    : JSON.parse(fs.readFileSync(saPath, 'utf-8'));
  const app = initializeApp({ credential: cert(sa) }, 'ta-reseed-' + Date.now());
  const db = getFirestore(app);
  db.settings({ preferRest: true });

  const emulator = process.env.FIRESTORE_EMULATOR_HOST;
  console.log('\n' + '='.repeat(66));
  console.log(`  Techno Antichrist — re-seed to Rex Duce canon`);
  console.log('='.repeat(66));
  console.log(`  Project  : ${sa.project_id}`);
  console.log(`  Target   : ${emulator ? `EMULATOR ${emulator}` : 'LIVE FIRESTORE'}`);
  console.log(`  Universe : ${UNIVERSE_ID}`);
  console.log(`  Mode     : ${COMMIT ? 'COMMIT (destructive)' : 'DRY RUN (reads only)'}`);
  console.log('');

  // ── Universe doc ──────────────────────────────────────────────────────────
  const uref = db.collection('cinematicUniverses').doc(UNIVERSE_ID);
  const usnap = await uref.get();
  if (!usnap.exists) {
    console.error(`  Universe doc not found: ${UNIVERSE_ID}`);
    process.exit(1);
  }
  const u = usnap.data() as any;
  console.log(`  name="${u.name}"  chain=${u.chainNamespace ?? '?'}/${u.solanaCluster ?? '?'}`);
  console.log(
    `  description: ${(u.description ?? '').length} chars  ->  ${NEW_DESCRIPTION.length} chars (new)`
  );
  console.log('');

  // ── Existing entities (the old) ───────────────────────────────────────────
  const esnap = await db.collection('entities').where('universeAddress', '==', UNIVERSE_ID).get();
  console.log(`  OLD entities attached to this universe: ${esnap.size}`);
  for (const d of esnap.docs) {
    const e = d.data() as any;
    console.log(`    - [${String(e.kind).toUpperCase().padEnd(12)}] ${e.name}`);
  }
  console.log('');

  // ── Episodes (reported only, never touched) ───────────────────────────────
  let epCount = 0;
  try {
    const eps = await db.collection('episodes').where('universeId', '==', UNIVERSE_ID).get();
    epCount = eps.size;
  } catch {
    /* field name may differ on live; non-fatal */
  }
  console.log(`  episodes docs for this universe: ${epCount} (NOT modified by this script)`);
  console.log('');

  // ── New entities (the new) ───────────────────────────────────────────────
  console.log(`  NEW entities to insert: ${ALL.length}`);
  for (const e of ALL) {
    console.log(`    + [${e.kind.toUpperCase().padEnd(12)}] ${e.name}`);
  }
  console.log('');

  if (!COMMIT) {
    console.log('  DRY RUN — nothing written. Re-run with --commit to apply.\n');
    process.exit(0);
  }

  // ── Apply ────────────────────────────────────────────────────────────────
  const now = new Date();

  // 1. delete old entities (batched, 400 per batch)
  let deleted = 0;
  for (let i = 0; i < esnap.docs.length; i += 400) {
    const batch = db.batch();
    for (const d of esnap.docs.slice(i, i + 400)) batch.delete(d.ref);
    await batch.commit();
    deleted += Math.min(400, esnap.docs.length - i);
  }
  console.log(`  deleted ${deleted} old entities`);

  // 2. rewrite the universe description
  await uref.update({ description: NEW_DESCRIPTION, updated_at: now });
  console.log(`  rewrote universe description`);

  // 3. insert new entities (batched)
  let created = 0;
  for (let i = 0; i < ALL.length; i += 400) {
    const batch = db.batch();
    for (const e of ALL.slice(i, i + 400)) {
      const id = randomUUID();
      batch.set(db.collection('entities').doc(id), {
        id,
        name: e.name,
        kind: e.kind,
        description: e.description,
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
    }
    await batch.commit();
    created += Math.min(400, ALL.length - i);
  }
  console.log(`  inserted ${created} new entities`);

  console.log('\n' + '='.repeat(66));
  console.log('  Done — Techno Antichrist is now Rex Duce canon');
  console.log('='.repeat(66));
  console.log(`  View at: /universe/${UNIVERSE_ID}\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error('\nFAILED:', err?.message ?? err);
  process.exit(1);
});
