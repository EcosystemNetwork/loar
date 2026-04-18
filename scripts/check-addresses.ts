/**
 * check-addresses.ts
 *
 * CI gate: verifies that packages/abis/src/addresses.ts is in sync with
 * all deployment manifests (sepolia.json, base-sepolia.json, etc.).
 *
 * Exits 0 when everything matches; exits 1 with a diff on any mismatch.
 *
 * Run:
 *   pnpm check:addresses
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const DEPLOYMENT_DIR = path.join(ROOT, 'deployments');
const ADDRESSES_FILE = path.join(ROOT, 'packages/abis/src/addresses.ts');

// ── load all deployment manifests ────────────────────────────────────────────
const manifests: Array<{ chainId: number; contracts: Record<string, string> }> = [];

for (const file of fs.readdirSync(DEPLOYMENT_DIR)) {
  if (!file.endsWith('.json')) continue;
  const m = JSON.parse(fs.readFileSync(path.join(DEPLOYMENT_DIR, file), 'utf-8'));
  const hasRealAddresses = Object.values(m.contracts).some(
    (addr) => addr !== '0x0000000000000000000000000000000000000000'
  );
  if (hasRealAddresses) {
    manifests.push(m);
  }
}

if (manifests.length === 0) {
  console.error(`❌ No deployment manifests with real addresses found in ${DEPLOYMENT_DIR}`);
  process.exit(1);
}

// Collect all tracked contract names from all manifests
const allContractNames = [...new Set(manifests.flatMap((m) => Object.keys(m.contracts)))];

// ── regenerate expected addresses.ts in memory ────────────────────────────────
let expected = `// Auto-generated from deployment manifests — do not edit directly.\n`;
expected += `// To update: pnpm tsx scripts/rebuild-deployments.ts --apply\n\n`;

// Sort alphabetically for stable output (matches rebuild-deployments.ts)
allContractNames.sort();

for (const name of allContractNames) {
  expected += `export const ${name} = {\n`;
  for (const m of manifests) {
    if (m.contracts[name]) {
      expected += `  '${m.chainId}': '${m.contracts[name]}',\n`;
    }
  }
  expected += `} as const;\n\n`;
  expected += `export type ${name}ChainId = keyof typeof ${name};\n\n`;
}

// ── compare to disk ───────────────────────────────────────────────────────────
if (!fs.existsSync(ADDRESSES_FILE)) {
  console.error(`❌ addresses.ts not found: ${ADDRESSES_FILE}`);
  console.error('   Run: pnpm sync:addresses');
  process.exit(1);
}

const actual = fs.readFileSync(ADDRESSES_FILE, 'utf-8');

if (actual === expected) {
  const chainNames = manifests.map((m) => `${m.chainId}`).join(', ');
  console.log(`✅ addresses.ts matches deployment manifests (chains: ${chainNames})`);
  process.exit(0);
}

// ── report mismatch ───────────────────────────────────────────────────────────
console.error('❌ addresses.ts is out of sync with deployment manifests\n');
console.error('Fix: run `pnpm sync:addresses` and commit the result.');
process.exit(1);
