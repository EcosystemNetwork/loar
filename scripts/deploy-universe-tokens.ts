/**
 * Deploy governance tokens + liquidity pools for existing universes.
 *
 * Usage: pnpm tsx scripts/deploy-universe-tokens.ts
 */
import dotenv from 'dotenv';
import path from 'path';
import { createWalletClient, createPublicClient, http, parseEther, encodeFunctionData } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { readFileSync } from 'fs';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const rawKey = process.env.PRIVATE_KEY ?? '';
const PRIVATE_KEY = (rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`) as `0x${string}`;
const RPC_URL = process.env.RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com';

// Contract addresses on Sepolia
const UNIVERSE_MANAGER = '0x66F289658Ce5fD0Bb1022251eA4604F6b0C4d7Ce';
const HOOK = '0x9A53B31b8B4F76Bb617D6B9aAd62731f8033A8Cc';
const LOCKER = '0xc00225D9463C15280748dC2E21D8D8625982Ad54';

// Load the ABI
const artifact = JSON.parse(
  readFileSync(
    path.resolve(process.cwd(), 'apps/contracts/out/UniverseManager.sol/UniverseManager.json'),
    'utf-8'
  )
);
const abi = artifact.abi;

interface UniverseToDeploy {
  name: string;
  symbol: string;
  onChainId: bigint;
  imageUrl: string;
  description: string;
  owner: `0x${string}`;
}

const UNIVERSES_TO_DEPLOY: UniverseToDeploy[] = [
  {
    name: 'Memeverse',
    symbol: 'MEME',
    onChainId: 0n,
    imageUrl:
      'https://peach-impressive-moth-978.mypinata.cloud/ipfs/QmVGt4DfHvgvh1xmx8abxwELFhKwtaaMDeG1DjfY8BxTWn',
    description: 'In Memeverse, reality has glitched into a strange new normal.',
    owner: '0x0225cA6eBd3aFBFcD99C76F90c2f03Ec01942dD0',
  },
];

async function main() {
  const account = privateKeyToAccount(PRIVATE_KEY);
  console.log(`\nDeployer: ${account.address}`);
  console.log(`Chain: Sepolia (${sepolia.id})\n`);

  const publicClient = createPublicClient({ chain: sepolia, transport: http(RPC_URL) });
  const walletClient = createWalletClient({ account, chain: sepolia, transport: http(RPC_URL) });

  for (const u of UNIVERSES_TO_DEPLOY) {
    console.log(`Deploying token for ${u.name} (ID: ${u.onChainId}, Symbol: ${u.symbol})...`);

    try {
      const hash = await walletClient.writeContract({
        address: UNIVERSE_MANAGER as `0x${string}`,
        abi,
        functionName: 'deployUniverseToken',
        args: [
          {
            tokenConfig: {
              tokenAdmin: u.owner,
              name: u.name,
              symbol: u.symbol,
              imageURL: u.imageUrl,
              metadata: `Governance token for ${u.name}`,
              context: u.description,
            },
            poolConfig: {
              hook: HOOK as `0x${string}`,
              pairedToken: '0x0000000000000000000000000000000000000000' as `0x${string}`,
              tickIfToken0IsLoar: -887220,
              tickSpacing: 60,
              poolData: '0x' as `0x${string}`,
            },
            lockerConfig: {
              locker: LOCKER as `0x${string}`,
              rewardAdmins: [u.owner],
              rewardRecipients: [u.owner],
              rewardBps: [1000],
              tickLower: [-887220],
              tickUpper: [887220],
              positionBps: [10000],
              lockerData: '0x' as `0x${string}`,
            },
            allocationConfig: {
              curveBps: 8000,
              creatorBps: 1000,
              treasuryBps: 500,
              communityBps: 500,
            },
          },
          u.onChainId,
        ],
        value: parseEther('0.01'),
      });

      console.log(`  TX: ${hash}`);
      console.log(`  Waiting for confirmation...`);

      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      console.log(`  Status: ${receipt.status}`);

      // Parse TokenCreated event
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() === UNIVERSE_MANAGER.toLowerCase()) {
          console.log(`  Log topic: ${log.topics[0]?.slice(0, 18)}...`);
        }
      }

      console.log(`  Done!\n`);
    } catch (err: any) {
      console.error(`  FAILED: ${err.message?.slice(0, 300)}\n`);
    }
  }

  process.exit(0);
}

main().catch((e) => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
