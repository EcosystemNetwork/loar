/**
 * Live integration test for the Uniswap Trading API adapter.
 *
 * Exercises the REAL adapter against the REAL Trading API (Sepolia):
 *   quote → check_approval → swap calldata → pre-sign safety gates.
 * The only step it can't reach without Circle creds is the final on-chain
 * broadcast — so for the native path we assert executeSwap runs the whole
 * pipeline and fails *only* at the Circle boundary (proving everything before
 * it worked on live data).
 *
 * Run:  cd apps/server && npx tsx scripts/test-uniswap-live.ts
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import {
  getQuote,
  checkApproval,
  executeSwap,
  isKnownRouter,
  assertSwapTxSafe,
  NATIVE_TOKEN,
} from '../src/lib/uniswap-trading-api';

const SEPOLIA = 11155111;
const UNI = '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984';
const USDC = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';
const SWAPPER = '0x80baf7fffc430cdaced4f1d673f4138d6d493077';
const AMT = '1000000000000000'; // 0.001 ETH

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail = '') {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function main() {
  if (!process.env.UNISWAP_API_KEY) {
    console.error('UNISWAP_API_KEY not set in root .env — cannot run live test.');
    process.exit(2);
  }
  console.log('Uniswap Trading API — live integration (Sepolia)\n');

  // 1. Live quote: native ETH → UNI
  console.log('[1] getQuote ETH→UNI');
  const q = await getQuote({
    swapper: SWAPPER,
    tokenIn: NATIVE_TOKEN,
    tokenOut: UNI,
    amount: AMT,
    chainId: SEPOLIA,
  });
  ok('routing returned', !!q.routing, q.routing);
  ok('positive output amount', BigInt(q.quote.output?.amount ?? '0') > 0n, q.quote.output?.amount);
  ok('native input has no permitData', !q.permitData);

  // 2. Full executeSwap pipeline reaches the Circle boundary (native path).
  //    Without Circle creds it must throw a Circle-config error — NOT a quote
  //    or safety-gate error. That proves quote + swap-build + gates all passed.
  console.log('\n[2] executeSwap ETH→UNI runs pipeline to the Circle boundary');
  let reachedCircle = false;
  let gateError = '';
  try {
    await executeSwap({
      wallet: { walletId: 'live-test-no-circle', address: SWAPPER },
      tokenIn: NATIVE_TOKEN,
      tokenOut: UNI,
      amount: AMT,
      chainId: SEPOLIA,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/CIRCLE_API_KEY|Circle|entity secret|CIRCLE_ENTITY_SECRET/i.test(msg)) {
      reachedCircle = true;
    } else {
      gateError = msg;
    }
  }
  ok(
    'passed quote + swap-build + safety gates, failed only at Circle',
    reachedCircle,
    gateError || 'reached executeTransaction'
  );

  // 3. ERC20 input path: check_approval + quote shape (UNI → USDC)
  console.log('\n[3] ERC20 path UNI→USDC: check_approval + permitData');
  const approval = await checkApproval({
    walletAddress: SWAPPER,
    token: UNI,
    amount: '1000000000000000000',
    chainId: SEPOLIA,
  });
  // approval is null if already approved, else its target must be the input token
  ok(
    'approval (if any) targets the input token',
    approval === null || approval.to.toLowerCase() === UNI.toLowerCase(),
    approval ? approval.to : 'already approved / none'
  );

  // 4. Safety gate accepts the REAL swap target, rejects tampered ones.
  console.log('\n[4] safety gates against live router');
  // Re-fetch a real /swap to read the actual router `to`.
  const swapResp = await fetch(
    (process.env.UNISWAP_TRADING_API_BASE || 'https://trade-api.gateway.uniswap.org/v1') + '/swap',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.UNISWAP_API_KEY!,
        'User-Agent': 'LOAR/1.0 (+https://loar.fun)',
      },
      body: JSON.stringify({ quote: q.quote }),
    }
  ).then((r) => r.json() as Promise<{ swap: { to: string; value?: string } }>);
  const realTo = swapResp.swap.to;
  ok('live swap.to is a known router', isKnownRouter(SEPOLIA, realTo), realTo);

  // gate accepts the real (router, value)
  let gateAccepted = true;
  try {
    assertSwapTxSafe({
      chainId: SEPOLIA,
      nativeIn: true,
      type: 'EXACT_INPUT',
      to: realTo,
      value: swapResp.swap.value,
      amount: AMT,
    });
  } catch {
    gateAccepted = false;
  }
  ok('gate accepts live swap (router + exact native value)', gateAccepted);

  // gate rejects a tampered target
  let rejectedTamper = false;
  try {
    assertSwapTxSafe({
      chainId: SEPOLIA,
      nativeIn: true,
      type: 'EXACT_INPUT',
      to: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      value: AMT,
      amount: AMT,
    });
  } catch {
    rejectedTamper = true;
  }
  ok('gate rejects a tampered router target', rejectedTamper);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
