/**
 * sync-deployments.ts
 *
 * Parses the latest Foundry broadcast output and writes:
 *   1. deployments/sepolia.json   — canonical address manifest (checked in)
 *   2. packages/abis/src/addresses.ts — TypeScript exports consumed by web/indexer
 *
 * Run after every `forge script ... --broadcast`:
 *   pnpm sync:addresses
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getAddress, hexToNumber } from 'viem';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ── inputs ────────────────────────────────────────────────────────────────────
const BROADCAST_FILE = path.join(
  ROOT,
  'apps/contracts/broadcast/DeployProtocol.s.sol/11155111/run-latest.json'
);

// ── outputs ───────────────────────────────────────────────────────────────────
const MANIFEST_FILE = path.join(ROOT, 'deployments/sepolia.json');
const ADDRESSES_FILE = path.join(ROOT, 'packages/abis/src/addresses.ts');

// Contracts we extract from the DeployProtocol broadcast, in declaration order.
// Add new protocol-level contracts here when they are added to the deploy script.
const TRACKED_CONTRACTS = [
  'UniverseManager',
  'UniverseTokenDeployer',
  'LoarFeeLocker',
  'LoarLpLockerMultiple',
  'LoarHookStaticFee',
] as const;

type ContractName = (typeof TRACKED_CONTRACTS)[number];

// ── parse broadcast ───────────────────────────────────────────────────────────
if (!fs.existsSync(BROADCAST_FILE)) {
  console.error(`❌ Broadcast file not found: ${BROADCAST_FILE}`);
  console.error('   Run: forge script script/DeployProtocol.s.sol --broadcast --rpc-url sepolia');
  process.exit(1);
}

const broadcast = JSON.parse(fs.readFileSync(BROADCAST_FILE, 'utf-8'));

// Take the first CREATE occurrence of each tracked contract name.
const seen = new Set<string>();
const contracts: Partial<Record<ContractName, string>> = {};

for (const tx of broadcast.transactions ?? []) {
  if (
    tx.contractName &&
    tx.contractAddress &&
    !seen.has(tx.contractName) &&
    (TRACKED_CONTRACTS as readonly string[]).includes(tx.contractName)
  ) {
    seen.add(tx.contractName);
    contracts[tx.contractName as ContractName] = getAddress(tx.contractAddress);
  }
}

const missing = TRACKED_CONTRACTS.filter((name) => !contracts[name]);
if (missing.length > 0) {
  console.error(`❌ Missing contracts in broadcast: ${missing.join(', ')}`);
  process.exit(1);
}

const startBlock = hexToNumber(broadcast.receipts[0]!.blockNumber);
const updatedAt = new Date().toISOString();

// ── write manifest ────────────────────────────────────────────────────────────
const manifest = {
  chainId: 11155111,
  environment: 'sepolia',
  startBlock,
  updatedAt,
  contracts: contracts as Record<ContractName, string>,
};

fs.mkdirSync(path.dirname(MANIFEST_FILE), { recursive: true });
fs.writeFileSync(MANIFEST_FILE, JSON.stringify(manifest, null, 2) + '\n');
console.log(`✅ Wrote manifest  → ${path.relative(ROOT, MANIFEST_FILE)}`);

// ── write addresses.ts ────────────────────────────────────────────────────────
let tsOut = `// Auto-generated from deployments/sepolia.json — do not edit directly.\n`;
tsOut += `// To update: pnpm sync:addresses\n\n`;

for (const name of TRACKED_CONTRACTS) {
  const addr = contracts[name]!;
  tsOut += `export const ${name} = {\n`;
  tsOut += `  '11155111': '${addr}',\n`;
  tsOut += `} as const;\n\n`;
  tsOut += `export type ${name}ChainId = keyof typeof ${name};\n\n`;
}

fs.writeFileSync(ADDRESSES_FILE, tsOut);
console.log(`✅ Wrote addresses → ${path.relative(ROOT, ADDRESSES_FILE)}`);
console.log(`   startBlock: ${startBlock}`);
console.log(`   updatedAt:  ${updatedAt}`);
