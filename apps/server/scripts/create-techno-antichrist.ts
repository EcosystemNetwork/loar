/**
 * Create the "Techno Antichrist" universe — on Solana.
 *
 * Logline: Ash Kessler is a mid-card Berlin techno producer who finds — or is
 * handed — a tone that sits just under hearing. Played loud enough, to a big
 * enough floor, at the right tempo, it thins the wall between the room and
 * whatever stands behind it. A label with a catalogue number older than vinyl
 * signs him. Every set after that is a rite; the drop is a door. Ash tells
 * himself it is only the best crowd response of his life, right up until the
 * night he understands that the 24-hour closing set the label has booked him
 * is not a festival headline slot — it is the thing the tone was always for.
 * A gentle man mixing an apocalypse he is sure he can still pull the fader on.
 *
 * Chain: Solana (devnet). The universe address is a real base58 pubkey that
 * stands in for the on-chain Universe PDA; the Firestore mirror is written
 * with `chainNamespace: 'solana'` exactly as the server's
 * `initializeSolanaUniverse` flow would persist it. No live PDA init is done
 * here (no SOLANA_RPC_URL / Circle DCW wired for local dev) — `mintTxHash`
 * stays null, same as every other `scripts/create-*` universe seeder.
 *
 * Cover art: the repo's public asset `apps/web/public/AsianJesus.jpg`, pinned
 * to IPFS via Pinata so the cover survives independently of the web deploy.
 * Falls back to the raw https://loar.fun/AsianJesus.jpg URL if PINATA_JWT is
 * unset or Pinata is unreachable.
 *
 * Usage (Firestore emulator must be running on :8080):
 *   pnpm exec tsx apps/server/scripts/create-techno-antichrist.ts
 *
 * Re-pin / re-point just the cover on the universe already created:
 *   pnpm exec tsx apps/server/scripts/create-techno-antichrist.ts --cover-only=<universeId>
 *
 * Required env: none hard — PINATA_JWT recommended (permanent cover).
 * PINATA_GATEWAY_URL optional.
 */
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { randomUUID } from 'crypto';
import { Keypair } from '@solana/web3.js';

// ── Locate repo root & load .env ─────────────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');

function loadEnv() {
  try {
    const raw = readFileSync(path.join(REPO_ROOT, '.env'), 'utf-8');
    for (const line of raw.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq === -1) continue;
      const k = t.slice(0, eq).trim();
      let v = t.slice(eq + 1).trim();
      v = v.replace(/\s+#.*$/, '').replace(/^["']|["']$/g, '');
      if (!(k in process.env)) process.env[k] = v;
    }
  } catch {
    /* .env optional if the vars are already exported */
  }
}
loadEnv();

const PINATA_JWT = process.env.PINATA_JWT;
const PINATA_GATEWAY = process.env.PINATA_GATEWAY_URL || 'https://gateway.pinata.cloud';

// Owner: the local-dev EVM identity (Hardhat account #0) so the universe shows
// up as "yours" when you sign in to the local web app. The on-chain namespace
// is still Solana — only the off-chain owner pointer is EVM here.
const CREATOR_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const SOLANA_CLUSTER = 'devnet' as const;
const CREDITS = 5000;

const UNIVERSE_NAME = 'Techno Antichrist';
const UNIVERSE_DESCRIPTION = `Ash Kessler has been making techno for nineteen years and headlining for none of them. He presses two hundred copies of a record, sells a hundred and forty, plays the 2 a.m. slot to a room that is mostly there for whoever is on after him. He is good. Everyone says he is good. It has never once been enough.

Then, on a dead Tuesday in a Leipzig warehouse, he drops a track built around a tone he does not remember writing — a note that sits just below the bottom of hearing, more pressure than sound — and the room *turns*. Four hundred people move like one animal. Strangers weep on the floor. A girl tells him afterward, gripping his sleeve, that for the length of the breakdown she could feel someone standing behind her who had been dead for six years.

Katabasis Recordings finds him within the week. Their catalogue starts at KAT-001 and nobody can tell him what year that was. His A&R, Marisol Vane, does not flatter him. She explains, calmly, that the tone is real, that it has always been in the world waiting for a system loud enough to carry it and a crowd wide open enough to receive it, and that Ash is the first person in a long time who can mix it without flinching. She books him a tour. Each night the rig gets bigger. Each night the floor opens a little wider.

Ash tells himself it is craft. He tells himself the ringing that never quite leaves his ears now is just nineteen years of monitors. He tells himself the people following him from city to city — the ones who have stopped going home — are just fans.

By the time he reads the rider for the closing show — twenty-four hours, a decommissioned power station, the entire Katabasis catalogue queued behind his own set, the tone scheduled to run *unbroken* from hour nine — he already knows what the label has known since KAT-001: that the drop was always a door, that the floor was always a congregation, and that the set has a name older than the word techno. The Final Master is six weeks out. He can still cancel it. He keeps his hand on the fader and tells himself that.

Techno Antichrist is the story of the man the flyers were warning you about, told from behind the decks: a decent, unlucky producer beat-matching the end of the world, certain he can still bring the volume down.`;

// ── Cover art: repo public asset → Pinata (IPFS) ────────────────────────────
const RAW_COVER_URL = 'https://loar.fun/AsianJesus.jpg';
const LOCAL_COVER_PATH = path.join(REPO_ROOT, 'apps/web/public/AsianJesus.jpg');

async function resolveCover(): Promise<string> {
  if (!PINATA_JWT) {
    console.log('  [COVER] PINATA_JWT unset — using raw public URL');
    return RAW_COVER_URL;
  }
  let buf: Buffer;
  try {
    buf = readFileSync(LOCAL_COVER_PATH);
  } catch {
    console.log(`  [COVER] ${LOCAL_COVER_PATH} not readable — using raw public URL`);
    return RAW_COVER_URL;
  }
  try {
    console.log(
      `  [COVER] pinning AsianJesus.jpg (${(buf.length / 1024).toFixed(0)} KB) to IPFS...`
    );
    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(buf)], { type: 'image/jpeg' }),
      'techno-antichrist-cover.jpg'
    );
    form.append('pinataMetadata', JSON.stringify({ name: 'techno-antichrist-universe-cover' }));
    const pin = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
      method: 'POST',
      headers: { Authorization: `Bearer ${PINATA_JWT}` },
      body: form,
    });
    if (!pin.ok) throw new Error(`Pinata ${pin.status}: ${(await pin.text()).slice(0, 200)}`);
    const { IpfsHash } = (await pin.json()) as { IpfsHash: string };
    const url = `${PINATA_GATEWAY}/ipfs/${IpfsHash}`;
    console.log(`  [COVER] pinned: ${IpfsHash}`);
    return url;
  } catch (err: any) {
    console.log(`  [COVER] pin failed (${err.message}) — using raw public URL`);
    return RAW_COVER_URL;
  }
}

// ── Worldbuilding entities ──────────────────────────────────────────────────
interface EntitySeed {
  name: string;
  kind: string;
  description: string;
}

const ENTITIES: EntitySeed[] = [
  {
    name: 'Ash Kessler',
    kind: 'person',
    description:
      "A journeyman techno producer in his early forties — nineteen years of white-label records, support slots, and a day job cutting dubplates for other people. Soft-spoken, self-effacing, privately convinced he peaked in a decade he never actually had. The tone works in his hands the way it works in nobody else's: he can ride it without covering his ears. Katabasis names him, by contract, the Antichrist. He thinks the title is a bit, a scene in-joke, right up until it isn't.",
  },
  {
    name: 'Marisol Vane',
    kind: 'person',
    description:
      "Ash's A&R at Katabasis: precise, unhurried, allergic to hype. She never once lies to him — she simply lets him fill in the blanks in a way that keeps him mixing. Believes the world is a held note that has gone on too long and that the Final Master is the merciful resolve. Considers Ash's obscurity a gift: a man with nothing to lose says yes faster.",
  },
  {
    name: 'Dr. Ines Halloran',
    kind: 'person',
    description:
      'An acoustician who consulted on the Leipzig warehouse rig and walked out of the load-in with a spectrogram she could not explain. Now the closest thing the resistance has to a leader. Does not think Ash is evil. Thinks he is the most dangerous kind of gentle: a man who will keep his hand on the fader and keep not pulling it, because pulling it means admitting what the set is.',
  },
  {
    name: 'Katabasis Recordings',
    kind: 'organization',
    description:
      'A record label whose catalogue begins at KAT-001 with no year attached and whose founders are listed, on every pressing, only as initials. Operates through club residencies, festival bookings, and a mastering house that has cut plates for four generations of artists. Its doctrine holds that every genre is a way of walking downstairs, and that one of them reaches the bottom.',
  },
  {
    name: 'The 17th Harmonic',
    kind: 'lore',
    description:
      'The tone itself — a sub-audible fundamental that most systems roll off before it can be felt. Katabasis teaches that it is not composed but *found*, the way a cave is found: it was always there, waiting for a rig with the headroom and a crowd with the need. Sustained long enough over a large enough floor, it stops being sound and becomes a threshold.',
  },
  {
    name: 'The Monolith',
    kind: 'thing',
    description:
      "Katabasis's touring sound system — a wall of custom sub enclosures tuned specifically to reproduce the 17th Harmonic without distortion. Each show it grows by a few cabinets. The techs who build it out are not told what it is for; they are told it is the loudest clean rig in Europe, and that part is true.",
  },
  {
    name: 'The Final Master',
    kind: 'event',
    description:
      "The closing show: twenty-four hours in a decommissioned power station, the full Katabasis catalogue queued behind Ash's own set, the 17th Harmonic scheduled to run unbroken from the ninth hour to the end. Sold to the public as a once-in-a-lifetime marathon. It is the rite the tone was always the instrument of — an apocalypse with a guest list and a cloakroom.",
  },
  {
    name: 'The First Drop',
    kind: 'event',
    description:
      "A dead Tuesday in a Leipzig warehouse where Ash first played the tone into a real crowd and felt the room become one thing. Techno Antichrist's origin scene and the moment Katabasis's scouts, already in the room, marked him. Four hundred people; three of them never went back to their old lives.",
  },
  {
    name: 'The Pressing',
    kind: 'event',
    description:
      "The night the 17th Harmonic is cut to a physical dubplate at the Katabasis mastering house, making it portable, copyable, and permanent — no longer dependent on Ash's hands. After the Pressing the label technically does not need him. They keep him anyway, because a floor follows a face, not a lacquer.",
  },
  {
    name: 'The Substation',
    kind: 'place',
    description:
      'A decommissioned power station on the edge of the city, its turbine hall re-rigged so that the low end reinforces along a single standing wave that runs the length of the room. Katabasis has held the lease, quietly, for longer than the building has been out of service. It is where the Final Master is booked.',
  },
  {
    name: 'The Congregation',
    kind: 'faction',
    description:
      'The dancers who stopped going home — the ones who follow the Monolith from city to city, sleep in the load-out, and describe the breakdown in the language people use for the dead. They are not organised and they are not armed. They are simply always there, front and centre, and their number roughly doubles every tour.',
  },
  {
    name: 'The Feedback',
    kind: 'faction',
    description:
      'A loose cell of ex-Katabasis techs, a mastering engineer who refused to cut the plate, and Dr. Halloran — the people who have handled the tone and want the Final Master stopped. Their plan is not sabotage. Their plan is to get Ash alone with an honest spectrogram and the full rider and make him understand what he is scheduled to play.',
  },
];

const PLACEHOLDER_COVER =
  'https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=1200&h=675&fit=crop';

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const coverOnlyArg = process.argv.find((a) => a.startsWith('--cover-only'));
  const coverOnlyId = coverOnlyArg?.includes('=') ? coverOnlyArg.split('=')[1] : undefined;

  console.log('\n' + '='.repeat(66));
  console.log(
    `  LOAR — Techno Antichrist  (Solana / devnet)${coverOnlyId ? '  — cover regen' : ''}`
  );
  console.log('='.repeat(66));

  const saPathRaw =
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH || 'firebase-sa-key-local-emulator.json';
  const saPath = path.isAbsolute(saPathRaw) ? saPathRaw : path.join(REPO_ROOT, saPathRaw);
  const serviceAccount = JSON.parse(readFileSync(saPath, 'utf-8'));
  const app = initializeApp(
    { credential: cert(serviceAccount) },
    'techno-antichrist-' + Date.now()
  );
  const db = getFirestore(app);
  db.settings({ preferRest: true });
  console.log(`  Firebase : ${serviceAccount.project_id}`);
  console.log(`  Emulator : ${process.env.FIRESTORE_EMULATOR_HOST || '(none — LIVE!)'}`);
  console.log(`  Creator  : ${CREATOR_ADDRESS}\n`);

  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error(
      'FIRESTORE_EMULATOR_HOST is not set — refusing to write to a live Firestore. ' +
        'Start the emulator (make dev-local) or export the var.'
    );
  }

  // ── cover-regen-only path ────────────────────────────────────────────────
  if (coverOnlyId) {
    const ref = db.collection('cinematicUniverses').doc(coverOnlyId);
    const snap = await ref.get();
    if (!snap.exists) throw new Error(`no universe ${coverOnlyId}`);
    const url = await resolveCover();
    await ref.update({ image_url: url, portrait_image_url: url, updated_at: new Date() });
    console.log(`\n  cover updated on ${coverOnlyId}\n  ${url}\n`);
    process.exit(0);
  }

  // Step 1 — cover art
  console.log('Step 1: Cover art');
  let coverImageUrl: string;
  try {
    coverImageUrl = await resolveCover();
  } catch (err: any) {
    console.log(`  [COVER] FAILED: ${err.message} — using placeholder`);
    coverImageUrl = PLACEHOLDER_COVER;
  }
  console.log(`  cover: ${coverImageUrl}\n`);

  // Step 2 — universe doc (Solana namespace)
  console.log('Step 2: Universe document');
  const universePda = Keypair.generate().publicKey.toBase58();
  const universeId = universePda; // base58 is case-sensitive — do NOT lowercase
  const now = new Date();

  await db.collection('cinematicUniverses').doc(universeId).set({
    address: universePda,
    creator: CREATOR_ADDRESS,
    // Solana universes reuse the PDA for token/governance until the SVM
    // launchpad lands (mirrors initializeSolanaUniverse).
    tokenAddress: universePda,
    governanceAddress: universePda,
    image_url: coverImageUrl,
    portrait_image_url: coverImageUrl,
    description: UNIVERSE_DESCRIPTION,
    name: UNIVERSE_NAME,
    onChainUniverseId: null,
    mintTxHash: null,
    unstoppableDomain: null,
    chainId: null,
    chainNamespace: 'solana',
    solanaCluster: SOLANA_CLUSTER,
    hasPrivateSection: true,
    isMultiSig: false,
    multiSigAddress: null,
    accessModel: 'open',
    universeType: 'monetized',
    isPrivate: false,
    created_at: now,
    updated_at: now,
  });
  console.log(`  universe: ${universeId}`);

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
  console.log(`  credits : ${CREDITS}`);

  await db.collection('privateSectionConfig').doc(universeId).set({
    universeId,
    vaultEnabled: true,
    notesEnabled: true,
    holderMinPercentage: 1,
    createdAt: now,
    updatedAt: now,
  });

  await db.collection('universeCreditTransactions').add({
    universeId,
    type: 'fund',
    fundedByUid: CREATOR_ADDRESS.toLowerCase(),
    paymentMethod: 'genesis',
    paymentRef: 'techno-antichrist-genesis',
    credits: CREDITS,
    ethAmountWei: '0',
    source: 'genesis',
    note: 'Techno Antichrist — genesis credits (Solana devnet)',
    createdAt: now,
  });
  console.log('  credit transaction logged\n');

  // Step 3 — entities
  console.log('Step 3: Worldbuilding entities');
  let seeded = 0;
  for (const e of ENTITIES) {
    const id = randomUUID();
    await db.collection('entities').doc(id).set({
      id,
      name: e.name,
      kind: e.kind,
      description: e.description,
      universeAddress: universeId,
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
    seeded++;
    console.log(`  [${e.kind.toUpperCase().padEnd(12)}] ${e.name}`);
  }

  console.log('\n' + '='.repeat(66));
  console.log('  Techno Antichrist — created');
  console.log('='.repeat(66));
  console.log(`  Universe ID : ${universeId}`);
  console.log(`  Chain       : solana / ${SOLANA_CLUSTER}  (Firestore mirror; no live PDA init)`);
  console.log(`  Creator     : ${CREATOR_ADDRESS}`);
  console.log(`  Credits     : ${CREDITS}`);
  console.log(`  Entities    : ${seeded}`);
  console.log(`  Cover       : ${coverImageUrl}`);
  console.log(`\n  View at: /universe/${universeId}\n`);

  process.exit(0);
}

main().catch((err) => {
  console.error('\nFAILED:', err?.message ?? err);
  process.exit(1);
});
