/**
 * Test script — creates one entity of every kind to verify the full create pipeline.
 *
 * Creates 10 creator kinds + 6 structural kinds in "Voidborn Saga" universe.
 * Structural kinds are created in hierarchy order: timeline → reality → dimension → plane → realm → domain
 *
 * Usage: pnpm tsx scripts/test-create-all-entities.ts
 */
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { getAddress } from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const rawKey = process.env.PRIVATE_KEY ?? '';
const PRIVATE_KEY = (rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`) as `0x${string}`;
const SERVER_URL = process.env.VITE_SERVER_URL ?? 'http://localhost:3000';
const account = privateKeyToAccount(PRIVATE_KEY);

const UNIVERSE_ADDR = '0x89669812f850f34f907ee9e9009f501d1b008420';

// ── SIWE Auth ─────────────────────────────────────────────────────────
function buildSiweMessage(params: { address: string; nonce: string; chainId: number }): string {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 5 * 60 * 1000);
  return [
    `localhost wants you to sign in with your Ethereum account:`,
    params.address,
    '',
    'Sign in to LOAR',
    '',
    `URI: http://localhost:5173`,
    `Version: 1`,
    `Chain ID: ${params.chainId}`,
    `Nonce: ${params.nonce}`,
    `Issued At: ${now.toISOString()}`,
    `Expiration Time: ${expiresAt.toISOString()}`,
  ].join('\n');
}

async function getAuthToken(): Promise<string> {
  const nonceRes = await fetch(`${SERVER_URL}/auth/nonce`);
  const { nonce } = (await nonceRes.json()) as { nonce: string };
  const message = buildSiweMessage({
    address: getAddress(account.address),
    nonce,
    chainId: sepolia.id,
  });
  const signature = await account.signMessage({ message });
  const verifyRes = await fetch(`${SERVER_URL}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
    body: JSON.stringify({ message, signature }),
  });
  const setCookie = verifyRes.headers.get('set-cookie') ?? '';
  const match = setCookie.match(/siwe-session=([^;]+)/);
  if (!match) throw new Error('No session cookie');
  return match[1];
}

async function tRPCMutate<T>(procedure: string, input: unknown, token: string): Promise<T> {
  const res = await fetch(`${SERVER_URL}/trpc/${procedure}?batch=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ '0': input }),
  });
  const json = (await res.json()) as any[];
  if (json[0]?.error)
    throw new Error(`tRPC ${procedure}: ${JSON.stringify(json[0].error).slice(0, 500)}`);
  return json[0]?.result?.data;
}

function log(kind: string, msg: string) {
  console.log(`  [${kind.padEnd(12)}] ${msg}`);
}

// ── Test Entity Data ──────────────────────────────────────────────────

interface TestEntity {
  name: string;
  description: string;
  kind: string;
  metadata: Record<string, string>;
  universeAddress?: string | null;
  parentId?: string | null;
}

const CREATOR_ENTITIES: TestEntity[] = [
  {
    name: 'Kael Duskbane',
    description:
      'A battle-scarred void knight who hunts rogue entities between collapsing dimensions. Once sworn to protect the Voidborn Conclave, now walks alone after witnessing the Fall of Ashenmire.',
    kind: 'person',
    metadata: {
      role: 'Anti-Hero / Void Knight',
      appearance:
        'Tall, gaunt frame clad in obsidian plate armor etched with violet runes. Left eye replaced with a swirling void shard. Silver-white hair, scarred jawline.',
      motivations:
        'Seeks to close the Rift of Unmaking before it swallows reality. Haunted by guilt over failing to save Ashenmire.',
      abilities:
        'Void Step (short-range teleportation through shadow), Nullblade mastery, dimensional sensing, resistance to psychic corruption',
      homePlace: 'Ashenmire (destroyed)',
      affiliations: 'Former Voidborn Conclave Knight, now unaffiliated',
    },
  },
  {
    name: 'The Obsidian Spire',
    description:
      'A towering fortress carved from a single piece of volcanic glass, floating above the Ashlands. Serves as the last neutral ground between warring factions.',
    kind: 'place',
    metadata: {
      placeType: 'Floating Fortress',
      atmosphere:
        'Eerie violet glow from embedded void crystals. Constant low hum of dimensional energy. Temperature shifts unpredictably between scorching and freezing.',
      rulesAndDangers:
        'No weapons may be drawn within the Spire. Violation triggers the Sentinel Constructs. The lower levels are sealed — rumored to contain a dormant entity.',
      inhabitants: 'The Archivist Order, visiting diplomats, fugitives granted asylum',
      governingFaction: 'The Archivist Order (neutral faction)',
    },
  },
  {
    name: 'The Nullblade',
    description:
      'A weapon forged from collapsed dimensional matter. It cuts not flesh but the bonds between a target and reality itself.',
    kind: 'thing',
    metadata: {
      thingType: 'Weapon — Greatsword',
      origin:
        'Forged by the Voidborn Conclave during the First Incursion. The blade was quenched in the tears of a dying dimension.',
      powersAndUse:
        'Severs dimensional tethers — targets struck begin to phase out of reality. Extended contact causes permanent erasure. Can also cut through magical barriers.',
      rarity: 'Unique — only one exists',
      currentOwner: 'Kael Duskbane',
    },
  },
  {
    name: 'The Voidborn Conclave',
    description:
      'An ancient order of dimensional guardians who patrol the boundaries between realities. Decimated after the Fall of Ashenmire, now reduced to scattered cells.',
    kind: 'faction',
    metadata: {
      mission:
        'Maintain the stability of dimensional boundaries and prevent incursions from the Void Between.',
      ideology:
        'Balance above all — neither light nor dark, but the boundary that separates them. Sacrifice of the few for the many is an accepted doctrine.',
      leader: 'Grand Warden Selithe (missing, presumed lost in the Void)',
      rivals: 'The Unmakers, The Rift Cult',
      hq: 'The Obsidian Spire (current), formerly Ashenmire Citadel',
      resources:
        'Void-forged weapons, dimensional anchors, a network of hidden waypoints across realities',
    },
  },
  {
    name: 'The Fall of Ashenmire',
    description:
      "The catastrophic event that destroyed the Voidborn Conclave's primary stronghold and killed thousands. A dimensional rift tore the city apart from within.",
    kind: 'event',
    metadata: {
      era: 'Year of the Shattered Veil (roughly 200 years ago)',
      participants: 'Voidborn Conclave, The Unmakers, civilian population of Ashenmire',
      location: 'Ashenmire, a fortress-city on the border of the Material and Void planes',
      causes:
        "The Unmakers detonated a Rift Seed — a compressed knot of dimensional instability — inside the city's core anchor.",
      outcome:
        'Ashenmire was erased from all planes. 12,000 lives lost. The Conclave was shattered. Kael Duskbane was the only knight to survive.',
      canonStatus: 'Canon',
    },
  },
  {
    name: 'The Laws of Dimensional Binding',
    description:
      'The fundamental magical principles that govern how realities connect, overlap, and separate. Understanding these laws is essential for any dimensional traveler.',
    kind: 'lore',
    metadata: {
      loreType: 'Magic System',
      article:
        'All realities exist as layers in the Infinite Stack. Each layer vibrates at a unique frequency. Dimensional travel requires matching the frequency of the target reality — a process called Attunement. Forced entry without Attunement causes Rift Bleed, where elements of both realities merge unpredictably. The Voidborn Conclave discovered that certain materials (void crystals, dimensional amber) naturally resonate at multiple frequencies, enabling stable portals. The Three Laws: (1) No reality can be created or destroyed, only transformed. (2) Every crossing leaves a scar — repeated travel weakens the boundary. (3) The Void Between is not empty — it hungers.',
      relatedConcepts:
        'Void Crystals, Attunement, Rift Bleed, Dimensional Anchors, The Infinite Stack',
      canonWeight: 'Hard Canon',
    },
  },
  {
    name: 'Voidborn',
    description:
      'A species of entities native to the space between dimensions — the Void Between. Neither fully alive nor dead, they exist as patterns of anti-reality.',
    kind: 'species',
    metadata: {
      biologicalType: 'Energy Being / Anti-matter construct',
      traits:
        'Translucent forms that shift between solid and gaseous states. Eyes are pinpoints of collapsed starlight. They communicate through dimensional vibrations felt as pressure changes. Feed on dimensional energy.',
      homeworld: 'The Void Between (the space between all realities)',
      culture:
        'Hive-minded at the basic level, but elder Voidborn develop individual consciousness. They view reality as an infection in their native space.',
      abilities:
        'Phase through solid matter, corrupt dimensional anchors, induce madness in beings attuned to multiple dimensions. Immune to conventional weapons.',
    },
  },
  {
    name: 'The Riftwalker',
    description:
      'A massive bio-mechanical vessel designed to travel through the Void Between. One of only three ever constructed, and the only one still operational.',
    kind: 'vehicle',
    metadata: {
      vehicleType: 'Dimensional Vessel / Living Ship',
      crew: 'Minimum 3 Attuned navigators, maximum capacity 200. Captain: currently unmanned.',
      capabilities:
        'Dimensional transit (can cross between any two realities in hours), void shields, reality anchor deployment, self-repair via bio-mechanical regeneration',
      origin:
        'Built by the Voidborn Conclave using a fusion of void crystal technology and living dimensional coral. Construction took 40 years.',
      currentStatus:
        'Dormant in the lower levels of the Obsidian Spire. Awaiting a crew with sufficient Attunement to reactivate.',
    },
  },
  {
    name: 'Void Crystal Resonance Arrays',
    description:
      'Technology that allows stable dimensional portals to be created and maintained. The backbone of inter-reality travel and communication.',
    kind: 'technology',
    metadata: {
      techType: 'Dimensional Engineering / Portal Technology',
      inventor:
        'The First Archivists of the Voidborn Conclave, building on naturally occurring void crystal formations',
      howItWorks:
        "Void crystals naturally vibrate at multiple dimensional frequencies. By arranging them in specific geometric patterns (arrays), their resonance can be focused to match a target reality's frequency, creating a stable portal. Larger arrays = more stable portals.",
      limitations:
        'Requires rare void crystals (finite supply). Arrays degrade over time and must be recalibrated. Cannot create portals to the Void Between safely. Overuse in one area causes Rift Bleed.',
      users: 'The Archivist Order, surviving Conclave members, black-market rift runners',
    },
  },
  {
    name: 'The Archivist Order',
    description:
      'A scholarly organization dedicated to cataloging and preserving knowledge across all known realities. Politically neutral by charter, they maintain the Obsidian Spire as a repository.',
    kind: 'organization',
    metadata: {
      orgType: 'Academic / Knowledge Preservation',
      purpose:
        'Collect, preserve, and protect knowledge from all realities. Maintain neutrality in inter-factional conflicts. Operate the Obsidian Spire as a safe haven.',
      structure:
        'Led by the Council of Scribes (7 senior archivists elected by peers). Below them: Senior Archivists, Archivists, Scribes, Initiates. No military hierarchy — all ranks are academic.',
      members:
        'Head Scribe Calenth, Archivist Yenara (specialist in extinct realities), Scribe Pellox (youngest initiate, prodigy)',
      influence:
        'Moderate — respected by all factions for their neutrality, but lack military power. Their true influence comes from controlling access to forbidden knowledge.',
    },
  },
];

// Structural entities form a hierarchy: timeline → reality → dimension → plane → realm → domain
const STRUCTURAL_ENTITIES: TestEntity[] = [
  {
    name: 'The Age of Sundering',
    description:
      'The primary timeline of the Voidborn Saga, spanning from the creation of the first dimensional boundaries to the present era of fractured realities.',
    kind: 'timeline',
    metadata: {
      era: 'Epoch Zero to Present',
      scope:
        'The full history of dimensional civilization — from the First Architects who separated the planes to the current age of decay and rift bleed.',
      branchingPoint:
        'Origin timeline — all alternate realities branch from events within this timeline.',
      keyEvents:
        'The Separation (creation of dimensional boundaries), The First Incursion (first Voidborn invasion), The Founding of the Conclave, The Fall of Ashenmire, The Rift of Unmaking (ongoing)',
    },
    universeAddress: UNIVERSE_ADDR,
    parentId: null,
  },
  {
    name: 'Prime Material',
    description:
      'The baseline reality from which all others diverge. Home to most mortal civilizations and the primary staging ground for dimensional conflicts.',
    kind: 'reality',
    metadata: {
      designation: 'Reality-Prime / RM-001',
      divergence:
        'Origin reality — no divergence point. All alternate realities are measured against Prime Material as the baseline.',
      physicalLaws:
        'Standard physics apply. Magic functions through dimensional resonance (manipulating frequencies of overlapping planes). Void energy is toxic to organic life.',
      accessibility:
        'Default reality — all dimensional travelers originate here or pass through it. Major portal hubs in the Obsidian Spire and the ruins of Ashenmire.',
    },
    universeAddress: UNIVERSE_ADDR,
    // parentId will be set to timeline ID after creation
  },
  {
    name: 'The Shattered Veil',
    description:
      'A dimension of fractured space where the boundaries between realities are thin and unstable. The primary frontier for dimensional exploration and the source of most rift incursions.',
    kind: 'dimension',
    metadata: {
      dimensionType: 'Fractured Space / Border Dimension',
      properties:
        'Space is non-Euclidean — distances shift based on dimensional frequency. Gravity varies wildly. Pockets of other realities bleed through as "reality bubbles." Time flows at different rates in different zones.',
      inhabitants:
        'Rift runners (dimensional smugglers), Lost Ones (beings displaced from destroyed realities), Voidborn scouts',
      entryPoints:
        'Any area with heavy rift bleed. Stable portals exist in the Obsidian Spire and three hidden waypoints maintained by the Conclave.',
    },
    universeAddress: UNIVERSE_ADDR,
  },
  {
    name: 'The Void Between',
    description:
      'The anti-plane that exists in the gaps between all realities. Home to the Voidborn. Not a place so much as an absence of place — the entropy between ordered realities.',
    kind: 'plane',
    metadata: {
      planeType: 'Anti-Plane / Negative Space',
      environment:
        'Absolute darkness punctuated by the distant glow of reality boundaries. No ground, no sky — only drifting fragments of consumed realities. Sound does not travel. Visitors experience their memories being slowly consumed.',
      rulers:
        'The Elder Voidborn — ancient entities that may be fragments of a single consciousness. No hierarchy as mortals understand it.',
      effects:
        'Progressive memory loss, dimensional sickness (nausea, disorientation), physical dissolution over extended exposure. Attuned individuals can resist for hours; unprotected mortals last minutes.',
    },
    universeAddress: UNIVERSE_ADDR,
  },
  {
    name: 'The Ashlands',
    description:
      'A realm of scorched earth and crystallized void energy — the scar left by the Fall of Ashenmire. Now a lawless frontier where fortune-seekers mine void crystals from the ruins.',
    kind: 'realm',
    metadata: {
      realmType: 'Ruined Territory / Mining Frontier',
      ruler:
        'No formal ruler — contested between scavenger gangs, the Archivist Order (who claim historical jurisdiction), and the Rift Cult (who worship the destruction as divine)',
      geography:
        'Crater landscape of black glass and crystallized void energy. The ruins of Ashenmire Citadel at the center, still crackling with dimensional instability. Void crystal formations grow from the ground like alien trees.',
      culture:
        'Lawless frontier culture. Miners, scavengers, and fugitives operate under unwritten codes. The strongest claim controls territory. Trading posts dot the crater rim.',
      resources:
        'Void crystals (the primary source of dimensional technology), dimensional amber, salvaged Conclave artifacts',
    },
    universeAddress: UNIVERSE_ADDR,
  },
  {
    name: 'The Rift Market',
    description:
      'A semi-permanent bazaar built on the rim of the Ashenmire Crater. The only place in the Ashlands with any semblance of order — enforced by the Market Wardens.',
    kind: 'domain',
    metadata: {
      domainType: 'Trading Post / Black Market',
      controller:
        'The Market Wardens — a mercenary guild paid by the major trading houses to maintain order. Led by Warden-Captain Drel.',
      purpose:
        'Commerce hub for void crystals, salvaged artifacts, dimensional contraband, and information. Also serves as a neutral meeting ground for faction negotiations.',
      boundaries:
        'Extends along a 2-kilometer stretch of the crater rim. Marked by Warden pylons — automated sentinels that enforce the no-weapons zone.',
      notableFeatures:
        'The Crystal Exchange (largest void crystal trading floor), The Whisper Hall (information broker den), The Anchor Inn (tavern built around a dormant dimensional anchor)',
    },
    universeAddress: UNIVERSE_ADDR,
    // parentId will be set to realm ID after creation
  },
];

async function main() {
  console.log('═'.repeat(60));
  console.log('  Test: Create All Entity Kinds — Voidborn Saga');
  console.log('═'.repeat(60));

  // Authenticate
  console.log('\n[AUTH] Authenticating...');
  const token = await getAuthToken();
  console.log(`[AUTH] Authenticated as ${account.address}`);

  const createdIds: Record<string, string> = {};

  // ── Create all 10 creator kinds ─────────────────────────────────────
  console.log('\n── Creator Kinds (10) ────────────────────────────────');
  for (const entity of CREATOR_ENTITIES) {
    try {
      const result = await tRPCMutate<{ success: boolean; id: string }>(
        'entities.create',
        {
          name: entity.name,
          description: entity.description,
          kind: entity.kind,
          metadata: entity.metadata,
          universeAddress: UNIVERSE_ADDR,
          monetized: false,
          rightsDeclaration: null,
        },
        token
      );
      createdIds[entity.kind] = result.id;
      log(entity.kind, `✓ Created "${entity.name}" → ${result.id}`);
    } catch (err: any) {
      log(entity.kind, `✗ FAILED "${entity.name}" → ${err.message}`);
    }
  }

  // ── Create structural kinds in hierarchy order ──────────────────────
  console.log('\n── Structural Kinds (6) ──────────────────────────────');

  // 1. Timeline (root — no parent)
  const timelineEntity = STRUCTURAL_ENTITIES[0];
  try {
    const result = await tRPCMutate<{ success: boolean; id: string }>(
      'entities.create',
      {
        name: timelineEntity.name,
        description: timelineEntity.description,
        kind: timelineEntity.kind,
        metadata: timelineEntity.metadata,
        universeAddress: UNIVERSE_ADDR,
        parentId: null,
        monetized: false,
        rightsDeclaration: null,
      },
      token
    );
    createdIds['timeline'] = result.id;
    log('timeline', `✓ Created "${timelineEntity.name}" → ${result.id}`);
  } catch (err: any) {
    log('timeline', `✗ FAILED "${timelineEntity.name}" → ${err.message}`);
  }

  // 2. Reality (parent: timeline)
  const realityEntity = STRUCTURAL_ENTITIES[1];
  try {
    const result = await tRPCMutate<{ success: boolean; id: string }>(
      'entities.create',
      {
        name: realityEntity.name,
        description: realityEntity.description,
        kind: realityEntity.kind,
        metadata: realityEntity.metadata,
        universeAddress: UNIVERSE_ADDR,
        parentId: createdIds['timeline'] ?? null,
        monetized: false,
        rightsDeclaration: null,
      },
      token
    );
    createdIds['reality'] = result.id;
    log('reality', `✓ Created "${realityEntity.name}" → ${result.id}`);
  } catch (err: any) {
    log('reality', `✗ FAILED "${realityEntity.name}" → ${err.message}`);
  }

  // 3. Dimension (parent: timeline or reality)
  const dimensionEntity = STRUCTURAL_ENTITIES[2];
  try {
    const result = await tRPCMutate<{ success: boolean; id: string }>(
      'entities.create',
      {
        name: dimensionEntity.name,
        description: dimensionEntity.description,
        kind: dimensionEntity.kind,
        metadata: dimensionEntity.metadata,
        universeAddress: UNIVERSE_ADDR,
        parentId: createdIds['reality'] ?? createdIds['timeline'] ?? null,
        monetized: false,
        rightsDeclaration: null,
      },
      token
    );
    createdIds['dimension'] = result.id;
    log('dimension', `✓ Created "${dimensionEntity.name}" → ${result.id}`);
  } catch (err: any) {
    log('dimension', `✗ FAILED "${dimensionEntity.name}" → ${err.message}`);
  }

  // 4. Plane (parent: dimension or reality)
  const planeEntity = STRUCTURAL_ENTITIES[3];
  try {
    const result = await tRPCMutate<{ success: boolean; id: string }>(
      'entities.create',
      {
        name: planeEntity.name,
        description: planeEntity.description,
        kind: planeEntity.kind,
        metadata: planeEntity.metadata,
        universeAddress: UNIVERSE_ADDR,
        parentId: createdIds['dimension'] ?? createdIds['reality'] ?? null,
        monetized: false,
        rightsDeclaration: null,
      },
      token
    );
    createdIds['plane'] = result.id;
    log('plane', `✓ Created "${planeEntity.name}" → ${result.id}`);
  } catch (err: any) {
    log('plane', `✗ FAILED "${planeEntity.name}" → ${err.message}`);
  }

  // 5. Realm (parent: can be null, timeline, reality, or dimension)
  const realmEntity = STRUCTURAL_ENTITIES[4];
  try {
    const result = await tRPCMutate<{ success: boolean; id: string }>(
      'entities.create',
      {
        name: realmEntity.name,
        description: realmEntity.description,
        kind: realmEntity.kind,
        metadata: realmEntity.metadata,
        universeAddress: UNIVERSE_ADDR,
        parentId: createdIds['dimension'] ?? null,
        monetized: false,
        rightsDeclaration: null,
      },
      token
    );
    createdIds['realm'] = result.id;
    log('realm', `✓ Created "${realmEntity.name}" → ${result.id}`);
  } catch (err: any) {
    log('realm', `✗ FAILED "${realmEntity.name}" → ${err.message}`);
  }

  // 6. Domain (parent: must be realm)
  const domainEntity = STRUCTURAL_ENTITIES[5];
  try {
    const result = await tRPCMutate<{ success: boolean; id: string }>(
      'entities.create',
      {
        name: domainEntity.name,
        description: domainEntity.description,
        kind: domainEntity.kind,
        metadata: domainEntity.metadata,
        universeAddress: UNIVERSE_ADDR,
        parentId: createdIds['realm'] ?? null,
        monetized: false,
        rightsDeclaration: null,
      },
      token
    );
    createdIds['domain'] = result.id;
    log('domain', `✓ Created "${domainEntity.name}" → ${result.id}`);
  } catch (err: any) {
    log('domain', `✗ FAILED "${domainEntity.name}" → ${err.message}`);
  }

  // ── Summary ─────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(60));
  const total = Object.keys(createdIds).length;
  console.log(`  Result: ${total}/16 entities created successfully`);
  if (total < 16) {
    const allKinds = [
      ...CREATOR_ENTITIES.map((e) => e.kind),
      ...STRUCTURAL_ENTITIES.map((e) => e.kind),
    ];
    const failed = allKinds.filter((k) => !createdIds[k]);
    console.log(`  Failed: ${failed.join(', ')}`);
  }
  console.log('\n  Created entity IDs:');
  for (const [kind, id] of Object.entries(createdIds)) {
    console.log(`    ${kind.padEnd(14)} → ${id}`);
  }
  console.log('\n  View in wiki: http://localhost:3001/wiki');
  console.log(`  View universe: http://localhost:3001/wiki?universe=${UNIVERSE_ADDR}`);
  console.log('═'.repeat(60));
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
