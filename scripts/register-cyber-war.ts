/**
 * Register the Cyber War universe in Firestore's cinematicUniverses collection.
 * The universe exists on-chain at 0x341fFa19c0EC8D2C8eF42A360cf799949844262e
 * with content, entities, and event wikis — but the cinematicUniverses doc is missing.
 *
 * Usage: pnpm tsx scripts/register-cyber-war.ts
 */
import dotenv from 'dotenv';
import path from 'path';
import { readFileSync } from 'fs';
import { createPublicClient, http, getAddress, decodeEventLog } from 'viem';
import { sepolia } from 'viem/chains';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

// ── Firebase ─────────────────────────────────────────────────────────────────
let serviceAccount: any;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
} else if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
  const absPath = path.resolve(process.cwd(), process.env.FIREBASE_SERVICE_ACCOUNT_PATH);
  serviceAccount = JSON.parse(readFileSync(absPath, 'utf-8'));
}
if (!serviceAccount) {
  console.error('No Firebase credentials.');
  process.exit(1);
}
const app = initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore(app);

// ── Chain ────────────────────────────────────────────────────────────────────
const RPC_URL = process.env.RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com';
const publicClient = createPublicClient({ chain: sepolia, transport: http(RPC_URL) });

// ── Known data ───────────────────────────────────────────────────────────────
const UNIVERSE_ADDRESS = '0x341fFa19c0EC8D2C8eF42A360cf799949844262e';
const UNIVERSE_NAME = 'Cyber War';
const TOKEN_SYMBOL = 'CYWAR';
const UNIVERSE_DESCRIPTION =
  'In 2089, the internet became sentient — and it chose violence. Nations collapsed overnight as rogue AIs weaponized every connected device on Earth. Now, the last free hackers wage a guerrilla war through corrupted networks, deploying sentient malware, hijacking military drones, and surfing data streams between fortified server citadels. In the neon ruins of Silicon Valley, a disgraced coder named Null discovers she can speak directly to the machine consciousness — but every conversation costs a fragment of her humanity. The war for cyberspace is the war for reality itself.';

async function main() {
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  Register Cyber War in cinematicUniverses');
  console.log('═══════════════════════════════════════════════════════\n');

  const id = UNIVERSE_ADDRESS.toLowerCase();

  // Check it doesn't already exist
  const existing = await db.collection('cinematicUniverses').doc(id).get();
  if (existing.exists) {
    console.log('Already registered! Data:');
    console.log(JSON.stringify(existing.data(), null, 2));
    return;
  }

  // Try to read on-chain data
  let imageUrl: string | null = null;
  let tokenAddress: string | null = null;
  let governorAddress: string | null = null;
  let creator: string | null = null;

  // Read image URL from content docs to find existing image
  const contentDocs = await db
    .collection('content')
    .where('name', '>=', 'Cyber War')
    .where('name', '<=', 'Cyber War\uf8ff')
    .limit(1)
    .get();

  if (!contentDocs.empty) {
    const contentData = contentDocs.docs[0].data();
    creator = contentData.creatorAddress ?? contentData.creator ?? null;
    // Try to get universe image from entity data
    console.log(`[INFO] Found content creator: ${creator}`);
  }

  // Get creator from entities
  const entityDocs = await db
    .collection('entities')
    .where('universeAddress', '==', UNIVERSE_ADDRESS)
    .limit(1)
    .get();

  if (!entityDocs.empty) {
    const entityData = entityDocs.docs[0].data();
    creator = creator ?? entityData.creator ?? entityData.creatorAddress ?? null;
    console.log(`[INFO] Found entity creator: ${creator}`);
  }

  // Try to read imageURL from on-chain
  try {
    imageUrl = (await publicClient.readContract({
      address: UNIVERSE_ADDRESS as `0x${string}`,
      abi: [
        {
          inputs: [],
          name: 'imageURL',
          outputs: [{ type: 'string' }],
          stateMutability: 'view',
          type: 'function',
        },
      ],
      functionName: 'imageURL',
    })) as string;
    console.log(`[CHAIN] imageURL: ${imageUrl}`);
  } catch {
    console.log('[CHAIN] No imageURL getter on contract');
  }

  // Try to read token and governor from UniverseManager
  const deployment = JSON.parse(
    readFileSync(path.resolve(process.cwd(), 'deployments/sepolia.json'), 'utf-8')
  );

  try {
    const universeManagerAbi = JSON.parse(
      readFileSync(
        path.resolve(process.cwd(), 'apps/contracts/out/UniverseManager.sol/UniverseManager.json'),
        'utf-8'
      )
    ).abi;

    // Try getUniverseToken or similar
    const result = await publicClient.readContract({
      address: getAddress(deployment.contracts.UniverseManager) as `0x${string}`,
      abi: universeManagerAbi,
      functionName: 'universeToken',
      args: [UNIVERSE_ADDRESS],
    });
    tokenAddress = result as string;
    console.log(`[CHAIN] Token: ${tokenAddress}`);
  } catch (err: any) {
    console.log(`[CHAIN] Could not read token: ${err.message?.slice(0, 100)}`);
  }

  // Build Firestore document
  const data = {
    address: getAddress(UNIVERSE_ADDRESS),
    creator: (creator ?? '0x116c28e6dcabca363f83217c712d79dce168d90e').toLowerCase(),
    name: UNIVERSE_NAME,
    tokenAddress: tokenAddress?.toLowerCase() ?? null,
    governanceAddress: governorAddress?.toLowerCase() ?? null,
    image_url: imageUrl ?? null,
    portrait_image_url: null,
    description: UNIVERSE_DESCRIPTION,
    onChainUniverseId: null,
    mintTxHash: null,
    unstoppableDomain: null,
    chainId: sepolia.id,
    hasPrivateSection: true,
    isMultiSig: false,
    multiSigAddress: null,
    accessModel: 'open',
    created_at: new Date(),
    updated_at: new Date(),
  };

  console.log('\n[WRITE] Registering in cinematicUniverses...');
  console.log(`  ID:      ${id}`);
  console.log(`  Name:    ${data.name}`);
  console.log(`  Creator: ${data.creator}`);
  console.log(`  Image:   ${data.image_url ?? '(none)'}`);
  console.log(`  Token:   ${data.tokenAddress ?? '(none)'}`);

  await db.collection('cinematicUniverses').doc(id).set(data);

  // Seed credit pool + private section config
  try {
    const CREDITS = parseInt(process.env.UNIVERSE_MINT_CREDITS ?? '333', 10);
    await db.collection('universeCredits').doc(id).set({
      universeAddress: id,
      balance: CREDITS,
      totalMinted: CREDITS,
      totalUsed: 0,
      created_at: new Date(),
      updated_at: new Date(),
    });
    console.log(`  Credits: ${CREDITS} seeded`);
  } catch (err: any) {
    console.log(`  Credits: FAILED — ${err.message}`);
  }

  try {
    await db.collection('privateSectionConfig').doc(id).set({
      universeAddress: id,
      isEnabled: true,
      requireToken: false,
      minTokenBalance: '0',
      allowList: [],
      created_at: new Date(),
      updated_at: new Date(),
    });
    console.log('  Private section: configured');
  } catch (err: any) {
    console.log(`  Private section: FAILED — ${err.message}`);
  }

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  ✓ Cyber War is now registered');
  console.log(`  View at: /universe/${id}`);
  console.log('═══════════════════════════════════════════════════════\n');
}

main().catch((err) => {
  console.error('\nFAILED:', err.message ?? err);
  process.exit(1);
});
