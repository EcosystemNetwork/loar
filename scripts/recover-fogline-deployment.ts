/**
 * Recover Fogline Universe address from the already-confirmed deployment tx,
 * then run migration + node creation.
 *
 * Tx hash: 0x46b199372631c9c894a705c9665bc3d0899a3a3d3da966873b48773f2cdbd8e6
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

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const RAW_PK = process.env.PRIVATE_KEY!;
const PRIVATE_KEY = (RAW_PK.startsWith('0x') ? RAW_PK : `0x${RAW_PK}`) as `0x${string}`;
const UNIVERSE_MANAGER = process.env.UNIVERSE_MANAGER as Address;
const OLD_FAKE_ADDRESS = '0x0000000000000000000000000000019d9e26795c';
const DEPLOY_TX = '0x46b199372631c9c894a705c9665bc3d0899a3a3d3da966873b48773f2cdbd8e6' as Hash;

const account = privateKeyToAccount(PRIVATE_KEY);
const publicClient = createPublicClient({ chain: sepolia, transport: http(process.env.RPC_URL) });
const walletClient = createWalletClient({
  account,
  chain: sepolia,
  transport: http(process.env.RPC_URL),
});

// ── Firebase ────────────────────────────────────────────────────────────
const saPath = path.resolve(
  process.cwd(),
  process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? 'firebase-sa-key-20260416.json'
);
const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
  ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
  : JSON.parse(readFileSync(saPath, 'utf-8'));
const app = initializeApp({ credential: cert(serviceAccount) }, `recover-${Date.now()}`);
const db = getFirestore(app);
db.settings({ preferRest: true });

async function main() {
  console.log(`\nRecovering Universe address from tx ${DEPLOY_TX.slice(0, 20)}...`);

  const receipt = await publicClient.getTransactionReceipt({ hash: DEPLOY_TX });
  console.log(`  Block: ${receipt.blockNumber}`);
  console.log(`  Logs:  ${receipt.logs.length}`);

  let universeId: bigint = 0n;
  let universeAddress: Address = '0x0' as Address;

  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: universeManagerAbi,
        data: log.data,
        topics: log.topics,
      });
      console.log(`  Event: ${decoded.eventName}`);
      if (
        decoded.eventName === 'UniverseCreated' ||
        decoded.eventName === 'UniverseCreatedWithToken'
      ) {
        const args = decoded.args as any;
        universeId = args.universeId ?? args[0];
        universeAddress = (args.universeAddress ?? args[1]) as Address;
        console.log(`    → universeId=${universeId}, universeAddress=${universeAddress}`);
      }
    } catch (err) {
      // Skip undecodeable logs
    }
  }

  if (!universeAddress || universeAddress === '0x0') {
    console.error('❌ Could not find UniverseCreated event in tx logs');
    process.exit(1);
  }

  const universeAddressLower = universeAddress.toLowerCase() as Address;
  console.log(`\n✅ Recovered: Universe ${universeId} at ${universeAddressLower}\n`);

  // ── Step 2: Migrate Firestore data ──────────────────────────────────
  console.log(`Step 2: Migrating Firestore from ${OLD_FAKE_ADDRESS} → ${universeAddressLower}`);

  const oldUniverseDoc = await db.collection('cinematicUniverses').doc(OLD_FAKE_ADDRESS).get();
  if (!oldUniverseDoc.exists) {
    console.log(`  Old universe doc not found — already migrated?`);
  } else {
    const oldData = oldUniverseDoc.data()!;
    await db
      .collection('cinematicUniverses')
      .doc(universeAddressLower)
      .set({
        ...oldData,
        address: universeAddressLower,
        onChainUniverseId: universeId.toString(),
        creator: account.address.toLowerCase(),
        chainId: 11155111,
        mintTxHash: DEPLOY_TX,
        updated_at: new Date(),
      });
    await db.collection('cinematicUniverses').doc(OLD_FAKE_ADDRESS).delete();
    console.log(`  ✅ cinematicUniverses doc re-keyed`);
  }

  // Entities
  const entitiesSnap = await db
    .collection('entities')
    .where('universeAddress', '==', OLD_FAKE_ADDRESS)
    .get();
  if (entitiesSnap.size > 0) {
    let batch = db.batch();
    let i = 0;
    for (const doc of entitiesSnap.docs) {
      batch.update(doc.ref, { universeAddress: universeAddressLower, updatedAt: new Date() });
      i++;
      if (i % 400 === 0) {
        await batch.commit();
        batch = db.batch();
      }
    }
    if (i % 400 !== 0) await batch.commit();
    console.log(`  ✅ ${entitiesSnap.size} entities updated`);
  }

  // videoGenerations
  const vidsSnap = await db
    .collection('videoGenerations')
    .where('universeId', '==', OLD_FAKE_ADDRESS)
    .get();
  if (vidsSnap.size > 0) {
    const batch = db.batch();
    for (const doc of vidsSnap.docs) {
      batch.update(doc.ref, { universeId: universeAddressLower });
    }
    await batch.commit();
    console.log(`  ✅ ${vidsSnap.size} videoGenerations updated`);
  }

  // Content / gallery
  const contentSnap = await db
    .collection('content')
    .where('universeId', '==', OLD_FAKE_ADDRESS)
    .get();
  if (contentSnap.size > 0) {
    const batch = db.batch();
    for (const doc of contentSnap.docs) {
      batch.update(doc.ref, { universeId: universeAddressLower, updatedAt: new Date() });
    }
    await batch.commit();
    console.log(`  ✅ ${contentSnap.size} content items updated`);
  }

  // Re-key universeCredits
  const creditsDoc = await db.collection('universeCredits').doc(OLD_FAKE_ADDRESS).get();
  if (creditsDoc.exists) {
    await db
      .collection('universeCredits')
      .doc(universeAddressLower)
      .set({ ...creditsDoc.data(), universeId: universeAddressLower });
    await db.collection('universeCredits').doc(OLD_FAKE_ADDRESS).delete();
    console.log(`  ✅ universeCredits re-keyed`);
  }

  // Re-key privateSectionConfig
  const psDoc = await db.collection('privateSectionConfig').doc(OLD_FAKE_ADDRESS).get();
  if (psDoc.exists) {
    await db
      .collection('privateSectionConfig')
      .doc(universeAddressLower)
      .set({ ...psDoc.data(), universeId: universeAddressLower });
    await db.collection('privateSectionConfig').doc(OLD_FAKE_ADDRESS).delete();
    console.log(`  ✅ privateSectionConfig re-keyed`);
  }

  // Episodes
  const episodesSnap = await db
    .collection('episodes')
    .where('universeId', '==', OLD_FAKE_ADDRESS)
    .get();
  if (episodesSnap.size > 0) {
    const batch = db.batch();
    for (const doc of episodesSnap.docs) {
      batch.update(doc.ref, { universeId: universeAddressLower, updatedAt: new Date() });
    }
    await batch.commit();
    console.log(`  ✅ ${episodesSnap.size} episodes updated`);
  }

  // ── Step 3: Create on-chain nodes for existing videos ───────────────
  console.log(`\nStep 3: Creating on-chain nodes for existing videos...`);

  const allVids = await db
    .collection('videoGenerations')
    .where('universeId', '==', universeAddressLower)
    .get();
  const sorted = allVids.docs
    .map((d) => ({ id: d.id, ...d.data() }) as any)
    .filter((v) => v.sceneId && v.videoUrl && !v.onChainNodeId)
    .sort((a, b) => (a.sceneId || 0) - (b.sceneId || 0));

  console.log(`  ${sorted.length} videos need on-chain nodes`);

  let previousNodeId = 0n;
  let success = 0;
  let failed = 0;

  for (const video of sorted) {
    const contentHash = keccak256(toBytes(video.videoUrl));
    const plotText = (video.fullPrompt || video.prompt || video.sceneTitle || 'Scene').slice(
      0,
      5000
    );
    const plotHash = keccak256(toBytes(plotText));

    console.log(`\n  Scene ${video.sceneId}: ${video.sceneTitle}`);
    console.log(`    Calling createNode (previous=${previousNodeId})...`);

    try {
      const txHash = await walletClient.writeContract({
        address: universeAddressLower as Address,
        abi: universeAbi,
        functionName: 'createNode',
        args: [contentHash, plotHash, previousNodeId, video.videoUrl, plotText],
      });

      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

      let newNodeId = 0n;
      for (const log of receipt.logs) {
        try {
          const decoded = decodeEventLog({ abi: universeAbi, data: log.data, topics: log.topics });
          if (decoded.eventName === 'NodeCreated') {
            const args = decoded.args as any;
            newNodeId = args.nodeId ?? args[0];
            break;
          }
        } catch {
          continue;
        }
      }

      const previousForUpdate = previousNodeId;
      previousNodeId = newNodeId;
      success++;

      await db.collection('videoGenerations').doc(video.id).update({
        onChainNodeId: newNodeId.toString(),
        onChainTxHash: txHash,
        previousNodeId: previousForUpdate.toString(),
      });

      console.log(`    ✅ Node ${newNodeId} created — tx: ${txHash.slice(0, 20)}...`);
      await new Promise((r) => setTimeout(r, 2000));
    } catch (err: any) {
      failed++;
      console.error(`    ❌ Failed: ${err.message?.slice(0, 200)}`);
    }
  }

  console.log(`
════════════════════════════════════════════════════════════
  RECOVERY COMPLETE
════════════════════════════════════════════════════════════
  Universe ID  : ${universeId}
  Address      : ${universeAddressLower}
  Nodes Created: ${success} (${failed} failed)

  View at: /universe/${universeAddressLower}
  Etherscan: https://sepolia.etherscan.io/address/${universeAddressLower}
════════════════════════════════════════════════════════════
`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
