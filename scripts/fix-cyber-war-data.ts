/**
 * Find and fill in missing Cyber War universe data (image, token, governor).
 * Reads the creation tx receipt + Universe.sol view functions.
 *
 * Usage: pnpm tsx scripts/fix-cyber-war-data.ts
 */
import dotenv from 'dotenv';
import path from 'path';
import { readFileSync } from 'fs';
import { createPublicClient, http, getAddress, decodeEventLog } from 'viem';
import { sepolia } from 'viem/chains';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

let serviceAccount: any;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
} else if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
  const absPath = path.resolve(process.cwd(), process.env.FIREBASE_SERVICE_ACCOUNT_PATH);
  serviceAccount = JSON.parse(readFileSync(absPath, 'utf-8'));
}
const fbApp = initializeApp({ credential: cert(serviceAccount!) });
const db = getFirestore(fbApp);

const RPC_URL = process.env.RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com';
const publicClient = createPublicClient({ chain: sepolia, transport: http(RPC_URL) });

const UNIVERSE_ADDRESS = '0x341fFa19c0EC8D2C8eF42A360cf799949844262e' as `0x${string}`;
const UNIVERSE_ID = UNIVERSE_ADDRESS.toLowerCase();
const CREATION_TX =
  '0x40806fd2b26919f46acfeb4c1c55983848f50bdaf8c1b1a61e2ae563a18972d4' as `0x${string}`;

async function main() {
  const updates: Record<string, any> = { mintTxHash: CREATION_TX };

  // 1. Decode creation tx receipt for TokenCreated
  console.log('=== Decoding creation tx receipt ===');
  const umAbi = JSON.parse(
    readFileSync(
      path.resolve(process.cwd(), 'apps/contracts/out/UniverseManager.sol/UniverseManager.json'),
      'utf-8'
    )
  ).abi;

  const receipt = await publicClient.getTransactionReceipt({ hash: CREATION_TX });
  console.log(`Logs: ${receipt.logs.length}`);

  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({ abi: umAbi, data: log.data, topics: log.topics });
      const args = decoded.args as any;
      console.log(
        `  ${decoded.eventName}:`,
        JSON.stringify(args, (_, v) => (typeof v === 'bigint' ? v.toString() : v))
      );

      if (decoded.eventName === 'TokenCreated') {
        updates.tokenAddress = args.tokenAddress?.toLowerCase() ?? args.token?.toLowerCase();
        updates.governanceAddress = args.governor?.toLowerCase();
      }
      if (decoded.eventName === 'UniverseLpSeed') {
        updates.onChainUniverseId = args.universeId?.toString();
      }
    } catch {
      // Not a UniverseManager event
    }
  }

  // 2. Read Universe.sol view functions for imageURL
  console.log('\n=== Reading Universe contract ===');
  try {
    const uAbi = JSON.parse(
      readFileSync(
        path.resolve(process.cwd(), 'apps/contracts/out/Universe.sol/Universe.json'),
        'utf-8'
      )
    ).abi;
    const viewFns = uAbi.filter(
      (x: any) => x.type === 'function' && x.stateMutability === 'view' && x.inputs.length === 0
    );
    console.log(`View functions: ${viewFns.map((f: any) => f.name).join(', ')}`);

    for (const fn of viewFns) {
      try {
        const result = await publicClient.readContract({
          address: UNIVERSE_ADDRESS,
          abi: uAbi,
          functionName: fn.name,
        });
        if (typeof result === 'string' && result.length > 0 && result.length < 500) {
          console.log(`  ${fn.name}() = ${result.slice(0, 120)}`);
          if (fn.name.toLowerCase().includes('image')) {
            updates.image_url = result;
          }
        }
      } catch {}
    }
  } catch {
    console.log('Universe.sol ABI not found');
  }

  // 3. Check content docs for images
  console.log('\n=== Checking content docs ===');
  const allContent = await db.collection('content').get();
  for (const doc of allContent.docs) {
    const d = doc.data();
    const json = JSON.stringify(d).toLowerCase();
    if (json.includes('cyber war') && (d.imageUrl || d.thumbnailUrl || d.coverImageUrl)) {
      console.log(
        `  ${doc.id} "${d.name}": image=${d.imageUrl ?? d.thumbnailUrl ?? d.coverImageUrl}`
      );
      // Use first episode image as fallback cover
      if (!updates.image_url && (d.imageUrl || d.thumbnailUrl || d.coverImageUrl)) {
        updates.image_url = d.imageUrl ?? d.thumbnailUrl ?? d.coverImageUrl;
        console.log('  ^ Using as universe cover (fallback)');
      }
    }
  }

  // 4. Apply updates
  console.log('\n=== Applying updates ===');
  updates.updated_at = new Date();
  for (const [k, v] of Object.entries(updates)) {
    if (v !== undefined) {
      console.log(`  ${k}: ${typeof v === 'string' ? v.slice(0, 100) : v}`);
    }
  }

  await db.collection('cinematicUniverses').doc(UNIVERSE_ID).update(updates);
  console.log('\n✓ Cyber War universe updated successfully');
}

main().catch((err) => {
  console.error('FAILED:', err.message ?? err);
  process.exit(1);
});
