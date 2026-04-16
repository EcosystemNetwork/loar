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
const TOKEN_DEPLOYER = '0xDD4a87EfF3a45A718a4F3471C28De364e0F43E30' as const;

const abi = parseAbi([
  'function universeManager() view returns (address)',
  'function owner() view returns (address)',
  'function loarDeployer() view returns (address)',
  'function governorFactory() view returns (address)',
  'function vestingContract() view returns (address)',
  'function treasury() view returns (address)',
]);

async function main() {
  for (const fn of [
    'universeManager',
    'owner',
    'loarDeployer',
    'governorFactory',
    'vestingContract',
    'treasury',
  ] as const) {
    try {
      const result = await publicClient.readContract({
        address: TOKEN_DEPLOYER,
        abi,
        functionName: fn,
      });
      console.log(`${fn}: ${result}`);
    } catch (e: any) {
      console.log(`${fn}: ERROR`);
    }
  }

  const code = await publicClient.getCode({ address: TOKEN_DEPLOYER });
  console.log(`\nTokenDeployer bytecode length: ${code?.length ?? 0}`);
}
main();
