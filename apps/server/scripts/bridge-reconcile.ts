/**
 * Bridge reconciliation — ops/cron utility.
 *
 * Verifies the invariant:
 *   sum(intent.amount where state in [pending_destination, completed])
 *     == vault.balance
 *
 * Exits with code 0 on parity and 2 on drift so a cron + `||` pager can wire
 * an alert. Run hourly:
 *
 *   * * * * *  cd /app && pnpm tsx apps/server/scripts/bridge-reconcile.ts
 *
 * Output is machine-readable (one line per direction) so it grep-pipes cleanly
 * into prometheus textfile exporter, etc.
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../../.env') });

import { reconcileBridge, isCustodialBridgeConfigured } from '../src/lib/bridge-custodial';

async function main() {
  if (!isCustodialBridgeConfigured()) {
    console.error('Custodial bridge not configured — exiting');
    process.exit(1);
  }
  const results = await reconcileBridge();
  let hasDrift = false;
  for (const r of results) {
    const driftN = BigInt(r.driftBaseUnits);
    const flag = driftN === 0n ? 'OK' : driftN > 0n ? 'POS_DRIFT' : 'NEG_DRIFT_ALERT';
    if (driftN !== 0n) hasDrift = true;
    console.log(
      `${flag} direction=${r.direction} ledger=${r.ledgerLockedBaseUnits} vault=${r.vaultBalanceBaseUnits} drift=${r.driftBaseUnits} intents=${r.intentCount}`
    );
  }
  process.exit(hasDrift ? 2 : 0);
}

main().catch((err) => {
  console.error('reconcile failed:', err);
  process.exit(1);
});
