/**
 * Arc live demo — broadcasts REAL testnet transactions (needs a funded key).
 *
 *   A) arc.pay        — a direct USDC transfer on Arc.
 *   B) canonical x402 — sign an EIP-3009 TransferWithAuthorization, then the
 *                       facilitator broadcasts transferWithAuthorization.
 *
 * Fund the relayer address (printed) with Arc testnet USDC at
 * https://faucet.circle.com first. If unfunded, the script tells you the
 * address and exits cleanly (no tx sent).
 *
 * Run:  cd apps/server && npx tsx scripts/arc-demo.ts
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { getSignerAccount } from '../src/lib/signer';
import {
  getUsdcBalance,
  payUsdc,
  usdcDomain,
  settleTransferWithAuthorization,
  verifyUsdcPayment,
  arcTxUrl,
  ARC_TESTNET_ID,
} from '../src/lib/arc';

const RECIPIENT = process.env.X402_PAY_TO || '0x80baf7fffc430cdaced4f1d673f4138d6d493077';

const TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

async function main() {
  if (!process.env.PRIVATE_KEY && !process.env.KMS_KEY_ID) {
    console.error('No PRIVATE_KEY / KMS_KEY_ID set — run the key-gen step first.');
    process.exit(2);
  }
  const account = await getSignerAccount();
  const relayer = account.address;
  console.log(`Arc testnet (chain ${ARC_TESTNET_ID})`);
  console.log(`Relayer/signer: ${relayer}`);

  let balance: string;
  try {
    balance = await getUsdcBalance(relayer);
  } catch (err) {
    console.log(
      `⏳ Arc RPC read failed (transient): ${err instanceof Error ? err.message.split('\n')[0] : err}`
    );
    process.exit(3); // not ready — let the poller retry
  }
  console.log(`USDC balance:   ${balance}\n`);

  if (Number(balance) < 0.03) {
    console.log('⚠️  Not enough USDC to broadcast. Fund the relayer, then re-run:');
    console.log(`    1. Go to https://faucet.circle.com → select Arc Testnet`);
    console.log(`    2. Paste: ${relayer}`);
    console.log(`    3. Re-run: npx tsx scripts/arc-demo.ts`);
    process.exit(3); // distinct "unfunded" code for the auto-poller
  }

  // ── A) Direct USDC transfer ────────────────────────────────────────────────
  console.log('[A] arc.pay — direct USDC transfer (0.01 USDC)…');
  const pay = await payUsdc({ to: RECIPIENT, amountUsdc: '0.01' });
  console.log(`    tx: ${arcTxUrl(pay.txHash)}`);

  // ── B) Canonical x402 EIP-3009 settle ──────────────────────────────────────
  console.log('\n[B] x402 — sign EIP-3009 authorization, facilitator settles (0.01 USDC)…');
  const domain = await usdcDomain();
  const now = Math.floor(Date.now() / 1000);
  const auth = {
    from: relayer,
    to: RECIPIENT,
    value: '10000', // 0.01 USDC, 6-dec
    validAfter: '0',
    validBefore: String(now + 600),
    nonce: ('0x' + randomBytes(32).toString('hex')) as `0x${string}`,
  };
  const signature = await account.signTypedData!({
    domain: {
      name: domain.name,
      version: domain.version,
      chainId: domain.chainId,
      verifyingContract: domain.verifyingContract,
    },
    types: TYPES,
    primaryType: 'TransferWithAuthorization',
    message: {
      from: auth.from as `0x${string}`,
      to: auth.to as `0x${string}`,
      value: BigInt(auth.value),
      validAfter: BigInt(auth.validAfter),
      validBefore: BigInt(auth.validBefore),
      nonce: auth.nonce,
    },
  });
  const settleTx = await settleTransferWithAuthorization(auth, signature);
  console.log(`    tx: ${arcTxUrl(settleTx)}`);

  // Confirm the settle actually moved USDC to the recipient.
  const verified = await verifyUsdcPayment({ txHash: settleTx, payTo: RECIPIENT, minUsdc: '0.01' });
  console.log(
    `    verified on-chain: ${verified ? `yes (${verified.amountRaw} raw)` : 'PENDING/NO'}`
  );

  console.log('\n✅ Done. Submission tx hashes:');
  console.log(`   arc.pay : ${pay.txHash}`);
  console.log(`   x402    : ${settleTx}`);
  process.exit(0);
}
main().catch((e) => {
  console.error('FATAL', e instanceof Error ? e.message : e);
  process.exit(1);
});
