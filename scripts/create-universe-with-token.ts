/**
 * Create a universe WITH a governance token on Sepolia.
 *
 * Uses the current deployed contracts from deployments/sepolia.json.
 * The token will appear on the launchpad once the Ponder indexer picks up the events.
 *
 * Usage: pnpm tsx scripts/create-universe-with-token.ts
 */
import dotenv from 'dotenv';
import path from 'path';
import { readFileSync } from 'fs';
import {
  createPublicClient,
  createWalletClient,
  http,
  formatEther,
  decodeEventLog,
  encodeAbiParameters,
} from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

// Load ABI directly from Foundry output
const artifact = JSON.parse(
  readFileSync(
    path.resolve(process.cwd(), 'apps/contracts/out/UniverseManager.sol/UniverseManager.json'),
    'utf-8'
  )
);
const universeManagerAbi = artifact.abi;

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

// ── Config ────────────────────────────────────────────────────────────────────
const rawKey = process.env.PRIVATE_KEY ?? '';
const PRIVATE_KEY = (rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`) as `0x${string}`;
const RPC_URL = process.env.RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com';

// Sepolia contract addresses from deployments/sepolia.json + packages/abis/addresses.ts
const UNIVERSE_MANAGER = '0xB82dE188841a799e0dBB58D885D81BEE7A735f00' as const;
const HOOK = '0xF5b2676E0fbc7551ae3E38f25D87C941C5a968CC' as const; // LoarHookStaticFee
const LOCKER = '0x7d30fd57e44aB0ca407D312976816E7052905E0A' as const; // LoarLpLockerMultiple
const WETH = '0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9' as const; // Sepolia WETH

// ── Universe details ──────────────────────────────────────────────────────────
const UNIVERSE_NAME = 'Neon Ronin';
const UNIVERSE_DESCRIPTION =
  'Tokyo 2089. Megacorporations own the sky, but the neon-lit streets belong to the Ronin — rogue AI samurai who defected from their corporate masters. Armed with quantum katanas that cut through both matter and data, they wage guerrilla warfare in the liminal space between meatspace and the Net. When a Ronin named Akira discovers an ancient protocol hidden in the blockchain — one that predates humanity — the war for the future of consciousness begins.';
const UNIVERSE_IMAGE =
  'https://peach-impressive-moth-978.mypinata.cloud/ipfs/QmVGt4DfHvgvh1xmx8abxwELFhKwtaaMDeG1DjfY8BxTWn';
const TOKEN_SYMBOL = 'RONIN';

// Pool config
const STARTING_TICK = -230400; // ~10 ETH market cap
const TICK_SPACING = 200;

// ── Setup ─────────────────────────────────────────────────────────────────────
const account = privateKeyToAccount(PRIVATE_KEY);
const publicClient = createPublicClient({ chain: sepolia, transport: http(RPC_URL) });
const walletClient = createWalletClient({ account, chain: sepolia, transport: http(RPC_URL) });

async function main() {
  console.log('\n' + '═'.repeat(60));
  console.log('  LOAR — Create Universe + Token (Sepolia)');
  console.log('═'.repeat(60));

  console.log(`\n  Deployer : ${account.address}`);

  // Check balance
  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`  Balance  : ${formatEther(balance)} ETH`);
  if (balance < 50000000000000000n) {
    throw new Error('Need at least 0.05 ETH for mint fee + gas');
  }

  // Read mint fee from contract
  const mintFee = (await publicClient.readContract({
    address: UNIVERSE_MANAGER,
    abi: universeManagerAbi,
    functionName: 'mintFee',
  })) as bigint;
  console.log(`  Mint fee : ${formatEther(mintFee)} ETH`);

  // Check hook is enabled
  const hookEnabled = await publicClient.readContract({
    address: UNIVERSE_MANAGER,
    abi: universeManagerAbi,
    functionName: 'enabledHooks',
    args: [HOOK],
  });
  console.log(`  Hook     : ${hookEnabled ? 'enabled' : 'DISABLED'}`);
  if (!hookEnabled) throw new Error('Hook is not enabled on UniverseManager');

  // Encode pool fee data
  const poolData = encodeAbiParameters(
    [
      {
        type: 'tuple',
        components: [
          { name: 'loarFee', type: 'uint24' },
          { name: 'pairedFee', type: 'uint24' },
        ],
      },
    ],
    [{ loarFee: 3000, pairedFee: 3000 }]
  );

  // ── Step 1: Simulate first ──────────────────────────────────────────────────
  console.log(`\n  Simulating createUniverseWithToken...`);

  try {
    await publicClient.simulateContract({
      account,
      address: UNIVERSE_MANAGER,
      abi: universeManagerAbi,
      functionName: 'createUniverseWithToken',
      args: [
        UNIVERSE_NAME,
        UNIVERSE_IMAGE,
        UNIVERSE_DESCRIPTION,
        0, // NodeCreationOptions.PUBLIC
        0, // NodeVisibilityOptions.PUBLIC
        account.address,
        {
          tokenConfig: {
            tokenAdmin: account.address,
            name: UNIVERSE_NAME,
            symbol: TOKEN_SYMBOL,
            imageURL: UNIVERSE_IMAGE,
            metadata: `Governance token for ${UNIVERSE_NAME}`,
            context: UNIVERSE_DESCRIPTION,
          },
          poolConfig: {
            hook: HOOK,
            pairedToken: WETH,
            tickIfToken0IsLoar: STARTING_TICK,
            tickSpacing: TICK_SPACING,
            poolData,
          },
          lockerConfig: {
            locker: LOCKER,
            rewardAdmins: [account.address],
            rewardRecipients: [account.address],
            rewardBps: [10000],
            tickLower: [STARTING_TICK],
            tickUpper: [0],
            positionBps: [10000],
            lockerData: '0x' as `0x${string}`,
          },
          allocationConfig: {
            lpBps: 8000,
            creatorBps: 1000,
            treasuryBps: 500,
            communityBps: 500,
          },
        },
      ],
      value: mintFee,
    });
    console.log('  Simulation passed!\n');
  } catch (err: any) {
    console.error('\n  Simulation FAILED:', err.message?.slice(0, 500));
    if (err.cause) console.error('  Cause:', (err.cause as any)?.message?.slice(0, 500));
    throw new Error('Simulation failed — aborting');
  }

  // ── Step 2: Send transaction ────────────────────────────────────────────────
  console.log('  Sending transaction...');

  const txHash = await walletClient.writeContract({
    address: UNIVERSE_MANAGER,
    abi: universeManagerAbi,
    functionName: 'createUniverseWithToken',
    args: [
      UNIVERSE_NAME,
      UNIVERSE_IMAGE,
      UNIVERSE_DESCRIPTION,
      0,
      0,
      account.address,
      {
        tokenConfig: {
          tokenAdmin: account.address,
          name: UNIVERSE_NAME,
          symbol: TOKEN_SYMBOL,
          imageURL: UNIVERSE_IMAGE,
          metadata: `Governance token for ${UNIVERSE_NAME}`,
          context: UNIVERSE_DESCRIPTION,
        },
        poolConfig: {
          hook: HOOK,
          pairedToken: WETH,
          tickIfToken0IsLoar: STARTING_TICK,
          tickSpacing: TICK_SPACING,
          poolData,
        },
        lockerConfig: {
          locker: LOCKER,
          rewardAdmins: [account.address],
          rewardRecipients: [account.address],
          rewardBps: [10000],
          tickLower: [STARTING_TICK],
          tickUpper: [0],
          positionBps: [10000],
          lockerData: '0x' as `0x${string}`,
        },
        allocationConfig: {
          lpBps: 8000,
          creatorBps: 1000,
          treasuryBps: 500,
          communityBps: 500,
        },
      },
    ],
    value: mintFee,
  });

  console.log(`  TX: ${txHash}`);
  console.log(`  Explorer: https://sepolia.etherscan.io/tx/${txHash}`);
  console.log('  Waiting for confirmation...');

  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
    confirmations: 1,
    timeout: 120_000,
  });

  if (receipt.status !== 'success') {
    throw new Error(`Transaction reverted! Status: ${receipt.status}`);
  }

  console.log(`  Confirmed in block ${receipt.blockNumber} (gas: ${receipt.gasUsed})`);

  // ── Step 3: Parse events ────────────────────────────────────────────────────
  let universeAddress: string | undefined;
  let tokenAddress: string | undefined;
  let governorAddress: string | undefined;

  for (const logEntry of receipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: universeManagerAbi,
        data: logEntry.data,
        topics: logEntry.topics,
      });

      if (decoded.eventName === 'UniverseCreated') {
        const args = decoded.args as any;
        universeAddress = args.universe;
        console.log(`  UniverseCreated: ${universeAddress}`);
      }
      if (decoded.eventName === 'TokenCreated') {
        const args = decoded.args as any;
        tokenAddress = args.tokenAddress;
        governorAddress = args.governor;
        console.log(`  TokenCreated: ${tokenAddress} ($${TOKEN_SYMBOL})`);
        console.log(`  Governor: ${governorAddress}`);
      }
    } catch {
      // Not our event
    }
  }

  if (!tokenAddress) {
    console.error('\n  WARNING: No TokenCreated event found in receipt!');
    console.error('  The universe was created but token deployment may have failed.');
    process.exit(1);
  }

  // ── Done ────────────────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(60));
  console.log('  SUCCESS');
  console.log('═'.repeat(60));
  console.log(`
  Universe : ${UNIVERSE_NAME}
  Address  : ${universeAddress}
  Token    : $${TOKEN_SYMBOL} @ ${tokenAddress}
  Governor : ${governorAddress}
  Chain    : Sepolia (11155111)
  TX       : https://sepolia.etherscan.io/tx/${txHash}

  The Ponder indexer should pick this up automatically.
  Check the launchpad: /tokens
`);
}

main().catch((err) => {
  console.error('\nFAILED:', err.message ?? err);
  if (err.cause) console.error('Cause:', (err.cause as any)?.message);
  process.exit(1);
});
