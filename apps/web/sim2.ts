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

import { createPublicClient, http, parseEther } from 'viem';
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

const UNIVERSE_MANAGER = '0x99562C96389A91b17662ce5f15143f5B07b84090';
const IMAGE =
  'https://peach-impressive-moth-978.mypinata.cloud/ipfs/QmW8JFQu9hfoDDSQ8xSn4pMLKUF5ffogvaUYA7L67uyL2p';

async function main() {
  // Try createUniverse only (no token)
  try {
    const result = await publicClient.simulateContract({
      account,
      address: UNIVERSE_MANAGER as any,
      abi: universeManagerAbi,
      functionName: 'createUniverse',
      args: ['Astral Protocol 2', IMAGE, 'A test universe.', 0, 0, account.address],
      value: parseEther('0.05'),
    });
    console.log('createUniverse simulation succeeded!');
  } catch (e: any) {
    console.error('createUniverse FAILED:', e.message?.slice(0, 300));
  }
}
main();
