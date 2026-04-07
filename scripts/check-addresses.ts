/**
 * check-addresses.ts
 *
 * CI gate: verifies that packages/abis/src/addresses.ts is in sync with
 * deployments/sepolia.json (the canonical address manifest).
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

const MANIFEST_FILE = path.join(ROOT, 'deployments/sepolia.json');
const ADDRESSES_FILE = path.join(ROOT, 'packages/abis/src/addresses.ts');

// ── load manifest ─────────────────────────────────────────────────────────────
if (!fs.existsSync(MANIFEST_FILE)) {
  console.error(`❌ Manifest not found: ${MANIFEST_FILE}`);
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf-8')) as {
  chainId: number;
  contracts: Record<string, string>;
};

// ── regenerate expected addresses.ts in memory ────────────────────────────────
const TRACKED_CONTRACTS = Object.keys(manifest.contracts);

let expected = `// Auto-generated from deployments/sepolia.json — do not edit directly.\n`;
expected += `// To update: pnpm sync:addresses\n\n`;

for (const name of TRACKED_CONTRACTS) {
  const addr = manifest.contracts[name];
  expected += `export const ${name} = {\n`;
  expected += `  '${manifest.chainId}': '${addr}',\n`;
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
  console.log('✅ addresses.ts matches deployments/sepolia.json');
  process.exit(0);
}

// ── report mismatch ───────────────────────────────────────────────────────────
console.error('❌ addresses.ts is out of sync with deployments/sepolia.json\n');

// Show which addresses differ by parsing both files
const manifestAddrs = manifest.contracts;
const actualAddrs: Record<string, string> = {};
for (const match of actual.matchAll(/'11155111': '(0x[0-9a-fA-F]+)'/g)) {
  const nameMatch = actual
    .slice(0, actual.indexOf(match[0]))
    .match(/export const (\w+) = \{[^}]*$/s);
  if (nameMatch) actualAddrs[nameMatch[1]] = match[1];
}

let hasDiff = false;
for (const name of TRACKED_CONTRACTS) {
  const want = manifestAddrs[name];
  const got = actualAddrs[name];
  if (!got) {
    console.error(`  MISSING  ${name}`);
    hasDiff = true;
  } else if (want.toLowerCase() !== got.toLowerCase()) {
    console.error(`  MISMATCH ${name}`);
    console.error(`    manifest:    ${want}`);
    console.error(`    addresses.ts: ${got}`);
    hasDiff = true;
  }
}

if (hasDiff) {
  console.error('\nFix: run `pnpm sync:addresses` and commit the result.');
} else {
  // Whitespace / header difference
  console.error('Content differs (header or formatting mismatch).');
  console.error('Fix: run `pnpm sync:addresses` and commit the result.');
}

process.exit(1);
