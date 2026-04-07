/**
 * sync-deployments.ts
 *
 * Parses the latest Foundry broadcast output and writes:
 *   1. deployments/{env}.json    — canonical address manifest (checked in)
 *   2. packages/abis/src/addresses.ts — TypeScript exports consumed by web/indexer
 *
 * Supports multiple chains via DEPLOY_CHAIN env var:
 *   DEPLOY_CHAIN=sepolia       pnpm sync:addresses   (default)
 *   DEPLOY_CHAIN=base-sepolia  pnpm sync:addresses
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

// ── chain config ─────────────────────────────────────────────────────────────
interface ChainConfig {
  chainId: number;
  environment: string;
  broadcastChainId: string;
  manifestFile: string;
}

const CHAINS: Record<string, ChainConfig> = {
  sepolia: {
    chainId: 11155111,
    environment: 'sepolia',
    broadcastChainId: '11155111',
    manifestFile: 'deployments/sepolia.json',
  },
  'base-sepolia': {
    chainId: 84532,
    environment: 'base-sepolia',
    broadcastChainId: '84532',
    manifestFile: 'deployments/base-sepolia.json',
  },
};

const deployChain = process.env.DEPLOY_CHAIN ?? 'sepolia';
const chainConfig = CHAINS[deployChain];
if (!chainConfig) {
  console.error(
    `❌ Unknown DEPLOY_CHAIN="${deployChain}". Valid: ${Object.keys(CHAINS).join(', ')}`
  );
  process.exit(1);
}

// ── inputs ────────────────────────────────────────────────────────────────────
const BROADCAST_FILE = path.join(
  ROOT,
  `apps/contracts/broadcast/DeployProtocol.s.sol/${chainConfig.broadcastChainId}/run-latest.json`
);

// ── outputs ───────────────────────────────────────────────────────────────────
const MANIFEST_FILE = path.join(ROOT, chainConfig.manifestFile);
const ADDRESSES_FILE = path.join(ROOT, 'packages/abis/src/addresses.ts');

// Contracts we extract from the DeployProtocol broadcast, in declaration order.
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
  console.error(
    `   Run: forge script script/DeployProtocol.s.sol --broadcast --rpc-url ${deployChain}`
  );
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
  chainId: chainConfig.chainId,
  environment: chainConfig.environment,
  startBlock,
  updatedAt,
  contracts: contracts as Record<ContractName, string>,
};

fs.mkdirSync(path.dirname(MANIFEST_FILE), { recursive: true });
fs.writeFileSync(MANIFEST_FILE, JSON.stringify(manifest, null, 2) + '\n');
console.log(`✅ Wrote manifest  → ${path.relative(ROOT, MANIFEST_FILE)}`);

// ── write addresses.ts (merges all deployment manifests) ─────────────────────
const allManifests: Array<{ chainId: number; contracts: Record<string, string> }> = [];

for (const cfg of Object.values(CHAINS)) {
  const mPath = path.join(ROOT, cfg.manifestFile);
  if (fs.existsSync(mPath)) {
    const m = JSON.parse(fs.readFileSync(mPath, 'utf-8'));
    // Only include manifests with real (non-zero) addresses
    const hasRealAddresses = Object.values(m.contracts).some(
      (addr) => addr !== '0x0000000000000000000000000000000000000000'
    );
    if (hasRealAddresses) {
      allManifests.push(m);
    }
  }
}

let tsOut = `// Auto-generated from deployment manifests — do not edit directly.\n`;
tsOut += `// To update: pnpm sync:addresses\n\n`;

for (const name of TRACKED_CONTRACTS) {
  tsOut += `export const ${name} = {\n`;
  for (const m of allManifests) {
    if (m.contracts[name]) {
      tsOut += `  '${m.chainId}': '${m.contracts[name]}',\n`;
    }
  }
  tsOut += `} as const;\n\n`;
  tsOut += `export type ${name}ChainId = keyof typeof ${name};\n\n`;
}

fs.writeFileSync(ADDRESSES_FILE, tsOut);
console.log(`✅ Wrote addresses → ${path.relative(ROOT, ADDRESSES_FILE)}`);
console.log(`   chain:      ${chainConfig.environment} (${chainConfig.chainId})`);
console.log(`   startBlock: ${startBlock}`);
console.log(`   updatedAt:  ${updatedAt}`);
