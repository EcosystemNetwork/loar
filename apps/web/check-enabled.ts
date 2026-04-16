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

import { createPublicClient, http, parseAbi } from 'viem';
import { baseSepolia } from 'viem/chains';

const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http('https://base-sepolia-rpc.publicnode.com'),
});
const UNIVERSE_MANAGER = '0x7Fa728f17e91AAa4aaD895b7b128Df193b73C0a8' as const;
const HOOK = '0xe35adBBc6da1000BE4DCbf49ccBE3B9B70c9a8cC' as const;
const LOCKER = '0x6C67EaC980DAF0AC8aDBD6a41E61a7833E2D5FF6' as const;

const abi = parseAbi([
  'function enabledHooks(address) view returns (bool)',
  'function enabledLockers(address,address) view returns (bool)',
]);

async function main() {
  const hookEnabled = await publicClient.readContract({
    address: UNIVERSE_MANAGER,
    abi,
    functionName: 'enabledHooks',
    args: [HOOK],
  });
  console.log('Hook enabled:', hookEnabled);

  const lockerEnabled = await publicClient.readContract({
    address: UNIVERSE_MANAGER,
    abi,
    functionName: 'enabledLockers',
    args: [LOCKER, HOOK],
  });
  console.log('Locker enabled (for hook):', lockerEnabled);
}
main();
