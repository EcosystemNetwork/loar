/**
 * Create the "Dragon Egg" universe — A world of dragon eggs.
 *
 * A universe dedicated entirely to dragon eggs in all their forms:
 * incubating, hatching, glowing, ancient, elemental, and mysterious.
 *
 * Usage:
 *   pnpm tsx scripts/create-dragon-egg-universe.ts
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
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const PINATA_JWT = process.env.PINATA_JWT;
const PINATA_GATEWAY = process.env.PINATA_GATEWAY_URL ?? 'https://gateway.pinata.cloud';

const UNIVERSE_NAME = 'Dragon Egg';
const UNIVERSE_DESCRIPTION = `Welcome to Dragon Egg — a universe dedicated to the most sacred and mysterious objects in all of fantasy: the eggs of dragons.

Every video in this universe captures dragon eggs in their infinite variety. Shimmering scales of molten gold catching firelight in a volcanic nest. Ice-blue eggs resting in glacial caverns, pulsing with frost magic. Obsidian shells cracking with internal flame as a hatchling stirs for the first time. Ancient eggs buried in desert sand for millennia, unearthed by wind and fate.

Some eggs are as small as a fist, warm to the touch, humming with life. Others tower over the landscape, petrified remnants of titans long extinct. Some glow. Some sing. Some call to those who are worthy.

Dragon Egg is a visual meditation on potential, mystery, and the moment before everything changes. Each video is a window into a world where these extraordinary objects exist — waiting, dreaming, becoming.

No knights. No quests. No politics. Just the eggs, and the worlds that hold them.`;

// ── Image Generation (Nano Banana 2 + Pinata IPFS) ──────────────────

async function generateAndUploadCoverImage(): Promise<string> {
  if (!GOOGLE_API_KEY) throw new Error('GOOGLE_API_KEY is not set');

  const prompt = [
    'A single magnificent dragon egg resting in a volcanic nest of glowing embers and obsidian rock.',
    'The egg is large, covered in iridescent scales that shift between deep crimson, molten gold, and ember orange.',
    'Tiny cracks of fiery light leak from within, hinting at the life stirring inside.',
    'The nest is surrounded by dark volcanic stone with rivers of lava flowing in the background.',
    'Wisps of steam and smoke curl around the egg.',
    'Bioluminescent crystals embedded in the cave walls cast purple and blue ambient light.',
    'Cinematic composition, dramatic chiaroscuro lighting, ultra-detailed texture on the egg scales.',
    'Fantasy art, 8K, photorealistic rendering with magical realism.',
    'No text, no watermarks, no logos, no characters, no people.',
  ].join(' ');

  console.log('  Calling Nano Banana 2 (gemini-3.1-flash-image-preview)...');
  const model = 'gemini-3.1-flash-image-preview';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': GOOGLE_API_KEY,
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseModalities: ['IMAGE'],
        imageConfig: {
          aspectRatio: '16:9',
          imageSize: '2K',
        },
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    throw new Error(`Nano Banana 2 API error ${response.status}: ${text.slice(0, 300)}`);
  }

  const data = (await response.json()) as {
    candidates?: Array<{
      content: {
        parts: Array<{
          text?: string;
          inlineData?: { mimeType: string; data: string };
        }>;
      };
      finishReason?: string;
    }>;
  };

  const candidate = data.candidates?.[0];
  const imagePart = candidate?.content?.parts?.find((p) => p.inlineData);
  if (!imagePart?.inlineData) {
    console.log(`  Response: ${JSON.stringify(data).slice(0, 300)}`);
    throw new Error(
      'Nano Banana 2 returned no images — prompt may have been blocked by safety filters'
    );
  }

  const base64 = imagePart.inlineData.data;
  const mimeType = imagePart.inlineData.mimeType;
  console.log(`  Generated image (${((base64.length * 0.75) / 1024).toFixed(0)} KB, ${mimeType})`);

  // Upload to Pinata IPFS for permanent hosting
  if (PINATA_JWT) {
    console.log('  Uploading to Pinata IPFS...');
    const buffer = Buffer.from(base64, 'base64');
    const form = new FormData();
    const ext = mimeType === 'image/jpeg' ? 'jpg' : 'png';
    form.append('file', new Blob([buffer], { type: mimeType }), `dragon-egg-cover.${ext}`);
    form.append('pinataMetadata', JSON.stringify({ name: 'Dragon Egg universe cover art' }));

    const pinRes = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
      method: 'POST',
      headers: { Authorization: `Bearer ${PINATA_JWT}` },
      body: form,
    });

    if (pinRes.ok) {
      const pinData = (await pinRes.json()) as { IpfsHash: string };
      const permanentUrl = `${PINATA_GATEWAY}/ipfs/${pinData.IpfsHash}`;
      console.log(`  Pinned to IPFS: ${pinData.IpfsHash}`);
      return permanentUrl;
    }
    console.log(`  Pinata upload failed (${pinRes.status}), using data URI fallback`);
  }

  // Fallback: base64 data URI
  return `data:${mimeType};base64,${base64}`;
}

// ── Entity Templates ────────────────────────────────────────────────
interface EntitySeed {
  name: string;
  kind: string;
  description: string;
  metadata?: Record<string, unknown>;
}

const EGGS: EntitySeed[] = [
  {
    name: 'The Ember Clutch',
    kind: 'thing',
    description:
      'A nest of seven fire dragon eggs arranged in a perfect circle within a volcanic caldera. Each egg pulses with its own rhythm of internal flame, their shells a mosaic of crimson and gold scales harder than steel. The heat radiating from the clutch keeps the surrounding lava molten. Ancient dragonfire runes are scorched into the obsidian floor around them — wards placed by the mother dragon before she flew into the last eruption and never returned. The eggs have been incubating for three hundred years, patient and eternal, waiting for the volcano to speak again.',
    metadata: {
      element: 'Fire',
      count: 7,
      age: '~300 years',
      location: 'Volcanic caldera',
      status: 'Incubating',
    },
  },
  {
    name: 'The Glacial Solitaire',
    kind: 'thing',
    description:
      'A single ice dragon egg suspended in the heart of a frozen waterfall, encased in crystal-clear ice that refracts light into prismatic auroras. The egg itself is pale blue with silver veins that pulse with frost magic, each pulse sending tiny ice fractals spiraling outward through the glacier. It has been here since before the mountain had a name. Explorers who find it report hearing a low harmonic hum — the egg singing to the winter, or the winter singing to the egg. No one has ever been able to chip through the ice. The glacier protects its own.',
    metadata: {
      element: 'Ice',
      count: 1,
      age: 'Primordial',
      location: 'Frozen waterfall, northern mountains',
      status: 'Suspended in glacial ice',
    },
  },
  {
    name: 'The Storm Pearls',
    kind: 'thing',
    description:
      'Three lightning dragon eggs found at the peak of a mountain that is struck by lightning every night. The eggs are smooth and pearl-white, threaded with branching veins of electric blue that flash and crackle during storms. Each egg hovers slightly above the stone summit, suspended by their own static charge. During thunderstorms the eggs glow so brightly they can be seen from miles away — a beacon that has inspired legends of divine light among the valley settlements below. They smell like ozone and sound like distant thunder.',
    metadata: {
      element: 'Lightning',
      count: 3,
      age: 'Unknown',
      location: 'Storm Peak summit',
      status: 'Electromagnetically suspended',
    },
  },
  {
    name: 'The Abyssal Egg',
    kind: 'thing',
    description:
      'A colossal deep-sea dragon egg resting on the ocean floor at a hydrothermal vent, three miles below the surface. The egg is dark as midnight, covered in bioluminescent spots that pulse in slow, hypnotic patterns — green, blue, violet — mimicking the deep-sea creatures that have built a symbiotic ecosystem around it. Tube worms and blind crabs cluster at its base, warmed by the egg\'s internal heat. Submersible footage shows the egg is roughly twelve feet tall. Sonar readings suggest something inside is moving. The research team named it "Leviathan\'s Promise" and classified the coordinates.',
    metadata: {
      element: 'Water / Deep Sea',
      count: 1,
      age: 'Unknown',
      location: 'Ocean floor, hydrothermal vent',
      status: 'Active — movement detected',
      size: '~12 feet tall',
    },
  },
  {
    name: 'The Petrified Clutch of Khal Mazar',
    kind: 'thing',
    description:
      'Eleven dragon eggs turned to stone over millennia, half-buried in the red sands of a vast desert. Wind erosion has exposed their shapes — unmistakably eggs, each the size of a boulder, their surfaces etched with patterns that could be scales or could be ancient script worn smooth by ten thousand sandstorms. Local nomads consider them sacred and leave offerings of water and dried flowers at the base of the largest egg. Once a decade, during the alignment of three stars, the eggs are said to glow faintly amber from within. Geologists insist it is mineral phosphorescence. The nomads know better.',
    metadata: {
      element: 'Earth / Stone',
      count: 11,
      age: '10,000+ years',
      location: 'Khal Mazar desert',
      status: 'Petrified — periodic luminescence',
    },
  },
  {
    name: 'The Verdant Seed',
    kind: 'thing',
    description:
      'A forest dragon egg nestled in the hollow of a tree so ancient it has become a hill. The egg is covered in living moss and tiny flowers that bloom in spiraling patterns along its surface, shifting with the seasons — white blossoms in spring, deep green in summer, gold and copper in autumn, dormant but warm in winter. Roots have grown around and through the nest, cradling the egg in a living lattice. Birds nest in the branches above. Deer sleep at the base. The entire grove radiates an aura of peace and accelerated growth — trees here are twice the size of those in the surrounding forest. The egg is not waiting to hatch. It is gardening.',
    metadata: {
      element: 'Nature / Life',
      count: 1,
      age: 'Centuries',
      location: 'Ancient hollow tree grove',
      status: 'Symbiotic with forest ecosystem',
    },
  },
  {
    name: 'The Shadow Clutch',
    kind: 'thing',
    description:
      'Five void dragon eggs hidden in a cave system where light itself seems to die. The eggs are pure matte black and seem to absorb all illumination — torches dim, lanterns gutter, even magical light bends away from their surfaces. They can only be perceived by the absence they create: egg-shaped holes in reality where nothing reflects. Touching one produces no sensation of temperature or texture, only a profound sense of depth, as if your hand is falling into something infinitely far away. The cave walls around them are covered in scratch marks from creatures that wandered too close and could not find their way back out.',
    metadata: {
      element: 'Void / Shadow',
      count: 5,
      age: 'Immeasurable',
      location: 'Lightless cave system',
      status: 'Active light absorption',
    },
  },
  {
    name: 'The Singing Egg of Lúnavael',
    kind: 'thing',
    description:
      'A crystalline dragon egg that produces music. Translucent and faceted like a giant gemstone, it sits in a marble amphitheater built by a civilization that existed solely to listen to it. The egg emits a continuous, evolving melody — never repeating, never discordant — that changes with the weather, the season, and the number of listeners present. Scholars have transcribed over four thousand hours of its music and found mathematical structures that correspond to no known system of composition. The melody is said to be the dreams of the dragon inside, singing itself into existence. When it finally hatches, the music will stop. No one who has heard it wants that day to come.',
    metadata: {
      element: 'Sound / Crystal',
      count: 1,
      age: '~800 years of recorded music',
      location: 'Marble amphitheater of Lúnavael',
      status: 'Continuously singing',
    },
  },
];

const PLACES: EntitySeed[] = [
  {
    name: 'The Caldera of First Fire',
    kind: 'place',
    description:
      'An active volcanic caldera where the Ember Clutch resides. The caldera is a bowl of black obsidian and flowing lava, vented by geysers of superheated steam. The air shimmers with heat distortion. Ancient dragon-scale patterns are burned into the rock walls — whether by dragonfire or geological process, no one can say. The volcano erupts on a three-hundred-year cycle, and each eruption coincides with a hatching event. The next eruption is overdue.',
    metadata: {
      type: 'Volcanic Caldera',
      status: 'Active, overdue eruption',
      significance: 'Nesting ground for fire dragon eggs',
    },
  },
  {
    name: 'The Resonance Grotto',
    kind: 'place',
    description:
      'A vast underwater cave system illuminated entirely by the bioluminescence of the Abyssal Egg and the deep-sea ecosystem it sustains. Hydrothermal vents pump mineral-rich water through cathedral-sized chambers. The acoustics are extraordinary — every sound reverberates and harmonizes, creating an ambient drone that submersible crews describe as "the ocean breathing." The pressure at this depth would crush an unprotected human instantly. Only machines and dragons belong here.',
    metadata: {
      type: 'Deep-sea cave system',
      depth: '~3 miles below surface',
      significance: 'Home of the Abyssal Egg',
    },
  },
  {
    name: 'The Amphitheater of Lúnavael',
    kind: 'place',
    description:
      'A perfect marble amphitheater carved into a mountainside by a civilization that existed for the sole purpose of listening to the Singing Egg. Tiered seating for thousands surrounds a central stage where the crystalline egg rests on a pedestal of rose quartz. The acoustics are supernaturally perfect — a whisper from the stage reaches every seat. The civilization that built it left no other structures, no written language, no tools. Only this amphitheater and the silence between the notes.',
    metadata: {
      type: 'Ancient amphitheater',
      builders: 'Unknown — the Listeners',
      significance: 'Houses the Singing Egg',
    },
  },
  {
    name: 'The Dunes of Khal Mazar',
    kind: 'place',
    description:
      'An endless expanse of red desert where winds sculpt the sand into shapes that almost resemble sleeping dragons. Eleven petrified eggs dot the landscape like boulders, half-buried and weathered. The nomads who traverse these dunes navigate by the eggs — each one a landmark, each one named, each one honored. At night the desert is silent except for the sand shifting and, once a decade, the low amber glow from within the stones that the geologists refuse to explain.',
    metadata: {
      type: 'Desert',
      significance: 'Site of the Petrified Clutch',
      inhabitants: 'Nomadic tribes',
    },
  },
];

const LORE: EntitySeed[] = [
  {
    name: 'The Incubation Principle',
    kind: 'lore',
    description:
      'The fundamental law governing dragon eggs across all known varieties: a dragon egg will not hatch until the world needs what it contains. Fire eggs wait for volcanic cycles. Ice eggs wait for the glaciers to recede. Storm eggs wait for the atmosphere to call. This is not metaphor — it is observed behavior across thousands of years of documentation. Dragon eggs are patient on a geological timescale. They do not expire. They do not die. They wait, and the waiting is the point. The egg is not a container. It is a promise.',
    metadata: {
      significance: 'Core cosmological principle of the Dragon Egg universe',
    },
  },
  {
    name: 'The Egg Spectrum',
    kind: 'lore',
    description:
      'A classification system developed by scholars who dedicated their lives to studying dragon eggs. The spectrum categorizes eggs by elemental affinity, incubation behavior, and environmental interaction: Fire (volcanic, heat-dependent), Ice (glacial, cold-sustained), Lightning (atmospheric, storm-charged), Water (oceanic, pressure-dependent), Earth (geological, time-dependent), Nature (biological, symbiotic), Void (entropic, light-absorbing), Crystal (harmonic, sound-producing). Each category represents not just an element but a relationship between the egg and its environment. The egg shapes the world around it as much as the world shapes the egg.',
    metadata: {
      significance: 'Taxonomic framework for dragon egg classification',
    },
  },
  {
    name: 'The First Hatching',
    kind: 'event',
    description:
      'The oldest recorded hatching event, preserved in cave paintings found across multiple continents. The images depict a single massive egg — far larger than any known specimen — cracking open at the center of what appears to be a primordial ocean. From it emerged not a dragon but light itself, and from the fragments of the shell, the first mountains formed. Whether this is mythology or eyewitness paleontology is a matter of heated academic debate. The cave paintings are carbon-dated to 40,000 years ago. The geological record shows a mysterious global seismic event at approximately the same time.',
    metadata: {
      significance: 'Origin myth / possible historical event',
      age: '~40,000 years ago',
    },
  },
];

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  console.log('\n' + '═'.repeat(60));
  console.log('  LOAR — Creating DRAGON EGG');
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

  const app = initializeApp({ credential: cert(serviceAccount) }, 'dragon-egg-' + Date.now());
  const db = getFirestore(app);
  db.settings({ preferRest: true });
  console.log(`  Firebase : ${serviceAccount.project_id}`);
  console.log(`  Creator  : ${CREATOR_ADDRESS}`);
  console.log(`  Imagen   : ${GOOGLE_API_KEY ? 'configured' : 'missing'}`);
  console.log(`  Pinata   : ${PINATA_JWT ? 'configured' : 'missing'}\n`);

  // ── Step 1: Generate AI cover image ────────────────────────────────
  console.log('Step 1: Generating cover image via Google Imagen 4...');

  let coverImageUrl: string;
  try {
    coverImageUrl = await generateAndUploadCoverImage();
    console.log(`  URL: ${coverImageUrl.slice(0, 80)}...\n`);
  } catch (err: any) {
    console.log(`  Image generation failed: ${err.message}`);
    console.log(`  Using placeholder image\n`);
    coverImageUrl =
      'https://images.unsplash.com/photo-1557672172-298e090bd0f1?w=1200&h=675&fit=crop';
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
    paymentRef: 'dragon-egg-genesis',
    credits: CREDITS,
    ethAmountWei: '0',
    source: 'genesis',
    note: 'Dragon Egg — genesis credits',
    createdAt: now,
  });
  console.log(`  Credit transaction logged\n`);

  // ── Step 3: Seed entities ─────────────────────────────────────────
  console.log('Step 3: Seeding worldbuilding entities...\n');

  const allEntities: EntitySeed[] = [...EGGS, ...PLACES, ...LORE];

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
  console.log('  DRAGON EGG — LIVE ON LOAR');
  console.log('═'.repeat(60));
  console.log(`  Universe ID  : ${universeId}`);
  console.log(`  Name         : ${UNIVERSE_NAME}`);
  console.log(`  Creator      : ${CREATOR_ADDRESS}`);
  console.log(`  Credits      : ${CREDITS}`);
  console.log(`  Entities     : ${seeded}`);
  console.log(`    Eggs       : ${EGGS.length}`);
  console.log(`    Places     : ${PLACES.length}`);
  console.log(`    Lore/Events: ${LORE.length}`);
  console.log(`  Cover Image  : ${coverImageUrl.slice(0, 70)}...`);
  console.log(`  Access Model : open`);
  console.log('═'.repeat(60));
  console.log(`\n  View at: /universe/${universeId}\n`);
  console.log('  The egg is not a container. It is a promise.\n');

  process.exit(0);
}

main().catch((err) => {
  console.error('\nFailed:', err.message ?? err);
  process.exit(1);
});
