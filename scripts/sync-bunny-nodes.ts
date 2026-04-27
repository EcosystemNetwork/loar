/**
 * Sync all on-chain Vacation Bunny nodes into Firestore.
 *
 * Why: the Universe at 0x8e5cDdb763534Fe426766e4eB035449fB9e73913 has 58
 * `NodeCreated` events on Sepolia, but only 1 `offChainNodes` doc + 1 episode
 * clip in Firestore. Players read offChainNodes / episode.clips, so the videos
 * appear missing in the UI.
 *
 * What it does:
 *   1. Reads every NodeCreated event from chain.
 *   2. For each node, resolves the effective videoUrl in this priority:
 *        a) `nodeMediaOverrides/<universe>:<nodeId>` (admin patch, e.g. for
 *           expired Seedance URLs).
 *        b) The on-chain `link` field — but only if it's permanent (Pinata).
 *        c) Skip with warning if neither exists.
 *   3. Upserts `offChainNodes/<universe>:<nodeId>` with full metadata.
 *   4. Upserts the pilot episode's `clips` array + `clipCount`.
 *
 * Usage:
 *   pnpm tsx scripts/sync-bunny-nodes.ts            # dry run
 *   pnpm tsx scripts/sync-bunny-nodes.ts --apply    # write
 */
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import { createPublicClient, http, parseAbiItem } from 'viem';
import { sepolia } from 'viem/chains';

const APPLY = process.argv.includes('--apply');
const UNIVERSE_ADDR = '0x8e5cDdb763534Fe426766e4eB035449fB9e73913' as `0x${string}`;
const UNIVERSE_LC = UNIVERSE_ADDR.toLowerCase();
const EPISODE_ID = 'ffc72478-9a0a-4c7c-9e35-41e433565f78';
const RPC_URL = process.env.RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com';

const PERMANENT_HOSTS = ['mypinata.cloud', 'gateway.pinata.cloud', 'storage.googleapis.com'];
function isPermanent(url: string): boolean {
  if (!url) return false;
  try {
    const h = new URL(url).host.toLowerCase();
    return PERMANENT_HOSTS.some((p) => h.includes(p));
  } catch {
    return false;
  }
}

// Optional: scene title lookup (S01..S58) so clips look nice in the player.
function loadSceneTitles(): Record<number, string> {
  // Pulled from scripts/vacation-bunny-episode.ts SCENES array.
  return {
    1: 'Morning Light Floods the Apartment',
    2: 'Baby Bunny Asleep — Pendant on Chest',
    3: 'Judy Asleep — White Pendant on Table',
    4: 'They Wake Up — Shared Smile',
    5: 'Outfit Montage — Yellow Tutu & Navy Silky Dress',
    6: 'Mirror Moment — Color Contrast',
    7: 'Sparkle Makeup — Judy Applies to Herself',
    8: 'Sparkle Makeup — Judy Applies to Baby',
    9: 'Spinning in Front of the Mirror',
    10: 'Final Mirror Pose — Pendants Catch Light',
    11: 'Walking to the Bakery',
    12: 'Café Latte Pour — Slow Motion',
    13: 'Pastry Selection — Wide Eyes',
    14: 'Sharing the Croissant',
    15: 'Milk Mustache Moment',
    16: 'Pendant Beat — Bakery',
    17: 'Beach Restaurant Establishing',
    18: 'Lunch by the Sea',
    19: 'Tiny Cocktail Cheers',
    20: 'The Seagull Heist',
    21: 'Baby Bunny on the Chair — Battle Cry',
    22: 'Chase Across the Beach',
    23: 'Triumphant Return',
    24: 'Climbing the Castle Hill',
    25: 'Castle Reveal',
    26: 'Spiral Staircase Climb',
    27: 'Tiny Steps on Stone',
    28: 'Princess Spin in the Tower',
    29: 'View From the Top',
    30: 'Mother-Daughter Tower Kiss',
    31: 'Pendants Side-by-Side Macro',
    32: 'Carousel at Night — Establishing',
    33: 'Running Toward the Carousel',
    34: 'Choosing the Black Horse',
    35: 'The Ride — Circular Motion',
    36: 'Judy Joins on the White Horse',
    37: 'Bubbles + Tutu Glow',
    38: 'Seagull Returns for the Frites',
    39: 'Gelato Display Case',
    40: 'Choosing Gelato — Matcha vs Chocolate',
    41: 'Chocolate on the Cheek',
    42: 'Gelato by the Ocean',
    43: 'Quiet Apartment — Moonlight',
    44: 'Baby Bunny Asleep — Day End',
    45: 'Judy Watches Her Sleep',
    46: 'Memory Montage',
    47: 'Pendants Resting Together',
    48: 'Title Card — Butterfly Days in Cannes',
    49: 'After-Credits — Older Baby Bunny at the Mirror',
    50: 'Sparkle Makeup — Solo',
    51: 'Soft Pose Together',
    52: 'Pendant Sway and Touch',
    53: 'Sunrise Beach Walk',
    54: 'Memory Montage Continues',
    55: 'Quiet Ocean Moment',
    56: 'Older Daughter at the Mirror',
    57: 'After-Credits Beat',
    58: 'Castle Establishing — Coda',
  };
}

const eventAbi = parseAbiItem(
  'event NodeCreated(uint256 indexed id, uint256 indexed previous, address indexed creator, bytes32 contentHash, bytes32 plotHash, string link, string plot)'
);

interface ChainNode {
  nodeId: number;
  previous: number;
  creator: string;
  contentHash: string;
  plotHash: string;
  link: string;
  plot: string;
  blockNumber: bigint;
}

async function readChainNodes(): Promise<ChainNode[]> {
  const client = createPublicClient({ chain: sepolia, transport: http(RPC_URL) });
  const head = await client.getBlockNumber();
  const STEP = 5000n;
  const nodes: ChainNode[] = [];
  for (let from = head - 200000n; from <= head; from += STEP) {
    const to = from + STEP - 1n > head ? head : from + STEP - 1n;
    const logs = await client.getLogs({
      address: UNIVERSE_ADDR,
      event: eventAbi,
      fromBlock: from,
      toBlock: to,
    });
    for (const l of logs) {
      const a = l.args as any;
      nodes.push({
        nodeId: Number(a.id),
        previous: Number(a.previous),
        creator: (a.creator as string).toLowerCase(),
        contentHash: a.contentHash,
        plotHash: a.plotHash,
        link: a.link,
        plot: a.plot,
        blockNumber: l.blockNumber!,
      });
    }
  }
  nodes.sort((a, b) => a.nodeId - b.nodeId);
  return nodes;
}

async function main() {
  console.log(APPLY ? '[APPLY] writes ON' : '[DRY-RUN] no writes (pass --apply)');
  console.log(`Universe: ${UNIVERSE_ADDR}`);

  const sa = JSON.parse(
    readFileSync(
      process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? 'firebase-sa-key-20260416.json',
      'utf-8'
    )
  );
  const app = getApps()[0] ?? initializeApp({ credential: cert(sa) });
  const db = getFirestore(app);
  db.settings({ preferRest: true });

  const titles = loadSceneTitles();

  console.log('\n[1/4] Reading on-chain NodeCreated events...');
  const chainNodes = await readChainNodes();
  console.log(`  Found ${chainNodes.length} nodes on-chain`);

  console.log('\n[2/4] Loading nodeMediaOverrides...');
  const ovSnap = await db
    .collection('nodeMediaOverrides')
    .where('universeAddress', '==', UNIVERSE_LC)
    .get();
  const overrides = new Map<number, string>();
  for (const d of ovSnap.docs) {
    const data = d.data() as any;
    if (typeof data.nodeId === 'number' && data.videoLink) {
      overrides.set(data.nodeId, data.videoLink);
    }
  }
  console.log(`  ${overrides.size} overrides loaded`);

  console.log('\n[3/4] Resolving and upserting offChainNodes...');
  const universeRef = db.collection('cinematicUniverses').doc(UNIVERSE_LC);
  const universeDoc = await universeRef.get();
  const universeCreator = (universeDoc.data() as any)?.creatorAddress?.toLowerCase() ?? null;

  type Resolved = { node: ChainNode; videoUrl: string; source: 'override' | 'event' };
  const resolved: Resolved[] = [];
  const skipped: Array<{ nodeId: number; reason: string }> = [];
  for (const n of chainNodes) {
    const ovUrl = overrides.get(n.nodeId);
    let videoUrl: string | null = null;
    let source: 'override' | 'event' | null = null;
    if (ovUrl && isPermanent(ovUrl)) {
      videoUrl = ovUrl;
      source = 'override';
    } else if (isPermanent(n.link)) {
      videoUrl = n.link;
      source = 'event';
    } else if (ovUrl) {
      videoUrl = ovUrl;
      source = 'override'; // fall back to override even if not "permanent"
    }
    if (!videoUrl || !source) {
      skipped.push({
        nodeId: n.nodeId,
        reason: `no permanent url (link=${n.link.slice(0, 50)}...)`,
      });
      continue;
    }
    resolved.push({ node: n, videoUrl, source });
  }
  console.log(
    `  ${resolved.length}/${chainNodes.length} resolved (${
      resolved.filter((r) => r.source === 'override').length
    } via override)`
  );
  if (skipped.length) {
    console.log(`  Skipped ${skipped.length}:`);
    for (const s of skipped.slice(0, 8)) console.log(`    #${s.nodeId} ${s.reason}`);
  }

  // Upsert offChainNodes
  let written = 0;
  let updated = 0;
  for (const r of resolved) {
    const docId = `${UNIVERSE_LC}:${r.node.nodeId}`;
    const ref = db.collection('offChainNodes').doc(docId);
    const existing = await ref.get();
    const title = titles[r.node.nodeId] ?? `Scene ${r.node.nodeId}`;
    const childIds = chainNodes.filter((c) => c.previous === r.node.nodeId).map((c) => c.nodeId);

    const data = {
      id: docId,
      universeId: UNIVERSE_LC,
      nodeId: r.node.nodeId,
      creator: r.node.creator,
      contentHash: r.node.contentHash,
      plotHash: r.node.plotHash,
      videoUrl: r.videoUrl,
      videoLink: r.videoUrl, // both keys — different readers expect different
      link: r.videoUrl,
      plot: r.node.plot,
      title,
      label: title,
      sceneId: r.node.nodeId,
      previousNodeId: r.node.previous,
      children: childIds,
      canon: true,
      mediaSource: r.source,
      blockNumber: Number(r.node.blockNumber),
      ...(universeCreator ? { sourceCreator: universeCreator } : {}),
      updatedAt: new Date(),
      ...(existing.exists ? {} : { createdAt: new Date() }),
    };

    if (APPLY) {
      await ref.set(data, { merge: true });
    }
    if (existing.exists) updated++;
    else written++;
  }
  console.log(`  ${APPLY ? 'wrote' : 'would write'}: ${written} new, ${updated} updated`);

  console.log('\n[4/4] Updating episode clips...');
  const episodeRef = db.collection('episodes').doc(EPISODE_ID);
  const episode = await episodeRef.get();
  if (!episode.exists) {
    console.log(`  WARN: episode ${EPISODE_ID} not found — skipping clip array update`);
  } else {
    const clips = resolved.map((r) => ({
      nodeId: String(r.node.nodeId),
      label: titles[r.node.nodeId] ?? `Scene ${r.node.nodeId}`,
      videoUrl: r.videoUrl,
    }));
    console.log(
      `  Episode "${(episode.data() as any).title}" — old clipCount=${
        (episode.data() as any).clipCount
      } → new=${clips.length}`
    );
    if (APPLY) {
      await episodeRef.update({
        clips,
        clipCount: clips.length,
        isCanon: true,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  }

  console.log('\n[DONE]');
  if (!APPLY) console.log('Re-run with --apply to persist the writes.');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('FAILED:', e);
    process.exit(1);
  });
