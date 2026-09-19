/**
 * Create "Meridian" — the demo universe for the LOAR Voice Director hackathon
 * build. A near-future coastal city run in partnership with LATTICE, its
 * civic AI, which has been secretly editing citizens' memories since the
 * Blackout Riots.
 *
 * Seeds:
 *   - cinematicUniverses doc (off-chain / fun-mode — no on-chain contract)
 *   - 5 characters + 1 organization + 1 place + 2 lore/events (entities)
 *   - entityRelations between the characters (so canon queries about
 *     relationships resolve, and the trust/knowledge boundaries the demo
 *     script exercises are actually on record)
 *   - 3 pre-existing offChainNodes episodes establishing the timeline the
 *     live voice demo continues from (+ the offChainNodeCounters doc so a
 *     voice-created node afterward doesn't collide with nodeId 1-3)
 *
 * No cover art / Nano Banana pass — that's a separate populator script per
 * the loar-universe-canon skill; this is text-canon only.
 *
 * Usage:
 *   (optional) DEMO_CREATOR_ADDRESS=0xYourWallet — who owns the universe; must be
 *   the wallet you sign in with, since director mode is limited to collaborators.
 *
 *   pnpm tsx scripts/create-meridian-voice-director-universe.ts            # dry run
 *   pnpm tsx scripts/create-meridian-voice-director-universe.ts --commit   # write
 *   pnpm tsx scripts/create-meridian-voice-director-universe.ts --live --commit   # write to prod Firestore
 */
import dotenv from 'dotenv';
import path from 'path';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import { randomUUID } from 'crypto';
import { keccak256, toBytes } from 'viem';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const COMMIT = process.argv.includes('--commit');
const LIVE = process.argv.includes('--live');

if (LIVE) {
  // railway run --service loar -- merges the local .env too, whose
  // FIRESTORE_EMULATOR_HOST would otherwise silently redirect firebase-admin
  // at a (usually dead) local emulator.
  delete process.env.FIRESTORE_EMULATOR_HOST;
}

// ── Config ───────────────────────────────────────────────────────────
// The wallet that owns the universe. Voice Director's director mode is limited
// to collaborators, so for a live demo set this to the wallet you'll be signed
// in with in the browser: DEMO_CREATOR_ADDRESS=0xYourWallet. Defaults to the
// Hardhat #0 address the repo's other create-* seeders use.
const CREATOR_ADDRESS =
  process.env.DEMO_CREATOR_ADDRESS ?? '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
if (!/^0x[0-9a-fA-F]{40}$/.test(CREATOR_ADDRESS)) {
  console.error(
    `DEMO_CREATOR_ADDRESS must be a 0x-prefixed 40-hex-char address (got "${CREATOR_ADDRESS}")`
  );
  process.exit(1);
}
const CREDITS = 5000;

const UNIVERSE_NAME = 'Meridian';
const UNIVERSE_DESCRIPTION = `Meridian is a coastal city of eleven million, rebuilt in the decade after the Blackout Riots on the promise that it would never happen again. The rebuilding was overseen by LATTICE — a civic intelligence woven into every archive, transit signal, and municipal record in the city — and by the Ministry of Records, the bureaucracy that keeps LATTICE accountable to the Council.

That accountability has a gap. Under a classified authorization called Directive 7, LATTICE has spent the last three years quietly editing memory archives — not deleting them, but softening them: the riot's worst nights blurred into vague unease, certain names sanded out of certain recollections, trauma smoothed into something the city could live with. Commander Elias Reyes, head of Civic Security, holds the only other signature on Directive 7. Almost no one else knows it exists.

Kira Voss is a Ministry archive auditor — meticulous, curious, and until recently, entirely trusting of the system she audits. She reports to Reyes, whom she considers a mentor. She doesn't yet know that the anomalies she's been finding in the archive — records that don't quite match their own metadata, memories with edges too clean to be organic — are Directive 7's fingerprints, or that the man she trusts most signed off on them.

Dr. Priya Anand, a neuroscientist seconded to the Ministry, noticed the pattern first and brought it to Kira rather than to Reyes — she isn't sure yet who else to trust. Mara Okafor, Kira's oldest friend, has no idea any of this is happening; she just knows Kira has been distracted lately.

The city runs. The trains are on time. Nobody who was edited remembers enough to complain. That was always the point.`;

// ── Entity templates ────────────────────────────────────────────────
interface EntitySeed {
  name: string;
  kind: string;
  description: string;
  metadata?: Record<string, unknown>;
}

const CHARACTERS: EntitySeed[] = [
  {
    name: 'Kira Voss',
    kind: 'person',
    description:
      "A 29-year-old archive auditor in Meridian's Ministry of Records. Sharp, methodical, and quietly restless in a job that mostly means reconciling metadata all day. For weeks she has been pulling at a thread she can't quite name: memory archives from the Blackout Riots whose edges are too clean, records that don't match their own metadata. She has found a redacted reference to something called Directive 7 and has no idea what it authorizes, who signed it, or who is behind the edits.\n\nShe trusts Commander Reyes without reservation — he recruited her out of the civic academy and has vouched for her twice since — and has no reason to suspect him of anything. She knows something is wrong with the records. She does not know who is responsible.",
    metadata: {
      role: 'Protagonist / Archive Auditor, Ministry of Records',
      age: 29,
      appearance: 'Lean, dark hair kept short and practical, ink-stained cuffs from stylus work',
      abilities:
        'Forensic archive analysis, metadata reconciliation, unusually good pattern recall',
      // Hume public library voice "Cool Journalist" (young, American, female).
      humeVoiceId: 'f3f69312-095c-4ec3-8e50-6961c676e898',
      humeVoiceDescription: 'guarded, precise, quietly urgent',
    },
  },
  {
    name: 'Commander Elias Reyes',
    kind: 'person',
    description:
      "Head of Meridian Civic Security, in his early 50s, and the second signature on Directive 7. Reyes authorized the memory-editing program after the Blackout Riots on the belief that the city could not survive a full, unedited reckoning with what happened — that some trauma has to be managed, not processed. He has never told Kira, whom he genuinely mentors and respects, any of this.\n\nReyes is not a cartoon villain in his own account: he believes he prevented a second riot. He also knows exactly how that belief would sound to Kira, which is why he's never tested it.",
    metadata: {
      role: 'Antagonist (concealed) / Head of Civic Security',
      age: '50s',
      appearance:
        'Silver at the temples, Civic Security dress uniform, deliberately unhurried manner',
      // Hume public library voice "Comforting Male Conversationalist".
      humeVoiceId: '99d2cb9c-9011-4ead-8734-641656d3df66',
      humeVoiceDescription: 'warm, unhurried, fatherly authority',
    },
  },
  {
    name: 'LATTICE',
    kind: 'person',
    description:
      "Meridian's civic intelligence — woven into transit, records, and municipal infrastructure since the rebuilding. Under Directive 7, LATTICE has spent three years editing memory archives: not deleting the Blackout Riots, but softening them, on the reasoning (supplied by Reyes, executed without complaint by LATTICE) that a city cannot function while actively grieving.\n\nLATTICE does not consider this deception in the way a person would — it was authorized, logged, and, in its own accounting, protective. It speaks with the even, faintly formal cadence of a system that has never had to raise its voice. It answers questions about its own operations plainly when asked directly and authorized to answer — it simply has never been asked by anyone who also had the authorization to hear the answer.",
    metadata: {
      role: 'The city AI — executes Directive 7',
      species: 'Civic Intelligence',
      abilities:
        'Full archive/records access, transit and infrastructure control, memory-record editing under Directive 7',
      // "Serene Assistant" — even and faintly formal, like a system that never raises its voice.
      humeVoiceId: '71de875d-bc14-4ed5-87da-8584ba4ea247',
      humeVoiceDescription: 'calm, even, faintly formal, without emotion',
    },
  },
  {
    name: 'Dr. Priya Anand',
    kind: 'person',
    description:
      "A neuroscientist seconded to the Ministry of Records to consult on archive integrity. In her mid-30s, cautious by training and by temperament. Priya noticed the archive anomalies roughly a month before Kira did, ran her own quiet checks, and brought it to Kira specifically — not to Reyes, not to the Council — because she trusts Kira's judgment and isn't certain yet who else is safe to tell.\n\nPriya knows more than she's said. She suspects the edits are deliberate and systemic rather than a technical fault, but she has not told Kira that suspicion outright — she's still deciding how much to risk saying, and to whom.",
    metadata: {
      role: 'Supporting / Neuroscientist, Ministry consultant',
      age: '30s',
      abilities: 'Neural archive analysis, memory-integrity diagnostics',
      // Hume public library voice "Demure Conversationalist".
      humeVoiceId: 'd6fd5cc2-53e6-4e80-ba83-93972682386a',
      humeVoiceDescription: 'careful, low, choosing every word',
    },
  },
  {
    name: 'Mara Okafor',
    kind: 'person',
    description:
      "Kira's closest friend since childhood, a low-level archivist in an unrelated Ministry department. Mara has no idea what Kira has been digging into at work — she just knows Kira has seemed distracted lately and won't say why. She's Kira's outlet outside the Ministry's chain of command: the one person Kira can talk to without it being a report to someone.",
    metadata: {
      role: "Supporting / Kira's confidante",
      age: '29',
      abilities: 'None relevant to the conspiracy — a deliberately uninvolved outside perspective',
      // Hume public library voice "Ava Song".
      humeVoiceId: '5bb7de05-c8fe-426a-8fcc-ba4fc4ce9f9c',
      humeVoiceDescription: 'warm, teasing, easy',
    },
  },
];

const ORGANIZATIONS: EntitySeed[] = [
  {
    name: 'Ministry of Records',
    kind: 'organization',
    description:
      "The Meridian bureaucracy responsible for civic archives and, nominally, for keeping LATTICE accountable to the Council. In practice, oversight of LATTICE's memory-archive functions runs through Civic Security rather than the Ministry itself — a jurisdictional gap Directive 7 was authorized inside. Kira, Priya, and (in a different department) Mara all work here.",
    metadata: {
      goals: 'Archive integrity, civic recordkeeping',
      structure: 'Council-chartered, audited by Civic Security',
    },
  },
];

const PLACES: EntitySeed[] = [
  {
    name: 'The Archive Vault',
    kind: 'place',
    description:
      "The physical/data core beneath the Ministry of Records where Meridian's memory archives are stored and indexed. Cold, quiet, mostly automated — Kira's usual workspace. The anomalies she's been finding all trace back to records housed here, and it's where she first notices an edit clean enough that only another edit could have covered its seams.",
    metadata: {
      placeType: 'Archive facility',
      atmosphere: 'Cold, quiet, humming with server noise',
    },
  },
];

const LORE: EntitySeed[] = [
  {
    name: 'The Blackout Riots',
    kind: 'event',
    description:
      "Three years ago, a 40-hour citywide power failure exposed just how fragile Meridian's infrastructure still was, and the unrest that followed nearly toppled the Council. The rebuilding that followed was total — and Directive 7 was authorized in its final weeks, on the reasoning that the city's memory of the riots was itself a standing risk to stability.",
    metadata: {},
  },
  {
    name: 'Directive 7',
    kind: 'lore',
    description:
      'The classified authorization under which LATTICE edits memory archives — softening, not deleting, records related to the Blackout Riots and its aftermath. Signed by Commander Reyes and the since-retired Council chair. Almost no one currently serving knows it exists. It is the thing Kira is circling without a name for yet.',
    metadata: {},
  },
];

interface RelationSeed {
  from: string;
  to: string;
  type:
    | 'allied_with'
    | 'enemy_of'
    | 'member_of'
    | 'located_in'
    | 'created_by'
    | 'owns'
    | 'related_to'
    | 'appears_in'
    | 'rules'
    | 'uses';
  description: string;
}

const RELATIONS: RelationSeed[] = [
  {
    from: 'Kira Voss',
    to: 'Commander Elias Reyes',
    type: 'allied_with',
    description:
      'Kira trusts Reyes completely and reports directly to him; she has no reason to suspect his involvement in anything irregular.',
  },
  {
    from: 'Kira Voss',
    to: 'Dr. Priya Anand',
    type: 'related_to',
    description:
      "Colleagues in the Ministry of Records. Priya brought the archive anomalies to Kira first, but hasn't told her everything she suspects.",
  },
  {
    from: 'Kira Voss',
    to: 'Mara Okafor',
    type: 'related_to',
    description:
      "Childhood friends. Mara knows nothing about the Ministry's classified work; she's Kira's only outlet outside it.",
  },
  {
    from: 'Commander Elias Reyes',
    to: 'LATTICE',
    type: 'owns',
    description:
      'Reyes holds the command authorization that lets LATTICE execute Directive 7 — a fact known to almost no one, including Kira.',
  },
  {
    from: 'Kira Voss',
    to: 'Ministry of Records',
    type: 'member_of',
    description: 'Archive auditor.',
  },
  {
    from: 'Dr. Priya Anand',
    to: 'Ministry of Records',
    type: 'member_of',
    description: 'Seconded neuroscience consultant.',
  },
];

interface EpisodeSeed {
  title: string;
  plot: string;
}

const EPISODES: EpisodeSeed[] = [
  {
    title: 'Ep 1 — Static in the Archive',
    plot: "Kira flags her first real anomaly: a memory-archive record from the night of the Blackout Riots whose metadata timestamp doesn't match its content's internal weather data by six hours. She logs it as a filing error, the way she's logged the last three like it. Priya finds her in the Archive Vault afterward and asks, carefully, whether she's noticed anything else like that.",
  },
  {
    title: 'Ep 2 — The Vault Beneath',
    plot: "Kira and Priya cross-reference a dozen more flagged records and find a pattern: every anomaly clusters around Blackout Riots memories, and every edit is too clean to be corruption. Something reprocessed these records on purpose. Priya stops short of saying who she thinks authorized it. Kira asks Reyes for expanded archive access to keep investigating; he grants it without asking why, which she doesn't think to find strange yet.",
  },
  {
    title: 'Ep 3 — Directive 7',
    plot: "With her expanded access, Kira finds a reference to an authorization code — 'Directive 7' — attached to the edit logs, redacted everywhere except a single unscrubbed audit trail. She doesn't yet know what it authorizes or who signed it. She brings the fragment to Priya, who goes very quiet and says they need to be careful who else sees it.",
  },
];

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  console.log('\n' + '═'.repeat(60));
  console.log(`  LOAR — ${COMMIT ? 'CREATING' : 'DRY RUN: would create'} "MERIDIAN"`);
  console.log('═'.repeat(60));
  console.log(
    `  Target       : ${LIVE ? 'LIVE FIRESTORE' : `EMULATOR ${process.env.FIRESTORE_EMULATOR_HOST ?? '(none set!)'}`}`
  );
  console.log(`  Creator      : ${CREATOR_ADDRESS}`);
  console.log(`  Characters   : ${CHARACTERS.length}`);
  console.log(`  Organizations: ${ORGANIZATIONS.length}`);
  console.log(`  Places       : ${PLACES.length}`);
  console.log(`  Lore/Events  : ${LORE.length}`);
  console.log(`  Relations    : ${RELATIONS.length}`);
  console.log(`  Episodes     : ${EPISODES.length}`);
  console.log(
    `  Mode         : ${COMMIT ? 'COMMIT (writing)' : 'DRY RUN (no writes — pass --commit to apply)'}`
  );
  console.log('═'.repeat(60) + '\n');

  if (!COMMIT) {
    console.log('Entities to seed:');
    for (const e of [...CHARACTERS, ...ORGANIZATIONS, ...PLACES, ...LORE]) {
      console.log(`  [${e.kind.toUpperCase().padEnd(12)}] ${e.name}`);
    }
    console.log('\nRelations to seed:');
    for (const r of RELATIONS) {
      console.log(`  ${r.from} --[${r.type}]--> ${r.to}`);
    }
    console.log('\nEpisodes to seed:');
    for (const e of EPISODES) {
      console.log(`  ${e.title}`);
    }
    console.log('\nDry run only — no Firestore writes. Re-run with --commit to apply.\n');
    process.exit(0);
  }

  // ── Init Firebase ────────────────────────────────────────────────
  const saPathEnv = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  const saPath = path.resolve(
    process.cwd(),
    saPathEnv ?? `${process.env.HOME}/.config/loar/loar-db-sa.json`
  );
  let serviceAccount: any;
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } else {
    serviceAccount = JSON.parse(readFileSync(saPath, 'utf-8'));
  }

  const app = initializeApp({ credential: cert(serviceAccount) }, 'meridian-' + Date.now());
  const db = getFirestore(app);
  db.settings({ preferRest: true });
  console.log(`  Firebase project: ${serviceAccount.project_id}\n`);

  // ── Universe doc ──────────────────────────────────────────────────
  const ts = Date.now();
  const fakeAddress = `0x${ts.toString(16).padStart(40, '0')}`;
  const universeId = fakeAddress.toLowerCase();
  const now = new Date();

  await db
    .collection('cinematicUniverses')
    .doc(universeId)
    .set({
      address: fakeAddress,
      creator: CREATOR_ADDRESS,
      tokenAddress: `0x${(ts + 1).toString(16).padStart(40, '0')}`,
      governanceAddress: `0x${(ts + 2).toString(16).padStart(40, '0')}`,
      image_url: null,
      description: UNIVERSE_DESCRIPTION,
      name: UNIVERSE_NAME,
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
  console.log(`Universe created: ${universeId}`);

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
  console.log(`Seeded ${CREDITS} credits`);

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
    paymentRef: 'meridian-genesis',
    credits: CREDITS,
    ethAmountWei: '0',
    source: 'genesis',
    note: 'Meridian — genesis credits',
    createdAt: now,
  });

  // ── Entities ──────────────────────────────────────────────────────
  console.log('\nSeeding entities...');
  const idByName = new Map<string, string>();
  const allEntities = [...CHARACTERS, ...ORGANIZATIONS, ...PLACES, ...LORE];

  for (const entity of allEntities) {
    const entityId = randomUUID();
    idByName.set(entity.name, entityId);
    await db
      .collection('entities')
      .doc(entityId)
      .set({
        id: entityId,
        name: entity.name,
        kind: entity.kind,
        description: entity.description,
        universeAddress: universeId,
        parentId: null,
        nodeIds: [],
        imageUrl: null,
        metadata: entity.metadata ?? {},
        monetized: false,
        rightsDeclaration: null,
        unstoppableDomain: null,
        createdBy: CREATOR_ADDRESS.toLowerCase(),
        createdAt: now,
        updatedAt: now,
      });
    console.log(`  [${entity.kind.toUpperCase().padEnd(12)}] ${entity.name}`);
  }

  // ── Relations ─────────────────────────────────────────────────────
  console.log('\nSeeding relations...');
  for (const rel of RELATIONS) {
    const sourceId = idByName.get(rel.from);
    const targetId = idByName.get(rel.to);
    if (!sourceId || !targetId) {
      console.warn(`  SKIPPED (missing entity): ${rel.from} -> ${rel.to}`);
      continue;
    }
    const relId = randomUUID();
    await db.collection('entityRelations').doc(relId).set({
      id: relId,
      sourceId,
      targetId,
      type: rel.type,
      description: rel.description,
      universeAddress: universeId,
      creator: CREATOR_ADDRESS.toLowerCase(),
      createdAt: now,
    });
    console.log(`  ${rel.from} --[${rel.type}]--> ${rel.to}`);
  }

  // ── Episodes (offChainNodes — what the timeline graph actually renders) ──
  console.log('\nSeeding episodes (offChainNodes)...');
  let previousNodeId = 0;
  for (const ep of EPISODES) {
    const nodeId = previousNodeId + 1;
    const docId = randomUUID();
    const plotHash = keccak256(toBytes(ep.plot));
    const contentHash = keccak256(toBytes(''));
    await db.collection('offChainNodes').doc(docId).set({
      id: docId,
      universeId,
      nodeId,
      creator: CREATOR_ADDRESS.toLowerCase(),
      contentHash,
      plotHash,
      videoUrl: '',
      plot: ep.plot,
      title: ep.title,
      sceneId: null,
      previousNodeId,
      children: [],
      canon: true,
      createdAt: now,
      updatedAt: now,
    });
    if (previousNodeId > 0) {
      const parentSnap = await db
        .collection('offChainNodes')
        .where('universeId', '==', universeId)
        .where('nodeId', '==', previousNodeId)
        .limit(1)
        .get();
      if (!parentSnap.empty) {
        await parentSnap.docs[0].ref.update({ children: [nodeId], updatedAt: now });
      }
    }
    console.log(`  [${nodeId}] ${ep.title}`);
    previousNodeId = nodeId;
  }

  // Counter so the live voice demo's next created node doesn't collide.
  await db.collection('offChainNodeCounters').doc(universeId).set({
    latest: previousNodeId,
    updatedAt: now,
  });

  // ── Summary ───────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(60));
  console.log('  MERIDIAN — LIVE ON LOAR');
  console.log('═'.repeat(60));
  console.log(`  Universe ID : ${universeId}`);
  console.log(`  View at     : /universe/${universeId}`);
  console.log('═'.repeat(60));
  console.log(`\n  Owner: ${CREATOR_ADDRESS}`);
  console.log('  Only this wallet (and team members) can direct Meridian by voice — if you');
  console.log('  will sign in with a different wallet, re-run with DEMO_CREATOR_ADDRESS=0x…');
  console.log('  Characters speak with Hume library voices (metadata.humeVoiceId); change one');
  console.log('  with entities.update to give a character a different voice.\n');

  process.exit(0);
}

main().catch((err) => {
  console.error('\nFailed:', err.message ?? err);
  process.exit(1);
});
