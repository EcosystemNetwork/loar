/**
 * Create the "ESN-ULTRA" universe — on Solana.
 *
 * Logline: a grieving man, hollowed out by the loss of his wife and daughter,
 * is courted by an ancient ecumenical order that promises to give them back.
 * All he has to do is accept a title and sign a covenant. He says yes the way
 * any father would — and only much later understands that the covenant named
 * him the Beast, and that the order engineered the accident that took his
 * family to make him pliable. The most sympathetic villain in scripture: a
 * good man weaponized by his own mourning.
 *
 * Chain: Solana (devnet). The universe address is a real base58 pubkey that
 * stands in for the on-chain Universe PDA; the Firestore mirror is written
 * with `chainNamespace: 'solana'` exactly as the server's
 * `initializeSolanaUniverse` flow would persist it. No live PDA init is done
 * here (no SOLANA_RPC_URL / Circle DCW wired for local dev) — `mintTxHash`
 * stays null, same as every other `scripts/create-*` universe seeder.
 *
 * Cover art: Google "Nano Banana Pro" (Gemini image) → pinned to IPFS via Pinata.
 *
 * Usage (Firestore emulator must be running on :8080):
 *   pnpm exec tsx apps/server/scripts/create-esn-ultra.ts
 *
 * Re-generate just the cover for the universe already created (no duplicate):
 *   pnpm exec tsx apps/server/scripts/create-esn-ultra.ts --cover-only=<universeId>
 *
 * Required env: PINATA_JWT, plus one image backend —
 *   GOOGLE_API_KEY (nano-banana-pro-preview, needs billing enabled) OR
 *   FAL_KEY        (fal-ai/nano-banana)
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
      // strip trailing inline comment + surrounding quotes
      v = v.replace(/\s+#.*$/, '').replace(/^["']|["']$/g, '');
      if (!(k in process.env)) process.env[k] = v;
    }
  } catch {
    /* .env optional if the vars are already exported */
  }
}
loadEnv();

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const PINATA_JWT = process.env.PINATA_JWT;
const PINATA_GATEWAY = process.env.PINATA_GATEWAY_URL || 'https://gateway.pinata.cloud';

// Owner: the local-dev EVM identity (Hardhat account #0) so the universe shows
// up as "yours" when you sign in to the local web app. The on-chain namespace
// is still Solana — only the off-chain owner pointer is EVM here.
const CREATOR_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const SOLANA_CLUSTER = 'devnet' as const;
const CREDITS = 5000;

const UNIVERSE_NAME = 'ESN-ULTRA';
const UNIVERSE_DESCRIPTION = `Daniel Varga buried his wife and daughter on the same grey morning, in the same grave, under a sky the colour of wet ash. Sarah had been driving Mira home from a swim meet. The road was empty. The car left it anyway.

For eleven months Daniel is a dead man who keeps getting up. Then the Concordat comes to his door — an old ecumenical order, older than any church that would admit to knowing it, patient the way water is patient. They do not offer him comfort. They offer him a proposition: that grief is a door, that the door can be held open, and that a man standing in the right place at the right hour can have back the thing that was taken from him. All he must do is accept a title. Stand where they tell him to stand. Sign the Covenant.

He signs it the way any father would.

The rites are beautiful. The crowds that gather are real, and they adore him, and the small impossible mercies that follow him from city to city — the water clean again, the tumour gone, the shooter's gun jammed — those are real too. Daniel tells himself he is doing good. He tells himself the ache in the back of his skull is only grief. He tells himself the two empty chairs he keeps at every table are almost, almost warm.

By the time he reads the Covenant in a language he was never taught and understands what he agreed to — that the word they wrote beside his name is the oldest name for the end of things, that the Concordat did not find him in his grief but *manufactured* it, that Sarah and Mira were run off an empty road by people who needed him broken enough to say yes — he has already been loved by too many people to stop. The Restoration is nine days out. He can still call it off. He keeps telling himself that. He has been telling himself that for a long time now.

ESN-ULTRA is the story of the man the world was warned about, told from inside his mourning: a decent, wrecked father walking a straight line toward an apocalypse he is certain he can still turn away from, carrying two chairs.`;

// ── Cover art: Nano Banana Pro → Pinata ─────────────────────────────────────
const COVER_PROMPT = [
  'Cinematic film poster, chiaroscuro oil-painting quality, for a dark biblical thriller titled "ESN-ULTRA".',
  'A gaunt, kind-faced man in his forties in a pale bone-white ceremonial suit stands at a marble altar,',
  'bathed in a shaft of warm false light from above like a stage halo, hands open at his sides.',
  'A vast congregation kneels in adoration in the shadowed nave below him, faces upturned, some weeping.',
  'His cast shadow on the pale floor is subtly, wrongly horned — the only monstrous thing in the frame.',
  'Beside him at the altar: two empty wooden chairs, one adult-sized, one a small child’s chair, waiting.',
  'Fine grey ash drifts down through the light like slow snow and settles on his shoulders.',
  'Colour palette: bone white, candle gold, deep oxblood red, cold cathedral blue-black.',
  'Mood of sorrow, false grace, and dread. Ultra-detailed, volumetric light, 16:9 landscape.',
  'No text, no lettering, no watermarks, no logos.',
].join(' ');

/** Nano Banana via Google Gemini generateContent. Needs a billed GOOGLE_API_KEY. */
async function nanoBananaViaGoogle(): Promise<{ buf: Buffer; mimeType: string }> {
  console.log('  [COVER] Trying Nano Banana Pro via Google (Gemini)...');
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/nano-banana-pro-preview:generateContent?key=${GOOGLE_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `Generate an image: ${COVER_PROMPT}` }] }],
        generationConfig: { responseModalities: ['image', 'text'], temperature: 1 },
      }),
    }
  );
  if (!res.ok) throw new Error(`google ${res.status}: ${(await res.text()).slice(0, 300)}`);

  const data = (await res.json()) as any;
  for (const cand of data.candidates ?? []) {
    for (const part of cand.content?.parts ?? []) {
      if (part.inlineData?.data) {
        return {
          buf: Buffer.from(part.inlineData.data, 'base64'),
          mimeType: part.inlineData.mimeType || 'image/png',
        };
      }
    }
  }
  throw new Error('google: no image in response');
}

/** Nano Banana via fal.ai. Needs FAL_KEY. */
async function nanoBananaViaFal(): Promise<{ buf: Buffer; mimeType: string }> {
  console.log('  [COVER] Trying fal-ai/nano-banana...');
  const submit = await fetch('https://fal.run/fal-ai/nano-banana', {
    method: 'POST',
    headers: {
      Authorization: `Key ${process.env.FAL_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ prompt: COVER_PROMPT, num_images: 1, output_format: 'png' }),
  });
  if (!submit.ok) throw new Error(`fal ${submit.status}: ${(await submit.text()).slice(0, 300)}`);
  const out = (await submit.json()) as any;
  const imgUrl = out?.images?.[0]?.url;
  if (!imgUrl) throw new Error('fal: no image url in response');
  const dl = await fetch(imgUrl);
  if (!dl.ok) throw new Error(`fal image download ${dl.status}`);
  return {
    buf: Buffer.from(await dl.arrayBuffer()),
    mimeType: dl.headers.get('content-type') || 'image/png',
  };
}

async function generateCoverImage(): Promise<string> {
  if (!PINATA_JWT) throw new Error('PINATA_JWT not set');

  const backends: Array<() => Promise<{ buf: Buffer; mimeType: string }>> = [];
  if (GOOGLE_API_KEY) backends.push(nanoBananaViaGoogle);
  if (process.env.FAL_KEY) backends.push(nanoBananaViaFal);
  if (backends.length === 0) {
    throw new Error('no image backend — set GOOGLE_API_KEY (billed) or FAL_KEY');
  }

  let buf: Buffer | null = null;
  let mimeType = 'image/png';
  const errs: string[] = [];
  for (const backend of backends) {
    try {
      const r = await backend();
      buf = r.buf;
      mimeType = r.mimeType;
      break;
    } catch (e: any) {
      errs.push(e.message);
      console.log(`  [COVER] ${e.message}`);
    }
  }
  if (!buf) throw new Error(`all backends failed: ${errs.join(' | ')}`);

  const ext = mimeType.includes('jpeg') || mimeType.includes('jpg') ? 'jpg' : 'png';
  console.log(`  [COVER] Got ${(buf.length / 1024).toFixed(0)} KB — pinning to IPFS...`);

  const form = new FormData();
  form.append('file', new Blob([buf], { type: mimeType }), `esn-ultra-cover.${ext}`);
  form.append('pinataMetadata', JSON.stringify({ name: 'esn-ultra-universe-cover' }));

  const pin = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
    method: 'POST',
    headers: { Authorization: `Bearer ${PINATA_JWT}` },
    body: form,
  });
  if (!pin.ok) {
    throw new Error(`Pinata ${pin.status}: ${(await pin.text()).slice(0, 200)}`);
  }
  const { IpfsHash } = (await pin.json()) as { IpfsHash: string };
  const url = `${PINATA_GATEWAY}/ipfs/${IpfsHash}`;
  console.log(`  [COVER] Pinned: ${IpfsHash}`);
  return url;
}

// ── Worldbuilding entities ──────────────────────────────────────────────────
interface EntitySeed {
  name: string;
  kind: string;
  description: string;
}

const ENTITIES: EntitySeed[] = [
  {
    name: 'Daniel Varga',
    kind: 'person',
    description:
      'A structural engineer, widower, and father to a daughter he could not save. Gentle, methodical, and privately certain the accident was his fault for not driving that day. The Concordat chose him for exactly this: a good man with a wound wide enough to walk through. Accepts the title of "the Vicar of the Restoration" believing it is a path back to his family; is, by covenant, the Antichrist.',
  },
  {
    name: 'Sarah Varga',
    kind: 'person',
    description:
      'Daniel\'s wife. A music teacher with a dry, unsentimental warmth. Killed with their daughter when their car was forced off an empty road — an act the Concordat later records, in its own ledgers, as "preparation of the vessel." Appears throughout ESN-ULTRA in memory, in the empty adult chair Daniel carries, and in the thing the Concordat keeps promising to return.',
  },
  {
    name: 'Mira Varga',
    kind: 'person',
    description:
      "Daniel and Sarah's nine-year-old daughter. Swim-team ribbons, a fear of moths, a habit of narrating her own life in the third person. The small chair at every altar is hers. The Restoration is sold to Daniel as her homecoming.",
  },
  {
    name: 'Cardinal-Adjunct Iren Kovač',
    kind: 'person',
    description:
      "Daniel's handler within the Concordat: soft-spoken, endlessly reasonable, grief-literate in a way that only makes sense in hindsight. Believes the ending of the world is a mercy long overdue and that Daniel's suffering is a fair price. Never lies to him outright — simply lets him assume.",
  },
  {
    name: 'The Concordat',
    kind: 'organization',
    description:
      'An ecumenical order predating the institutions that would deny knowing it. Its doctrine holds that history is a wound and the Restoration is the suture. Operates through chaplaincies, disaster-relief NGOs, and a logistics arm efficient enough to arrange a car crash on an empty road. Its true membership has never been counted.',
  },
  {
    name: 'The Remnant',
    kind: 'faction',
    description:
      'A scattered resistance of ex-Concordat archivists, a forensic accountant, and one traffic-collision investigator who never accepted the file was closed. They do not believe Daniel is evil. They believe he is the most dangerous kind of good man, and that the only way to stop the Restoration is to make him read his own Covenant.',
  },
  {
    name: 'The Ninth See',
    kind: 'place',
    description:
      'A decommissioned cathedral on a chalk headland, re-consecrated by the Concordat as the seat of the Restoration. Its nave has been rebuilt so that light falls on the altar at a single hour of a single day — the hour the Covenant names.',
  },
  {
    name: 'The Grey Morning',
    kind: 'event',
    description:
      "The double funeral of Sarah and Mira Varga. ESN-ULTRA's first scene and the fixed point every later horror is measured against. The Concordat had a representative in the fourth pew.",
  },
  {
    name: 'The Covenant Signing',
    kind: 'event',
    description:
      'Held in a hospital chapel at 3 a.m., eleven months after the Grey Morning. Daniel signs a document he is told is "a statement of intent." The witnessing signatures are all Concordat. One clause, in a language Daniel cannot read, assigns him the oldest name for the end of things.',
  },
  {
    name: 'The Restoration Doctrine',
    kind: 'lore',
    description:
      'The Concordat’s central teaching: that the world is irreparably broken, that grief is the only honest response to it, and that a mourner of sufficient purity can be made the hinge on which creation is folded shut and remade. Salvation and apocalypse are, in the Doctrine, the same act described from two sides.',
  },
  {
    name: 'The Covenant',
    kind: 'thing',
    description:
      'The signed instrument itself — vellum, four pages, three scripts. Legally it reads as a charitable pledge. Liturgically it is a binding. The final page, unread by the man who signed it, is Daniel’s confession of a role he did not know he was accepting. Whoever holds it at the naming hour controls whether the Restoration proceeds.',
  },
  {
    name: 'The Two Chairs',
    kind: 'thing',
    description:
      'One adult chair, one child’s chair, carried by Daniel to every dais and every dinner. The Concordat encourages the habit — a grieving figurehead moves crowds. To Daniel they are a promise being kept warm. To everyone watching ESN-ULTRA they are the countdown.',
  },
];

const PLACEHOLDER_COVER =
  'https://images.unsplash.com/photo-1508361001413-7a9dca21d08a?w=1200&h=675&fit=crop';

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  // --cover-only=<universeId> : regenerate + patch the cover on an existing
  // universe instead of creating a new one.
  const coverOnlyArg = process.argv.find((a) => a.startsWith('--cover-only'));
  const coverOnlyId = coverOnlyArg?.includes('=') ? coverOnlyArg.split('=')[1] : undefined;

  console.log('\n' + '='.repeat(66));
  console.log(`  LOAR — ESN-ULTRA  (Solana / devnet)${coverOnlyId ? '  — cover regen' : ''}`);
  console.log('='.repeat(66));

  // Firebase (points at the local emulator via FIRESTORE_EMULATOR_HOST)
  const saPathRaw =
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH || 'firebase-sa-key-local-emulator.json';
  const saPath = path.isAbsolute(saPathRaw) ? saPathRaw : path.join(REPO_ROOT, saPathRaw);
  const serviceAccount = JSON.parse(readFileSync(saPath, 'utf-8'));
  const app = initializeApp({ credential: cert(serviceAccount) }, 'esn-ultra-' + Date.now());
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
    const url = await generateCoverImage(); // throws if no real backend works
    await ref.update({ image_url: url, updated_at: new Date() });
    console.log(`\n  cover updated on ${coverOnlyId}\n  ${url}\n`);
    process.exit(0);
  }

  // Step 1 — cover art
  console.log('Step 1: Cover art');
  let coverImageUrl: string;
  try {
    coverImageUrl = await generateCoverImage();
  } catch (err: any) {
    console.log(`  [COVER] FAILED: ${err.message}`);
    console.log('  [COVER] using placeholder — re-run with --cover-only=<id> to regenerate.');
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
    portrait_image_url: null,
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
    paymentRef: 'esn-ultra-genesis',
    credits: CREDITS,
    ethAmountWei: '0',
    source: 'genesis',
    note: 'ESN-ULTRA — genesis credits (Solana devnet)',
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
  console.log('  ESN-ULTRA — created');
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
