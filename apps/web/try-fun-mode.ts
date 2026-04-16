import { readFileSync } from 'fs';
import { resolve } from 'path';
const envPath = resolve(import.meta.dir, '..', '..', '.env');
try {
  const envContent = readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
} catch {}

import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  formatEther,
  decodeEventLog,
} from 'viem';
import { baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { universeManagerAbi } from '@loar/abis/generated';

const rawKey = process.env.PRIVATE_KEY ?? '';
const PRIVATE_KEY = (rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`) as `0x${string}`;
const account = privateKeyToAccount(PRIVATE_KEY);
const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http('https://base-sepolia-rpc.publicnode.com'),
});
const walletClient = createWalletClient({
  account,
  chain: baseSepolia,
  transport: http('https://base-sepolia-rpc.publicnode.com'),
});

const UNIVERSE_MANAGER = '0x7Fa728f17e91AAa4aaD895b7b128Df193b73C0a8' as const;
const IMAGE =
  'https://peach-impressive-moth-978.mypinata.cloud/ipfs/QmW8JFQu9hfoDDSQ8xSn4pMLKUF5ffogvaUYA7L67uyL2p';

async function main() {
  const mintFee = (await publicClient.readContract({
    address: UNIVERSE_MANAGER,
    abi: universeManagerAbi,
    functionName: 'mintFee',
  })) as bigint;
  console.log('Mint fee:', formatEther(mintFee));

  // Try fun mode only (no token)
  console.log('\nCreating universe (fun mode, no token)...');
  try {
    const txHash = await walletClient.writeContract({
      address: UNIVERSE_MANAGER,
      abi: universeManagerAbi,
      functionName: 'createUniverse',
      args: [
        'Astral Protocol',
        IMAGE,
        'In 2087, alien consciousnesses use Earth silicon networks as vessels.',
        0,
        0,
        account.address,
      ],
      value: mintFee,
    });
    console.log('TX sent:', txHash);

    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash,
      confirmations: 1,
      timeout: 120_000,
    });
    console.log('Status:', receipt.status);
    console.log('Gas used:', receipt.gasUsed.toString());

    // Parse events
    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({
          abi: universeManagerAbi,
          data: log.data,
          topics: log.topics,
        });
        console.log('Event:', decoded.eventName, decoded.args);
      } catch {}
    }
  } catch (e: any) {
    console.error('FAILED:', e.shortMessage || e.message?.slice(0, 500));
  }
}
main();
