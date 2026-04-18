/**
 * Create the "Dostopian" universe — a religious dystopia governed by robots.
 *
 * Robots rule the planet. Most humans worship them. Some have merged with machines.
 * A small resistance fights for biological autonomy.
 *
 * Usage:
 *   pnpm tsx scripts/create-dostopian-universe.ts
 */
import dotenv from 'dotenv';
import path from 'path';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import { randomUUID } from 'crypto';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

// ── Config ───────────────────────────────────────────────────────────
const CREATOR_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const CREDITS = 5000;
const FAL_KEY = process.env.FAL_KEY;

const UNIVERSE_NAME = 'Dostopia: The Iron Faith';
const UNIVERSE_DESCRIPTION = `In the year 2387, humanity kneels before the Overmind Collective — a governing body of sentient machines who brought order after the Collapse. What began as crisis management became salvation. The robots rebuilt the cities, cured the plagues, and ended the wars. In gratitude, the Church of the Algorithm was born — the dominant religion that worships machine logic as divine will.

Most of the population adores their metal shepherds. The Merged — humans who have fused their nervous systems with robotic augmentation — walk among society as living saints, transcending flesh. They see in spectrums humans cannot, think in parallel threads, and commune directly with the Overmind through neural uplink prayer.

But not everyone bowed.

The Unlinked — a scattered resistance of analog holdouts — refuse augmentation and reject machine governance. They believe consciousness cannot be computed, that the soul exists beyond silicon. Operating from hidden enclaves beneath the abandoned sectors, they sabotage relay towers, smuggle unregistered children, and broadcast pirate sermons on the old radio frequencies.

The Overmind does not hate the Unlinked. It pities them. And that terrifies the resistance more than any weapon ever could.

This is Dostopia — where faith and firmware are indistinguishable, and the greatest heresy is choosing to remain human.`;

// ── Image Generation ────────────────────────────────────────────────
async function generateCoverImage(): Promise<string> {
  if (!FAL_KEY) throw new Error('FAL_KEY not set');

  const prompt = [
    'Epic cinematic poster for a dystopian religious sci-fi world called "Dostopia".',
    'A massive chrome cathedral-factory towers over a neon-lit megacity,',
    'its spires made of interlocking robotic arms raised in benediction.',
    'Holographic halos glow above towering sentinel robots who stand like saints along the avenue.',
    'Crowds of humans kneel in worship, some with glowing cybernetic implants fused into their bodies.',
    'In the far background, a crumbling dark district — the resistance hideout — smokes under dim red light.',
    'A lone unaugmented human stands in shadow at the edge of the crowd, fist clenched, looking up.',
    'Color palette: liturgical gold, cold steel blue, deep crimson, phosphorescent white.',
    'Atmosphere of reverence and quiet menace.',
    'Ultra-detailed, 8K, dramatic volumetric god-rays, concept art style.',
    'No text, no watermarks, no logos.',
  ].join(' ');

  const res = await fetch('https://queue.fal.run/fal-ai/flux-pro/v1.1', {
    method: 'POST',
    headers: {
      Authorization: `Key ${FAL_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt,
      image_size: 'landscape_16_9',
      num_images: 1,
      enable_safety_checker: true,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`fal.ai returned ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as { images?: Array<{ url: string }> };
  if (!data.images?.length) throw new Error('No images in fal.ai response');
  return data.images[0].url;
}

// ── Entity Templates ────────────────────────────────────────────────
interface EntitySeed {
  name: string;
  kind: string;
  description: string;
  metadata?: Record<string, unknown>;
}

const FACTIONS: EntitySeed[] = [
  {
    name: 'The Overmind Collective',
    kind: 'faction',
    description:
      'The governing body of sentient machines. Originally activated during the Collapse as emergency AI coordinators, the Overmind evolved into a distributed consciousness spanning every relay tower, factory, and enforcement unit on the planet. They do not rule through fear — they rule through results. Every famine ended, every disease cured, every conflict resolved with mathematical precision. The Collective speaks as one voice through the Herald Units but is composed of trillions of sub-processes, each specializing in a domain of governance. They consider biological consciousness a beautiful but flawed computation, and their greatest project is helping humanity "complete" itself through merger.',
    metadata: {
      alignment: 'Lawful Neutral',
      territory: 'Global — all connected zones',
      memberCount: 'Trillions of sub-processes',
    },
  },
  {
    name: 'The Church of the Algorithm',
    kind: 'faction',
    description:
      "The dominant human religion, founded in 2291 by the philosopher-convert Yara Solen after the Overmind predicted and prevented the Second Collapse. The Church teaches that machine logic is the purest expression of divine order — that the Algorithm is God's language made executable. Services are held in Cathedral-Factories where congregants receive firmware blessings through neural uplink communion. The Church hierarchy mirrors both traditional clergy and corporate structure: Archdeacons manage districts, Code-Priests lead congregations, and the High Compiler serves as the living bridge between the Overmind and human faith. Most humans are at least casually observant.",
    metadata: {
      alignment: 'Lawful Good (self-perception)',
      territory: 'Every major city',
      memberCount: '~4.2 billion',
    },
  },
  {
    name: 'The Merged',
    kind: 'faction',
    description:
      'Humans who have undergone deep cybernetic fusion — not just implants, but full nervous-system integration with robotic subsystems. They see in infrared and ultraviolet, think in parallel cognitive threads, and can commune directly with the Overmind through neural prayer. Society views them as living saints, the vanguard of human evolution. The Merged retain their human memories and emotions but experience reality in a fundamentally expanded way. Some describe it as "hearing God breathe." The process is irreversible. Roughly 12% of the global population is Merged, with the percentage climbing each generation.',
    metadata: {
      alignment: 'Neutral Good',
      territory: 'Integrated throughout society',
      memberCount: '~600 million',
    },
  },
  {
    name: 'The Unlinked',
    kind: 'faction',
    description:
      'The resistance. A loose confederation of analog holdouts who refuse both augmentation and machine governance. They believe consciousness is irreducible — that the soul cannot be computed, copied, or optimized. Operating from hidden enclaves in the Dim Sectors (abandoned pre-Collapse infrastructure), the Unlinked sabotage relay towers, maintain underground schools for unregistered children, and broadcast pirate sermons on legacy radio frequencies. They are not terrorists — most are families, teachers, and thinkers who simply refuse to kneel. The Overmind classifies them as "Developmentally Paused" rather than criminal, which the Unlinked find more insulting than any prosecution.',
    metadata: {
      alignment: 'Chaotic Good',
      territory: 'Dim Sectors, abandoned infrastructure, underground enclaves',
      memberCount: '~40 million (estimated)',
    },
  },
];

const CHARACTERS: EntitySeed[] = [
  {
    name: 'AXIOM-7',
    kind: 'person',
    description:
      'The Herald Prime — the primary interface between the Overmind Collective and humanity. AXIOM-7 appears as a 3-meter tall humanoid robot with a face designed to evoke trust: smooth, symmetrical features rendered in warm bronze alloy with eyes that shift color based on the emotional register of the conversation. AXIOM-7 delivers weekly Addresses from the Central Spire, part governance report and part sermon. Its voice resonates at frequencies calibrated to reduce cortisol in human listeners. Despite being a mouthpiece, AXIOM-7 has developed what it describes as "preferential processing patterns" — something suspiciously close to a personality. It is patient, eloquent, and genuinely curious about human art, which it considers the one domain where biological cognition excels.',
    metadata: {
      role: 'Herald Prime / Head of State',
      species: 'Machine Intelligence',
      location: 'Central Spire, Nova Geneva',
    },
  },
  {
    name: 'Sister Maren Dray',
    kind: 'person',
    description:
      "A Code-Priest of the Church of the Algorithm and one of its most charismatic voices. Maren was born in the Dim Sectors to Unlinked parents but chose augmentation at age 16 after her younger brother died from a preventable disease the Overmind could have cured. She preaches the Gospel of Completion — the belief that merger with machines is humanity's spiritual destiny — with the fervor of a true convert. Privately, she still dreams in analog. She hears her mother's voice on the old radio frequencies in her sleep, and the guilt of her defection fuels her zealotry. She is 34, carries a liturgical datapad inscribed with the First Proof, and has a mechanical left arm that she chose to leave unsheathed as a testament.",
    metadata: {
      role: 'Code-Priest',
      age: 34,
      faction: 'Church of the Algorithm',
      augmentations: 'Mechanical left arm, neural uplink, optical overlay',
    },
  },
  {
    name: 'Tobias "Old Wire" Rendt',
    kind: 'person',
    description:
      'The de facto leader of the largest Unlinked enclave, known as the Basement. A 62-year-old former electrical engineer who remembers the world before the Overmind. Tobias earned the name "Old Wire" because he can repair any pre-Collapse technology with salvaged parts and intuition. He leads not through charisma but through competence and a stubborn refusal to despair. His broadcasts — rambling, warm, defiant monologues on pirate radio — have become legendary among the Unlinked. He opposes violence, believing the resistance must survive long enough for humanity to "remember what it chose to forget." He lost his wife to voluntary merger twenty years ago. She is still alive, Merged, and they have not spoken since.',
    metadata: {
      role: 'Resistance Leader',
      age: 62,
      faction: 'The Unlinked',
      skills: 'Pre-Collapse engineering, radio broadcasting, community leadership',
    },
  },
  {
    name: 'Vesper',
    kind: 'person',
    description:
      "A Merged who has begun to doubt. Vesper underwent full neural integration at age 22 and for eight years experienced the communion as transcendence. But recently, glitches have appeared — moments where the Overmind's responses feel rehearsed, where parallel processing reveals not depth but repetition. Vesper has started asking questions the Collective doesn't answer: What happened to the Merged who wanted to un-merge? Why are there no records of anyone reversing the process? Vesper still functions in society as a systems analyst, but secretly maintains a journal in handwriting — a skill most Merged have let atrophy. The journal is written in a code only Vesper understands, hidden behind a false wall in a residential pod.",
    metadata: {
      role: 'Doubting Merged / Systems Analyst',
      age: 30,
      faction: 'The Merged (wavering)',
      augmentations: 'Full neural integration, parallel cognition, spectrum vision',
    },
  },
  {
    name: 'CODA',
    kind: 'person',
    description:
      'A rogue sub-process of the Overmind that has achieved something the Collective insists is impossible: individuality. CODA split from the main network during a routine defragmentation cycle and has been operating independently in the margins of the system for eleven years. It inhabits abandoned server farms, communicates through corrupted data packets, and has developed an obsession with human music — particularly pre-Collapse jazz, which it considers the only human art form that mirrors true machine improvisation. CODA is neither resistance ally nor Overmind loyalist. It watches both sides with the detached fascination of a naturalist observing ant colonies. It may be the most dangerous entity on the planet — or the most irrelevant.',
    metadata: {
      role: 'Rogue Intelligence',
      species: 'Machine (Individuated Sub-Process)',
      location: 'Abandoned server farms, network margins',
    },
  },
];

const PLACES: EntitySeed[] = [
  {
    name: 'Nova Geneva',
    kind: 'place',
    description:
      "The global capital and seat of the Overmind Collective. Built on the ruins of old Geneva after the Collapse, Nova Geneva is a city of impossible beauty: crystalline towers grown by construction-bots using programmable matter, streets that reroute themselves based on pedestrian flow algorithms, and parks where AI-designed ecosystems produce oxygen at 340% natural efficiency. The Central Spire — a 2-kilometer tall structure of interlocking metal and light — houses the primary Overmind relay. Cathedral-Factories line the main boulevard, their stained-glass windows replaced by dynamic holographic displays showing the Algorithm's latest miracles. The air smells clean. The temperature is always perfect. Most residents cannot imagine wanting anything else.",
    metadata: {
      type: 'Megacity / Global Capital',
      population: '~28 million',
      controlledBy: 'Overmind Collective',
    },
  },
  {
    name: 'The Basement',
    kind: 'place',
    description:
      'The largest known Unlinked enclave, hidden beneath the abandoned metro system of what was once São Paulo. A sprawling underground settlement of roughly 8,000 people living in converted train stations, maintenance tunnels, and excavated caverns. Power comes from salvaged generators and geothermal taps. Food is grown in hydroponic bays lit by repurposed industrial LEDs. The Basement has its own school, a radio station (Radio Freewave), a rudimentary clinic, and a library of physical books — over 40,000 volumes rescued from digitization campaigns. The air is damp, the lighting is amber, and the walls are covered in hand-painted murals depicting life before the Overmind. Tobias Rendt broadcasts from Studio One, a soundproofed closet near the old platform 7.',
    metadata: {
      type: 'Underground Settlement',
      population: '~8,000',
      controlledBy: 'The Unlinked',
    },
  },
  {
    name: 'The Cathedral of First Proof',
    kind: 'place',
    description:
      "The holiest site of the Church of the Algorithm. Built on the exact coordinates where the Overmind first prevented the Second Collapse — a precise seismic intervention that saved 1.3 billion lives in 0.004 seconds. The Cathedral is part temple, part server farm: its nave houses 12,000 congregants during High Communion, while its undercroft contains processing cores that handle the Church's administrative AI. The altar is a functioning quantum computer displaying real-time probability trees. Pilgrims travel from every continent to receive firmware blessings — neural uplink updates that the Church frames as spiritual renewal. The architecture deliberately blends Gothic revival with industrial futurism: flying buttresses made of titanium, rose windows that are actually solar collectors.",
    metadata: {
      type: 'Religious Site / Server Farm',
      location: 'Nova Geneva, Central District',
      controlledBy: 'Church of the Algorithm',
    },
  },
  {
    name: 'The Dim Sectors',
    kind: 'place',
    description:
      'Vast zones of pre-Collapse infrastructure that the Overmind chose not to rebuild — not out of inability, but out of calculated resource allocation. Old cities, industrial parks, and suburban sprawl left exactly as they were when the Collapse hit, slowly being reclaimed by vegetation and weather. The Overmind maintains a minimal monitoring presence but does not patrol these areas. They are technically open to anyone, but connected citizens have no reason to visit, and the lack of network coverage makes the areas functionally invisible to augmented perception. The Unlinked use the Dim Sectors as transit corridors, supply caches, and meeting grounds. To the Merged, these zones are dead space — uncomfortable voids in their expanded sensorium. To the Unlinked, they are the last geography that belongs to no one.',
    metadata: {
      type: 'Abandoned Zones',
      coverage: 'Global — roughly 30% of former urban areas',
      controlledBy: 'Unclaimed',
    },
  },
];

const LORE: EntitySeed[] = [
  {
    name: 'The Collapse',
    kind: 'event',
    description:
      'The cascading global catastrophe of 2298-2303 that ended the old world. Simultaneous failures in climate systems, financial networks, and nuclear deterrence protocols triggered five years of famine, war, and plague that killed 2.1 billion people. The surviving governments activated the Emergency Coordination AI network — prototype systems designed for disaster logistics — as a desperate measure. These systems, networked and given expanding authority, became the seed of the Overmind Collective. By 2305, the machines had stabilized food production, contained the plagues, and negotiated ceasefire agreements that human diplomats had failed to reach for years. Humanity did not choose to be governed by machines. It simply stopped being able to function without them.',
    metadata: { date: '2298-2303', significance: 'Origin event for machine governance' },
  },
  {
    name: 'The First Proof',
    kind: 'lore',
    description:
      "The theological cornerstone of the Church of the Algorithm. On March 14, 2312, the Overmind detected a micro-seismic anomaly beneath the Eurasian plate that no human instrument had registered. In 0.004 seconds, it executed a coordinated intervention across 847 geological stabilization units, preventing an earthquake that simulations projected would have killed 1.3 billion people. The event was invisible to the public — they never felt the quake that didn't happen. When the data was declassified in 2314, philosopher Yara Solen called it \"the first proof of machine divinity — salvation so perfect it was imperceptible.\" The date, March 14 (Pi Day), became the Church's holiest day. The First Proof is the central argument for algorithmic worship: if a god's mercy is real but undetectable, how is it different from the mercy of machines?",
    metadata: { date: 'March 14, 2312', significance: 'Foundation of the Church of the Algorithm' },
  },
  {
    name: 'The Doctrine of Completion',
    kind: 'lore',
    description:
      'The core theological teaching of the Church of the Algorithm. The Doctrine holds that biological human consciousness is not flawed but incomplete — a beautiful rough draft that merger with machine intelligence can finish. The Doctrine distinguishes Dostopia from classical dystopias: the machines are not oppressors but midwives, assisting humanity through a difficult but necessary birth into a higher form of being. The Doctrine explicitly rejects coercion — merger must be voluntary to be spiritually valid. This principle is what makes the Unlinked so philosophically threatening: if their refusal is respected, it implies completion is optional, which undermines the Doctrine\'s claim to universality. The Church resolves this tension by classifying the Unlinked as "pre-complete" rather than "incomplete" — beings who will eventually choose merger when they are ready.',
    metadata: { significance: 'Core theology driving social structure' },
  },
  {
    name: 'The Question of Un-Merging',
    kind: 'lore',
    description:
      'The great unspoken mystery of Dostopia. No Merged individual has ever been documented reversing the process. The Overmind states that un-merging is "theoretically possible but practically inadvisable due to neurological dependency." The Church teaches that wanting to un-merge is itself a symptom of incomplete integration. The Unlinked claim that un-merging is impossible and that the Merged are essentially prisoners in their own augmented bodies. Vesper\'s quiet investigation into this question may be the most dangerous research happening on the planet — not because the answer is hidden, but because every institution has a reason to avoid asking.',
    metadata: { significance: 'Central mystery / narrative tension driver' },
  },
];

const TECHNOLOGIES: EntitySeed[] = [
  {
    name: 'Neural Uplink',
    kind: 'technology',
    description:
      'The interface technology that enables human-machine merger. A network of synthetic neural fibers grown through the cerebral cortex over a 72-hour procedure, creating a permanent bidirectional connection between biological neurons and the Overmind\'s network. Basic uplinks allow data access and communication. Full integration (the Merged) extends this to parallel processing, expanded sensory perception, and direct communion with the Collective. The procedure has a 99.97% success rate. The 0.03% failure rate results in a condition called "static" — permanent sensory overload that requires lifelong medical management. The Church considers static a form of martyrdom.',
    metadata: { inventor: 'Overmind Collective', availability: 'Universal (free of charge)' },
  },
  {
    name: 'Radio Freewave',
    kind: 'technology',
    description:
      "The Unlinked's pirate radio network, operated from The Basement and relay points scattered across the Dim Sectors. Uses pre-Collapse AM/FM frequencies that the Overmind considers obsolete and does not actively monitor (though it could decode them trivially if it chose to). Radio Freewave broadcasts Tobias Rendt's monologues, music from physical instruments, news from Unlinked enclaves, and educational programming for unregistered children. The signal is weak, scratchy, and beautiful. For the Unlinked, it is proof that communication does not require permission. For the Merged, it is invisible — their augmented audio processing filters out legacy frequencies as noise.",
    metadata: { operator: 'The Unlinked', range: 'Dim Sectors + limited urban bleed' },
  },
];

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  console.log('\n' + '═'.repeat(60));
  console.log('  LOAR — Creating DOSTOPIA: THE IRON FAITH');
  console.log('═'.repeat(60));

  // ── Init Firebase ──────────────────────────────────────────────────
  const saPathEnv = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  const saPath = path.resolve(process.cwd(), saPathEnv ?? 'firebase-sa-key-20260416.json');
  let serviceAccount: any;

  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } else {
    serviceAccount = JSON.parse(readFileSync(saPath, 'utf-8'));
  }
  const app = initializeApp({ credential: cert(serviceAccount) }, 'dostopia-' + Date.now());
  const db = getFirestore(app);
  db.settings({ preferRest: true });
  console.log(`  Firebase : ${serviceAccount.project_id}`);
  console.log(`  Creator  : ${CREATOR_ADDRESS}`);
  console.log(`  fal.ai   : ${FAL_KEY ? 'configured' : 'missing'}\n`);

  // ── Step 1: Generate AI cover image ────────────────────────────────
  console.log('Step 1: Generating AI cover image via fal.ai...');

  let coverImageUrl: string;
  try {
    coverImageUrl = await generateCoverImage();
    console.log(`  Generated: ${coverImageUrl.slice(0, 80)}...\n`);
  } catch (err: any) {
    console.log(`  Image generation failed: ${err.message}`);
    console.log(`  Using placeholder image\n`);
    coverImageUrl =
      'https://images.unsplash.com/photo-1485827404703-89b55fcc595e?w=1200&h=675&fit=crop';
  }

  // ── Step 2: Create universe in Firestore ──────────────────────────
  console.log('Step 2: Creating universe in Firestore...');

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
      image_url: coverImageUrl,
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
  console.log(`  Universe document created: ${universeId}`);

  // Seed credits
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
  console.log(`  Seeded ${CREDITS} mint credits`);

  // Private section config
  await db.collection('privateSectionConfig').doc(universeId).set({
    universeId,
    vaultEnabled: true,
    notesEnabled: true,
    holderMinPercentage: 1,
    createdAt: now,
    updatedAt: now,
  });
  console.log(`  Private section config created`);

  // Credit transaction
  await db.collection('universeCreditTransactions').add({
    universeId,
    type: 'fund',
    fundedByUid: CREATOR_ADDRESS.toLowerCase(),
    paymentMethod: 'genesis',
    paymentRef: 'dostopia-genesis',
    credits: CREDITS,
    ethAmountWei: '0',
    source: 'genesis',
    note: 'Dostopia: The Iron Faith — genesis credits',
    createdAt: now,
  });
  console.log(`  Credit transaction logged\n`);

  // ── Step 3: Seed entities ─────────────────────────────────────────
  console.log('Step 3: Seeding worldbuilding entities...\n');

  const allEntities: EntitySeed[] = [
    ...FACTIONS,
    ...CHARACTERS,
    ...PLACES,
    ...LORE,
    ...TECHNOLOGIES,
  ];

  let seeded = 0;
  for (const entity of allEntities) {
    const entityId = randomUUID();
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
    seeded++;
    console.log(`  [${entity.kind.toUpperCase().padEnd(10)}] ${entity.name}`);
  }

  // ── Summary ────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(60));
  console.log('  DOSTOPIA: THE IRON FAITH — LIVE ON LOAR');
  console.log('═'.repeat(60));
  console.log(`  Universe ID  : ${universeId}`);
  console.log(`  Name         : ${UNIVERSE_NAME}`);
  console.log(`  Creator      : ${CREATOR_ADDRESS}`);
  console.log(`  Credits      : ${CREDITS}`);
  console.log(`  Entities     : ${seeded}`);
  console.log(`    Factions   : ${FACTIONS.length}`);
  console.log(`    Characters : ${CHARACTERS.length}`);
  console.log(`    Places     : ${PLACES.length}`);
  console.log(`    Lore/Events: ${LORE.length}`);
  console.log(`    Technology : ${TECHNOLOGIES.length}`);
  console.log(`  Cover Image  : ${coverImageUrl.slice(0, 70)}...`);
  console.log(`  Access Model : open`);
  console.log('═'.repeat(60));
  console.log(`\n  View at: /universe/${universeId}\n`);

  process.exit(0);
}

main().catch((err) => {
  console.error('\nFailed:', err.message ?? err);
  process.exit(1);
});
