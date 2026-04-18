/**
 * Check deployer wallet balance + UniverseManager mint fee on Sepolia.
 */
import dotenv from 'dotenv';
import path from 'path';
import { createPublicClient, http, formatEther, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { universeManagerAbi } from '../packages/abis/src/generated';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const RAW_PK = process.env.PRIVATE_KEY!;
const PRIVATE_KEY = (RAW_PK.startsWith('0x') ? RAW_PK : `0x${RAW_PK}`) as `0x${string}`;
const account = privateKeyToAccount(PRIVATE_KEY);
const publicClient = createPublicClient({ chain: sepolia, transport: http(process.env.RPC_URL) });

async function main() {
  const balance = await publicClient.getBalance({ address: account.address });
  const mintFee = (await publicClient.readContract({
    address: process.env.UNIVERSE_MANAGER as Address,
    abi: universeManagerAbi,
    functionName: 'mintFee',
  })) as bigint;

  console.log(`
═══════════════════════════════════════════════════
  Sepolia Deployer Status
═══════════════════════════════════════════════════
  Address  : ${account.address}
  Balance  : ${formatEther(balance)} ETH
  Mint Fee : ${formatEther(mintFee)} ETH
  Sufficient for deploy: ${balance >= mintFee ? '✅ yes' : '❌ no'}
  Estimated cost (deploy + 7 nodes + gas): ~${formatEther(mintFee + 8n * 30000000000000000n)} ETH
═══════════════════════════════════════════════════
`);
}

main().catch(console.error);
