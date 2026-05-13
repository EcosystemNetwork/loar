/**
 * Transfer program upgrade authority — print + verify utility.
 *
 * NEVER auto-executes; this script prints the exact `solana program
 * set-upgrade-authority` commands the operator should run, then verifies
 * the result. The intent is a single source of truth for the runbook:
 * universe + episode + payment programs all hand off in one go.
 *
 * Why a script instead of a one-liner: each program upgrade authority must
 * be changed independently, and a bad NEW_AUTHORITY value locks the program
 * forever. Printing the commands lets the operator copy-paste-confirm each.
 *
 * Usage:
 *   pnpm tsx apps/programs/scripts/transfer-upgrade-authority.ts <NEW_AUTHORITY>
 *
 *   # After running the printed commands:
 *   pnpm tsx apps/programs/scripts/transfer-upgrade-authority.ts <NEW_AUTHORITY> --verify
 *
 * For a Squads multisig destination, NEW_AUTHORITY is the multisig's vault
 * PDA. Derive via apps/server/scripts/squads-derive-vault.ts (TODO).
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../../.env') });

const PROGRAMS: Array<{ name: string; programId: string }> = [
  { name: 'universe', programId: '6YTQVSeauk4x5gycMM2wzkR8mdHEnHAYsz3Ygg26UPtD' },
  { name: 'episode', programId: 'voLiAXoYbq8go1CUS9UshQRZnNu9Y44qNBZ6czgn8Bs' },
  { name: 'payment', programId: '9xWo4djcHmGFkJnLQF9phdpsUhj6BQFW6yR8sHUsKVbj' },
];

const cluster = process.env.SOLANA_CLUSTER ?? 'devnet';
const newAuthority = process.argv[2];
const verifyOnly = process.argv.includes('--verify');

function getAuthority(programId: string): string | null {
  try {
    const out = execSync(`solana program show ${programId} --url ${cluster}`, {
      encoding: 'utf-8',
    });
    const m = out.match(/Authority:\s+(\S+)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

if (!newAuthority) {
  console.error('Usage: pnpm tsx transfer-upgrade-authority.ts <NEW_AUTHORITY> [--verify]');
  process.exit(1);
}

console.log(`Cluster:       ${cluster}`);
console.log(`New authority: ${newAuthority}`);
console.log(`Verify only:   ${verifyOnly}`);
console.log('');

if (verifyOnly) {
  let drift = 0;
  for (const p of PROGRAMS) {
    const auth = getAuthority(p.programId);
    const ok = auth === newAuthority;
    if (!ok) drift++;
    console.log(
      `  ${ok ? '✓' : '✗'} ${p.name.padEnd(10)} authority=${auth ?? '<error>'} (want ${newAuthority})`
    );
  }
  process.exit(drift === 0 ? 0 : 2);
}

console.log('Run these commands to transfer authority for each program:');
console.log('');
for (const p of PROGRAMS) {
  console.log(
    `  solana program set-upgrade-authority ${p.programId} --new-upgrade-authority ${newAuthority} --url ${cluster}`
  );
}
console.log('');
console.log('Then re-run this script with --verify to confirm.');
console.log(
  'WARNING: a bad NEW_AUTHORITY value (typo, wrong cluster, etc) bricks the program forever.'
);
