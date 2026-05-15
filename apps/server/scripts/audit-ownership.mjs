#!/usr/bin/env node
/**
 * Read-only ownership audit of Base Sepolia (84532).
 * Calls owner() on every audit-tracked contract and groups by current owner.
 * No keys, no broadcast — safe to run anywhere viem can resolve.
 *
 * Usage:
 *   pnpm -F server exec node scripts/audit-ownership.mjs
 *
 * Complements apps/contracts/script/VerifyMultisigTransfer.s.sol — that one
 * needs forge installed and asserts owner == TIMELOCK_ADDRESS. This one runs
 * anywhere with Node + viem and groups by whichever address actually holds
 * each contract (useful pre-GOV-01 when you want to see drift, not assert).
 */
import { createPublicClient, http } from 'viem';
import { baseSepolia } from 'viem/chains';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../..');

dotenv.config({ path: resolve(REPO_ROOT, '.env') });

const RPC =
  process.env.RPC_84532 ??
  process.env.RPC_URL ??
  'https://base-sepolia-rpc.publicnode.com';

const client = createPublicClient({ chain: baseSepolia, transport: http(RPC) });

// Pull addresses from packages/abis/src/addresses.ts
const src = readFileSync(
  resolve(REPO_ROOT, 'packages/abis/src/addresses.ts'),
  'utf-8',
);

// Parse exported const blocks: `export const Name = { '84532': '0x...', ... }`
const re = /export const (\w+) = \{[^}]*'84532':\s*'(0x[a-fA-F0-9]{40})'/g;
const contracts = [];
let m;
while ((m = re.exec(src))) contracts.push({ name: m[1], addr: m[2] });

const OWNER_ABI = [
  { type: 'function', name: 'owner', inputs: [], outputs: [{ type: 'address' }], stateMutability: 'view' },
];

console.log(`Probing ${contracts.length} contracts on Base Sepolia via ${RPC.split('?')[0]}`);
console.log('');

const byOwner = new Map();
const noOwner = [];
const noCode = [];

for (const c of contracts) {
  try {
    const code = await client.getCode({ address: c.addr });
    if (!code || code === '0x') {
      noCode.push(c);
      continue;
    }
    const owner = await client.readContract({
      address: c.addr,
      abi: OWNER_ABI,
      functionName: 'owner',
    });
    const key = owner.toLowerCase();
    if (!byOwner.has(key)) byOwner.set(key, []);
    byOwner.get(key).push(c);
  } catch (e) {
    noOwner.push({ ...c, err: e.shortMessage || e.message?.slice(0, 80) });
  }
}

console.log(`── Owners on Base Sepolia (${contracts.length} probed) ──`);
for (const [owner, list] of [...byOwner.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`\n${owner}  (${list.length} contracts)`);
  for (const c of list) console.log(`  ${c.name.padEnd(32)} ${c.addr}`);
}

if (noOwner.length) {
  console.log(`\n── No owner() (not Ownable, or revert) ─ ${noOwner.length}`);
  for (const c of noOwner) console.log(`  ${c.name.padEnd(32)} ${c.addr}  [${c.err}]`);
}
if (noCode.length) {
  console.log(`\n── No bytecode (not deployed) ─ ${noCode.length}`);
  for (const c of noCode) console.log(`  ${c.name.padEnd(32)} ${c.addr}`);
}
