/**
 * One-time bridge signer bootstrap.
 *
 * Provisions the two Circle DCW wallets that will sign destination-side mints
 * for the custodial $LOAR bridge — one per chain. Idempotent: re-running
 * returns the same wallet ids + addresses.
 *
 * After running, the operator must:
 *   1. Transfer EVM $LOAR mint authority to the EVM address printed below.
 *   2. Transfer SPL $LOAR mint authority to the Solana address printed below
 *      (spl-token authorize <mint> mint <addr> --url devnet).
 *   3. Set the printed wallet ids in .env:
 *        CIRCLE_BRIDGE_SIGNER_ID_EVM=<id>
 *        CIRCLE_BRIDGE_SIGNER_ID_SOL=<id>
 *   4. Restart the server. /api/bridge/quote will return 200 with
 *      backend="custodial".
 *
 * Usage:
 *   pnpm tsx apps/server/scripts/bridge-bootstrap.ts
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../../.env') });

// Dynamic import after dotenv so the module reads the loaded env vars.
const { bootstrapBridgeSigners } = await import('../src/lib/bridge-custodial');

const result = await bootstrapBridgeSigners();
console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  Bridge signers provisioned');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('');
console.log('  EVM:');
console.log(`    Wallet ID: ${result.evmWalletId}`);
console.log(`    Address:   ${result.evmAddress}`);
console.log('');
console.log('  Solana:');
console.log(`    Wallet ID: ${result.solWalletId}`);
console.log(`    Address:   ${result.solAddress}`);
console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  Next steps');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('');
console.log('  1. Transfer mint authority on $LOAR (EVM) to:');
console.log(`       ${result.evmAddress}`);
console.log('     e.g. cast send $LOAR_TOKEN_ADDRESS "transferOwnership(address)" \\');
console.log(`           ${result.evmAddress}`);
console.log('');
console.log('  2. Transfer SPL $LOAR mint authority to:');
console.log(`       ${result.solAddress}`);
console.log(`     spl-token authorize $LOAR_MINT mint ${result.solAddress} \\`);
console.log('           --url devnet');
console.log('');
console.log('  3. Add to .env:');
console.log(`       CIRCLE_BRIDGE_SIGNER_ID_EVM=${result.evmWalletId}`);
console.log(`       CIRCLE_BRIDGE_SIGNER_ID_SOL=${result.solWalletId}`);
console.log('');
console.log('  4. Restart server. /api/bridge/quote → 200 with backend="custodial".');
console.log('');
