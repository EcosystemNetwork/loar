/**
 * Deploy FALLOUT: FOGLINE on-chain.
 *
 * Steps:
 *   1. Call UniverseManager.createUniverse() — deploys real Universe contract
 *   2. Migrate Firestore documents from fake address to real on-chain address
 *      - cinematicUniverses doc (re-keyed by real address)
 *      - all entities (universeAddress field updated)
 *      - all videoGenerations and content (universeId field updated)
 *      - universeCredits, privateSectionConfig, etc.
 *   3. For each existing video generation, call createNode() on the new contract
 *      so videos appear as real on-chain timeline nodes.
 *
 * Usage:
 *   pnpm tsx scripts/deploy-fogline-onchain.ts
 *
 * Required env:
 *   PRIVATE_KEY            — deployer wallet (must have Sepolia ETH)
 *   RPC_URL                — Sepolia RPC endpoint
 *   UNIVERSE_MANAGER       — UniverseManager contract address
 *   FIREBASE_SERVICE_ACCOUNT_PATH or FIREBASE_SERVICE_ACCOUNT
 */
import dotenv from 'dotenv';
import path from 'path';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  formatEther,
  keccak256,
  toBytes,
  decodeEventLog,
  type Address,
  type Hash,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { universeManagerAbi, universeAbi } from '../packages/abis/src/generated';
import { rehostVideoToPinata, isEphemeralVideoUrl } from './lib/rehost-video';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

// ── Config ──────────────────────────────────────────────────────────────
const RAW_PRIVATE_KEY = process.env.PRIVATE_KEY!;
const PRIVATE_KEY = (
  RAW_PRIVATE_KEY.startsWith('0x') ? RAW_PRIVATE_KEY : `0x${RAW_PRIVATE_KEY}`
) as `0x${string}`;
const RPC_URL = process.env.RPC_URL!;
const UNIVERSE_MANAGER = process.env.UNIVERSE_MANAGER as Address;
const OLD_FAKE_ADDRESS = '0x0000000000000000000000000000019d9e26795c';

if (!RAW_PRIVATE_KEY) throw new Error('PRIVATE_KEY required');
if (!RPC_URL) throw new Error('RPC_URL required');
if (!UNIVERSE_MANAGER) throw new Error('UNIVERSE_MANAGER required');

// ── Firebase Init ───────────────────────────────────────────────────────
const saPathEnv = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
const saPath = path.resolve(process.cwd(), saPathEnv ?? 'firebase-sa-key-20260416.json');
const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
  ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
  : JSON.parse(readFileSync(saPath, 'utf-8'));
const app = initializeApp({ credential: cert(serviceAccount) }, `fogline-deploy-${Date.now()}`);
const db = getFirestore(app);
db.settings({ preferRest: true });

// ── Viem Clients ────────────────────────────────────────────────────────
const account = privateKeyToAccount(PRIVATE_KEY);
const publicClient = createPublicClient({ chain: sepolia, transport: http(RPC_URL) });
const walletClient = createWalletClient({ account, chain: sepolia, transport: http(RPC_URL) });

// ── Helpers ─────────────────────────────────────────────────────────────

async function ensureBalance(): Promise<bigint> {
  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`  Deployer  : ${account.address}`);
  console.log(`  Balance   : ${formatEther(balance)} ETH`);
  if (balance < parseEther('0.1')) {
    throw new Error(`Insufficient balance — need at least 0.1 ETH on Sepolia`);
  }
  return balance;
}

async function getMintFee(): Promise<bigint> {
  const fee = (await publicClient.readContract({
    address: UNIVERSE_MANAGER,
    abi: universeManagerAbi,
    functionName: 'mintFee',
  })) as bigint;
  console.log(`  Mint Fee  : ${formatEther(fee)} ETH`);
  return fee;
}

async function fetchOldUniverseDoc() {
  const doc = await db.collection('cinematicUniverses').doc(OLD_FAKE_ADDRESS).get();
  if (!doc.exists) throw new Error(`Old universe doc not found at ${OLD_FAKE_ADDRESS}`);
  return doc.data()!;
}

// ── Step 1: Deploy on-chain ─────────────────────────────────────────────

async function deployUniverseOnChain(name: string, imageURL: string, description: string) {
  console.log(`\nStep 1: Deploying Universe contract...`);

  const mintFee = await getMintFee();

  // NodeCreationOptions: 0=OPEN, 1=WHITELISTED
  // NodeVisibilityOptions: 0=PUBLIC, 1=HOLDERS
  const nodeCreationOption = 0; // OPEN — anyone can create nodes
  const nodeVisibilityOption = 0; // PUBLIC

  console.log(`  Calling UniverseManager.createUniverse()...`);
  console.log(`  - Name: "${name}"`);
  console.log(`  - Description: ${description.length} chars`);
  console.log(`  - imageURL: ${imageURL.slice(0, 80)}...`);
  console.log(`  - Initial owner: ${account.address}`);

  const txHash = await walletClient.writeContract({
    address: UNIVERSE_MANAGER,
    abi: universeManagerAbi,
    functionName: 'createUniverse',
    args: [name, imageURL, description, nodeCreationOption, nodeVisibilityOption, account.address],
    value: mintFee,
  });

  console.log(`  Tx submitted: ${txHash}`);
  console.log(`  Waiting for confirmation...`);

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  console.log(`  Confirmed in block ${receipt.blockNumber}`);

  // Parse the UniverseCreated event to get universeId + universeAddress
  const universeCreatedEvent = receipt.logs.find((log) => {
    try {
      // UniverseCreated event topic
      // event UniverseCreated(uint256 indexed universeId, address universeAddress, address creator, ...)
      return log.address.toLowerCase() === UNIVERSE_MANAGER.toLowerCase();
    } catch {
      return false;
    }
  });

  if (!universeCreatedEvent) {
    throw new Error('UniverseCreated event not found in receipt');
  }

  let universeId: bigint = 0n;
  let universeAddress: Address = '0x0' as Address;

  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: universeManagerAbi,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName === 'UniverseCreatedWithToken') {
        // (uint256 universeId, address universe, address token, address governor)
        const args = decoded.args as any;
        universeId = args.universeId;
        universeAddress = args.universe as Address;
        break;
      } else if (decoded.eventName === 'UniverseCreated' && !universeAddress) {
        // (address universe, address creator) — no universeId
        const args = decoded.args as any;
        universeAddress = args.universe as Address;
      }
    } catch {
      continue;
    }
  }

  if (!universeAddress || universeAddress === '0x0') {
    throw new Error('Could not extract universeAddress from event');
  }

  console.log(`\n  ✅ Universe deployed!`);
  console.log(`     ID:      ${universeId}`);
  console.log(`     Address: ${universeAddress}`);
  console.log(`     Tx:      ${txHash}`);
  console.log(`     Explorer: https://sepolia.etherscan.io/tx/${txHash}`);

  return { universeId, universeAddress: universeAddress.toLowerCase() as Address, txHash };
}

// ── Step 2: Migrate Firestore data ──────────────────────────────────────

async function migrateFirestoreData(newAddress: string, universeId: bigint) {
  console.log(`\nStep 2: Migrating Firestore from ${OLD_FAKE_ADDRESS} → ${newAddress}`);

  // 2a. Move cinematicUniverses doc
  const oldUniverse = await fetchOldUniverseDoc();
  const updatedUniverse = {
    ...oldUniverse,
    address: newAddress,
    onChainUniverseId: universeId.toString(),
    creator: account.address.toLowerCase(),
    chainId: 11155111,
    updated_at: new Date(),
  };

  await db.collection('cinematicUniverses').doc(newAddress).set(updatedUniverse);
  await db.collection('cinematicUniverses').doc(OLD_FAKE_ADDRESS).delete();
  console.log(`  ✅ cinematicUniverses doc re-keyed`);

  // 2b. Update all entities
  const entitiesSnap = await db
    .collection('entities')
    .where('universeAddress', '==', OLD_FAKE_ADDRESS)
    .get();

  console.log(`  Updating ${entitiesSnap.size} entities...`);
  const batch1 = db.batch();
  let count = 0;
  for (const doc of entitiesSnap.docs) {
    batch1.update(doc.ref, { universeAddress: newAddress, updatedAt: new Date() });
    count++;
    if (count % 400 === 0) {
      await batch1.commit();
    }
  }
  if (count % 400 !== 0) await batch1.commit();
  console.log(`  ✅ ${count} entities updated`);

  // 2c. Update videoGenerations
  const vidsSnap = await db
    .collection('videoGenerations')
    .where('universeId', '==', OLD_FAKE_ADDRESS)
    .get();
  console.log(`  Updating ${vidsSnap.size} video generations...`);
  const batch2 = db.batch();
  for (const doc of vidsSnap.docs) {
    batch2.update(doc.ref, { universeId: newAddress });
  }
  if (vidsSnap.size > 0) await batch2.commit();
  console.log(`  ✅ ${vidsSnap.size} videoGenerations updated`);

  // 2d. Update content/gallery
  const contentSnap = await db
    .collection('content')
    .where('universeId', '==', OLD_FAKE_ADDRESS)
    .get();
  console.log(`  Updating ${contentSnap.size} content items...`);
  const batch3 = db.batch();
  for (const doc of contentSnap.docs) {
    batch3.update(doc.ref, { universeId: newAddress, updatedAt: new Date() });
  }
  if (contentSnap.size > 0) await batch3.commit();
  console.log(`  ✅ ${contentSnap.size} content items updated`);

  // 2e. Update universeCredits
  const creditsDoc = await db.collection('universeCredits').doc(OLD_FAKE_ADDRESS).get();
  if (creditsDoc.exists) {
    const data = creditsDoc.data()!;
    await db
      .collection('universeCredits')
      .doc(newAddress)
      .set({ ...data, universeId: newAddress });
    await db.collection('universeCredits').doc(OLD_FAKE_ADDRESS).delete();
    console.log(`  ✅ universeCredits re-keyed`);
  }

  // 2f. Update privateSectionConfig
  const psDoc = await db.collection('privateSectionConfig').doc(OLD_FAKE_ADDRESS).get();
  if (psDoc.exists) {
    const data = psDoc.data()!;
    await db
      .collection('privateSectionConfig')
      .doc(newAddress)
      .set({ ...data, universeId: newAddress });
    await db.collection('privateSectionConfig').doc(OLD_FAKE_ADDRESS).delete();
    console.log(`  ✅ privateSectionConfig re-keyed`);
  }

  // 2g. Update episodes
  const episodesSnap = await db
    .collection('episodes')
    .where('universeId', '==', OLD_FAKE_ADDRESS)
    .get();
  if (episodesSnap.size > 0) {
    const batch4 = db.batch();
    for (const doc of episodesSnap.docs) {
      batch4.update(doc.ref, { universeId: newAddress, updatedAt: new Date() });
    }
    await batch4.commit();
    console.log(`  ✅ ${episodesSnap.size} episodes updated`);
  }

  return vidsSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as any[];
}

// ── Step 3: Create on-chain nodes for existing videos ───────────────────

async function createNodesForVideos(universeAddress: Address, existingVideos: any[]) {
  console.log(`\nStep 3: Creating on-chain nodes for ${existingVideos.length} existing videos...`);

  // Sort by sceneId so they're created in order
  const sorted = existingVideos
    .filter((v) => v.sceneId && v.videoUrl)
    .sort((a, b) => (a.sceneId || 0) - (b.sceneId || 0));

  let previousNodeId = 0n;
  const createdNodes: Array<{ sceneId: number; nodeId: bigint; txHash: Hash }> = [];

  for (const video of sorted) {
    // Rehost ephemeral generator URLs (ByteDance/FAL presigned → expire in ~24h)
    // to Pinata IPFS so the on-chain `link` remains valid forever.
    let linkUrl: string = video.permanentVideoUrl || video.videoUrl;
    if (!video.permanentVideoUrl && isEphemeralVideoUrl(video.videoUrl)) {
      try {
        console.log(`    Rehosting ephemeral URL to Pinata...`);
        const pin = await rehostVideoToPinata(video.videoUrl, {
          filename: `fogline-s${video.sceneId}.mp4`,
          pinName: `fogline/scene-${video.sceneId}`,
        });
        linkUrl = pin.url;
        await db.collection('videoGenerations').doc(video.id).update({
          permanentVideoUrl: pin.url,
          storageContentHash: pin.contentHash,
          storagePersisted: true,
        });
      } catch (err: any) {
        console.error(`    ❌ Rehost failed: ${err.message?.slice(0, 120)} — skipping`);
        continue;
      }
    }

    const contentHash = keccak256(toBytes(linkUrl));
    const plotText = video.fullPrompt || video.prompt || video.sceneTitle || 'Scene';
    const plotHash = keccak256(toBytes(plotText));

    console.log(`\n  Scene ${video.sceneId}: ${video.sceneTitle || 'Untitled'}`);
    console.log(`    Calling createNode (previous=${previousNodeId})...`);

    try {
      const txHash = await walletClient.writeContract({
        address: universeAddress,
        abi: universeAbi,
        functionName: 'createNode',
        args: [contentHash, plotHash, previousNodeId, linkUrl, plotText],
      });

      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

      // Extract new node ID from NodeCreated event
      let newNodeId = 0n;
      for (const log of receipt.logs) {
        try {
          const decoded = decodeEventLog({
            abi: universeAbi,
            data: log.data,
            topics: log.topics,
          });
          if (decoded.eventName === 'NodeCreated') {
            const args = decoded.args as any;
            newNodeId = args.nodeId ?? args[0];
            break;
          }
        } catch {
          continue;
        }
      }

      previousNodeId = newNodeId;
      createdNodes.push({ sceneId: video.sceneId, nodeId: newNodeId, txHash });
      console.log(`    ✅ Node ${newNodeId} created — tx: ${txHash.slice(0, 20)}...`);

      // Update Firestore videoGeneration with on-chain node ID
      await db.collection('videoGenerations').doc(video.id).update({
        onChainNodeId: newNodeId.toString(),
        onChainTxHash: txHash,
        previousNodeId: previousNodeId.toString(),
      });

      // Cool down to avoid rate limits
      await new Promise((r) => setTimeout(r, 2000));
    } catch (err: any) {
      console.error(`    ❌ Failed: ${err.message}`);
    }
  }

  return createdNodes;
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  console.log(`
════════════════════════════════════════════════════════════
  FALLOUT: FOGLINE — On-Chain Deployment
════════════════════════════════════════════════════════════
  Chain    : Sepolia (11155111)
  Manager  : ${UNIVERSE_MANAGER}
  Old fake : ${OLD_FAKE_ADDRESS}
`);

  await ensureBalance();

  // Fetch the existing off-chain universe data
  const oldUniverse = await fetchOldUniverseDoc();
  console.log(`\n  Loaded off-chain universe: "${oldUniverse.name}"`);

  // Step 1: Deploy on-chain
  const { universeId, universeAddress, txHash } = await deployUniverseOnChain(
    oldUniverse.name,
    oldUniverse.image_url || '',
    oldUniverse.description || ''
  );

  // Step 2: Migrate Firestore
  const existingVideos = await migrateFirestoreData(universeAddress, universeId);

  // Step 3: Create on-chain nodes for existing videos
  const createdNodes = await createNodesForVideos(universeAddress as Address, existingVideos);

  console.log(`
════════════════════════════════════════════════════════════
  DEPLOYMENT COMPLETE
════════════════════════════════════════════════════════════
  Universe ID  : ${universeId}
  Address      : ${universeAddress}
  Creation Tx  : ${txHash}
  Nodes Created: ${createdNodes.length} / ${existingVideos.length}

  View at: /universe/${universeAddress}
  Etherscan: https://sepolia.etherscan.io/address/${universeAddress}

  IMPORTANT: Update generate-fogline-episode.ts UNIVERSE_ID:
    OLD: ${OLD_FAKE_ADDRESS}
    NEW: ${universeAddress}
════════════════════════════════════════════════════════════
`);
}

main().catch((err) => {
  console.error('\n❌ Fatal:', err);
  process.exit(1);
});
