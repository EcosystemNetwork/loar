/**
 * Deploy the LoarFaucet contract and fund it with $LOAR tokens.
 *
 * Requires DEPLOYER_PRIVATE_KEY in .env (the wallet that owns the $LOAR token).
 * Deploys to Base Sepolia by default.
 *
 * Usage: pnpm tsx scripts/deploy-faucet.ts
 */
import dotenv from 'dotenv';
import path from 'path';
import { createWalletClient, createPublicClient, http, parseUnits, encodeFunctionData } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia, baseSepolia } from 'viem/chains';
import { readFileSync } from 'fs';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const rawKey = process.env.DEPLOYER_PRIVATE_KEY ?? process.env.PRIVATE_KEY ?? '';
const PRIVATE_KEY = (rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`) as `0x${string}` | undefined;
const LOAR_TOKEN = process.env.LOAR_TOKEN_ADDRESS as `0x${string}`;
const RPC_URL = process.env.RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com';

// How many $LOAR to fund the faucet with (e.g. 1,000,000 tokens)
const FUND_AMOUNT = 1_000_000n;

async function main() {
  if (!PRIVATE_KEY) {
    console.error('Set DEPLOYER_PRIVATE_KEY in .env');
    process.exit(1);
  }
  if (!LOAR_TOKEN) {
    console.error('Set LOAR_TOKEN_ADDRESS in .env');
    process.exit(1);
  }

  const account = privateKeyToAccount(PRIVATE_KEY);
  console.log(`\nDeployer: ${account.address}`);
  console.log(`LOAR Token: ${LOAR_TOKEN}`);
  console.log(`Chain: Sepolia (${sepolia.id})\n`);

  const publicClient = createPublicClient({ chain: sepolia, transport: http(RPC_URL) });
  const walletClient = createWalletClient({ account, chain: sepolia, transport: http(RPC_URL) });

  // Load compiled contract
  const artifact = JSON.parse(
    readFileSync(
      path.resolve(process.cwd(), 'apps/contracts/out/LoarFaucet.sol/LoarFaucet.json'),
      'utf-8'
    )
  );
  const bytecode = artifact.bytecode.object as `0x${string}`;
  const abi = artifact.abi;

  // Deploy
  console.log('Deploying LoarFaucet...');
  const hash = await walletClient.deployContract({
    abi,
    bytecode,
    args: [LOAR_TOKEN],
  });

  console.log(`  TX: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const faucetAddress = receipt.contractAddress;
  console.log(`  Faucet deployed: ${faucetAddress}\n`);

  if (!faucetAddress) {
    console.error('Deploy failed — no contract address in receipt');
    process.exit(1);
  }

  // Fund the faucet with $LOAR tokens
  console.log(`Funding faucet with ${FUND_AMOUNT.toLocaleString()} $LOAR...`);
  const transferData = encodeFunctionData({
    abi: [
      {
        name: 'transfer',
        type: 'function',
        inputs: [
          { name: 'to', type: 'address' },
          { name: 'amount', type: 'uint256' },
        ],
        outputs: [{ name: '', type: 'bool' }],
      },
    ],
    functionName: 'transfer',
    args: [faucetAddress, parseUnits(FUND_AMOUNT.toString(), 18)],
  });

  const fundHash = await walletClient.sendTransaction({
    to: LOAR_TOKEN,
    data: transferData,
  });
  console.log(`  TX: ${fundHash}`);
  await publicClient.waitForTransactionReceipt({ hash: fundHash });
  console.log(`  Funded!\n`);

  console.log('════════════════════════════════════════════');
  console.log(`  Faucet Address: ${faucetAddress}`);
  console.log('');
  console.log('  Add to .env:');
  console.log(`  VITE_LOAR_FAUCET_ADDRESS=${faucetAddress}`);
  console.log('════════════════════════════════════════════\n');

  process.exit(0);
}

main().catch((e) => {
  console.error('Failed:', e.message);
  process.exit(1);
});
