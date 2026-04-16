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

import { createPublicClient, createWalletClient, http, encodeAbiParameters } from 'viem';
import { baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const rawKey = process.env.PRIVATE_KEY ?? '';
const PRIVATE_KEY = (rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`) as `0x${string}`;
const account = privateKeyToAccount(PRIVATE_KEY);
const rpc = 'https://base-sepolia-rpc.publicnode.com';
const publicClient = createPublicClient({ chain: baseSepolia, transport: http(rpc) });
const walletClient = createWalletClient({ account, chain: baseSepolia, transport: http(rpc) });

const UNIVERSE_MANAGER = '0x7Fa728f17e91AAa4aaD895b7b128Df193b73C0a8';

// Load bytecode
const artifact = JSON.parse(
  readFileSync(
    '/home/god/Desktop/LOAR/loar/apps/contracts/out/UniverseTokenDeployerV2.sol/UniverseTokenDeployerV2.0.8.28.json',
    'utf-8'
  )
);
const bytecode = artifact.bytecode.object as string;

const constructorArgs = encodeAbiParameters(
  [
    { type: 'address', name: '_universeManager' },
    { type: 'address', name: '_vestingContract' },
  ],
  [UNIVERSE_MANAGER as `0x${string}`, '0x0000000000000000000000000000000000000000']
);

const deployData = (bytecode + constructorArgs.slice(2)) as `0x${string}`;
console.log('Deploy data length:', deployData.length);
console.log('Deployer:', account.address);

async function main() {
  const hash = await walletClient.sendTransaction({
    data: deployData,
    chain: baseSepolia,
  });
  console.log('TX:', hash);

  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
  console.log('Status:', receipt.status);
  console.log('Contract:', receipt.contractAddress);
}
main().catch((e) => {
  console.error('ERROR:', e.message?.slice(0, 300));
  process.exit(1);
});
