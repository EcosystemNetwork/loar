/**
 * Live test: canonical x402 (EIP-3009) verification against Arc's real USDC
 * EIP-712 domain. Signs a TransferWithAuthorization with a throwaway key and
 * runs it through verifyPayment() — proving the signature scheme is correct.
 * Does NOT broadcast (settlement needs funds).
 *
 * Run:  cd apps/server && npx tsx scripts/test-arc-x402-live.ts
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { privateKeyToAccount } from 'viem/accounts';
import { usdcDomain, ARC_USDC } from '../src/lib/arc';
import { verifyPayment, parsePaymentHeader, X402_NETWORK } from '../src/lib/x402';

let pass = 0,
  fail = 0;
const ok = (n: string, c: boolean, d = '') =>
  (c ? (pass++, console.log) : (fail++, console.log))(
    `  ${c ? '✓' : '✗'} ${n}${d ? ` — ${d}` : ''}`
  );

// Throwaway key (test only — never funded, never used in prod).
const TEST_PK = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const PAY_TO = '0x80baf7fffc430cdaced4f1d673f4138d6d493077';

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
  console.log('Canonical x402 (EIP-3009) verify — live Arc USDC domain\n');
  const account = privateKeyToAccount(TEST_PK);
  const domain = await usdcDomain();
  console.log(
    `  USDC domain: name="${domain.name}" version="${domain.version}" chainId=${domain.chainId}`
  );
  ok(
    'asset is the Arc USDC system contract',
    domain.verifyingContract.toLowerCase() === ARC_USDC.toLowerCase()
  );

  const now = Math.floor(Date.now() / 1000);
  const auth = {
    from: account.address,
    to: PAY_TO,
    value: '10000', // 0.01 USDC (6-dec)
    validAfter: '0',
    validBefore: String(now + 600),
    nonce: ('0x' + '11'.repeat(32)) as `0x${string}`,
  };

  const signature = await account.signTypedData({
    domain: {
      name: domain.name,
      version: domain.version,
      chainId: domain.chainId,
      verifyingContract: domain.verifyingContract,
    },
    types: TYPES,
    primaryType: 'TransferWithAuthorization',
    message: {
      from: auth.from,
      to: auth.to as `0x${string}`,
      value: BigInt(auth.value),
      validAfter: BigInt(auth.validAfter),
      validBefore: BigInt(auth.validBefore),
      nonce: auth.nonce,
    },
  });

  // Round-trip through the base64 X-PAYMENT header + parser.
  const header = Buffer.from(
    JSON.stringify({
      x402Version: 1,
      scheme: 'exact',
      network: X402_NETWORK,
      payload: { signature, authorization: auth },
    })
  ).toString('base64');
  const payload = parsePaymentHeader(header);
  ok('X-PAYMENT header parses', !!payload);

  const verdict = await verifyPayment(payload!, { payTo: PAY_TO, amountUsdc: '0.01' });
  ok(
    'valid authorization verifies',
    verdict.isValid,
    verdict.isValid ? `payer=${verdict.payer}` : verdict.invalidReason
  );
  ok(
    'recovered payer == signer',
    verdict.isValid && verdict.payer.toLowerCase() === account.address.toLowerCase()
  );

  // Negative: wrong recipient must fail.
  const bad = await verifyPayment(payload!, {
    payTo: '0x000000000000000000000000000000000000dEaD',
    amountUsdc: '0.01',
  });
  ok('wrong payTo rejected', !bad.isValid, bad.isValid ? 'WRONGLY VALID' : bad.invalidReason);

  // Negative: amount above authorized must fail.
  const tooMuch = await verifyPayment(payload!, { payTo: PAY_TO, amountUsdc: '1.0' });
  ok(
    'over-charge rejected',
    !tooMuch.isValid,
    tooMuch.isValid ? 'WRONGLY VALID' : tooMuch.invalidReason
  );

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
