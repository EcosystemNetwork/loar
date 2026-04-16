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

import { createPublicClient, http, formatEther, parseEther } from 'viem';
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

async function main() {
  const mintFee = await publicClient.readContract({
    address: UNIVERSE_MANAGER as any,
    abi: universeManagerAbi,
    functionName: 'mintFee',
  });
  console.log('Mint fee:', formatEther(mintFee as bigint), 'ETH');
  console.log('Mint fee raw:', (mintFee as bigint).toString());

  // Check if paused
  try {
    const paused = await publicClient.readContract({
      address: UNIVERSE_MANAGER as any,
      abi: universeManagerAbi,
      functionName: 'paused',
    });
    console.log('Paused:', paused);
  } catch {
    console.log('No paused function');
  }

  // Check owner
  try {
    const owner = await publicClient.readContract({
      address: UNIVERSE_MANAGER as any,
      abi: universeManagerAbi,
      functionName: 'owner',
    });
    console.log('Owner:', owner);
  } catch {
    console.log('No owner function');
  }

  // Try with exact mint fee
  console.log('\nSimulating with exact mint fee...');
  try {
    const result = await publicClient.simulateContract({
      account,
      address: UNIVERSE_MANAGER as any,
      abi: universeManagerAbi,
      functionName: 'createUniverse',
      args: ['Test Universe X', 'https://example.com/img.png', 'Test', 0, 0, account.address],
      value: mintFee as bigint,
    });
    console.log('SUCCESS with exact fee!');
  } catch (e: any) {
    console.error('FAILED with exact fee:', e.shortMessage || e.message?.slice(0, 200));
  }

  // Try with 0 value
  console.log('\nSimulating with 0 value...');
  try {
    const result = await publicClient.simulateContract({
      account,
      address: UNIVERSE_MANAGER as any,
      abi: universeManagerAbi,
      functionName: 'createUniverse',
      args: ['Test Universe X', 'https://example.com/img.png', 'Test', 0, 0, account.address],
      value: 0n,
    });
    console.log('SUCCESS with 0 value!');
  } catch (e: any) {
    console.error('FAILED with 0:', e.shortMessage || e.message?.slice(0, 200));
  }
}
main();
