/**
 * Live test for the ENS layer — resolves real names against Ethereum mainnet.
 * Run:  cd apps/server && npx tsx scripts/test-ens-live.ts
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { resolveName, lookupAddress, getProfile, getAgentCard } from '../src/lib/ens';

let pass = 0,
  fail = 0;
function ok(name: string, cond: boolean, detail = '') {
  (cond ? (pass++, console.log) : (fail++, console.log))(
    `  ${cond ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`
  );
}

async function main() {
  console.log('ENS live resolution (Ethereum mainnet)\n');

  const VITALIK = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045';
  const addr = await resolveName('vitalik.eth');
  ok('resolve vitalik.eth → address', addr?.toLowerCase() === VITALIK, addr ?? 'null');

  const name = await lookupAddress(VITALIK);
  ok('reverse vitalik address → name', name === 'vitalik.eth', name ?? 'null');

  const profile = await getProfile('vitalik.eth');
  ok('profile resolves', !!profile && profile.address?.toLowerCase() === VITALIK);

  // Agent card shape (vitalik.eth has no agent endpoints → isAgent false, but
  // the call must succeed and return a well-formed card).
  const card = await getAgentCard('vitalik.eth');
  ok(
    'agent card well-formed',
    !!card && typeof card.isAgent === 'boolean',
    `isAgent=${card?.isAgent}`
  );

  // A bad name must not throw, just resolve null.
  const bad = await resolveName('definitely-not-a-real-name-xyz-9999.eth');
  ok('unknown name → null (no throw)', bad === null);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
