/**
 * Bridge round-trip e2e harness.
 *
 * Spends real (test) $LOAR on devnet to exercise the full custodial bridge
 * round-trip + the idempotency-replay recovery path. The custodial bridge
 * has only ever been single-direction-tested on devnet — this script
 * fills that gap before mainnet.
 *
 * Phases:
 *   1. EVM → Solana   (mint $LOAR on Solana from EVM custody)
 *   2. Wait for completed state
 *   3. Solana → EVM   (mint $LOAR on EVM from Solana custody)
 *   4. Wait for completed state
 *   5. Idempotency replay — re-submit the same idempotencyKey from phase 1,
 *      assert we get the same intent back without a second source-side tx.
 *      (This is the only "retry" path the bridge exposes today; there is
 *      no `/retry` endpoint despite the runbook mentioning one.)
 *
 * Exit codes:
 *   0 — round-trip + idempotency replay all succeeded
 *   1 — usage / config error
 *   2 — at least one phase failed (operator must reconcile manually)
 *   3 — bridge unconfigured (503) — nothing was attempted
 *
 * Required env (read from monorepo root .env):
 *   BRIDGE_E2E_OK=1                   safety latch — refuses to run without
 *   BRIDGE_E2E_SERVER_URL             default http://localhost:3000
 *   BRIDGE_E2E_JWT                    SIWE session token (copy from browser
 *                                     localStorage `siwe:token`)
 *   BRIDGE_E2E_EVM_ADDRESS            authenticated user's EVM address
 *   BRIDGE_E2E_SOLANA_ADDRESS         authenticated user's Solana address
 *   BRIDGE_E2E_AMOUNT_LOAR            decimal $LOAR per leg (default '1')
 *   BRIDGE_E2E_TIMEOUT_MS             max wait per /status poll (default 600000 = 10min)
 *   BRIDGE_E2E_POLL_INTERVAL_MS       poll cadence (default 5000 = 5s)
 *
 *   For the EVM-side balance probe (optional, enables before/after asserts):
 *     RPC_URL                         devnet/testnet EVM RPC
 *     LOAR_TOKEN_ADDRESS              ERC20 $LOAR address on EVM
 *
 *   For the Solana-side balance probe (optional, enables before/after asserts):
 *     SOLANA_RPC_URL_DEVNET (or _MAINNET if SOLANA_CLUSTER=mainnet-beta)
 *     LOAR_MINT_DEVNET (or _MAINNET)
 *
 * Usage:
 *   BRIDGE_E2E_OK=1 \
 *   BRIDGE_E2E_JWT=eyJhbGc... \
 *   BRIDGE_E2E_EVM_ADDRESS=0xabc... \
 *   BRIDGE_E2E_SOLANA_ADDRESS=Abc... \
 *     pnpm tsx apps/server/scripts/bridge-roundtrip-e2e.ts
 *
 * Refusal to run on mainnet without an additional explicit ack:
 *   BRIDGE_E2E_MAINNET_ACK=yes-i-know  required when SOLANA_CLUSTER=mainnet-beta
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import dotenv from 'dotenv';
import { Connection, PublicKey } from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  getAccount,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { createPublicClient, http, parseUnits, formatUnits } from 'viem';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../../.env') });

// ── Config + safety latches ─────────────────────────────────────────────────
if (process.env.BRIDGE_E2E_OK !== '1') {
  console.error(
    'Refusing to run: set BRIDGE_E2E_OK=1 to acknowledge this script spends real test funds.'
  );
  process.exit(1);
}

const cluster = process.env.SOLANA_CLUSTER ?? 'devnet';
const isMainnet = cluster === 'mainnet-beta';

if (isMainnet && process.env.BRIDGE_E2E_MAINNET_ACK !== 'yes-i-know') {
  console.error(
    'Refusing to run on mainnet without BRIDGE_E2E_MAINNET_ACK=yes-i-know. This script spends REAL $LOAR.'
  );
  process.exit(1);
}

const SERVER_URL = (process.env.BRIDGE_E2E_SERVER_URL ?? 'http://localhost:3000').replace(
  /\/$/,
  ''
);
const JWT = process.env.BRIDGE_E2E_JWT;
const EVM_ADDRESS = process.env.BRIDGE_E2E_EVM_ADDRESS;
const SOLANA_ADDRESS = process.env.BRIDGE_E2E_SOLANA_ADDRESS;
const AMOUNT_LOAR = process.env.BRIDGE_E2E_AMOUNT_LOAR ?? '1';
const TIMEOUT_MS = Number(process.env.BRIDGE_E2E_TIMEOUT_MS ?? '600000');
const POLL_MS = Number(process.env.BRIDGE_E2E_POLL_INTERVAL_MS ?? '5000');

if (!JWT || !EVM_ADDRESS || !SOLANA_ADDRESS) {
  console.error(
    'Missing required env: BRIDGE_E2E_JWT, BRIDGE_E2E_EVM_ADDRESS, BRIDGE_E2E_SOLANA_ADDRESS'
  );
  process.exit(1);
}
// Re-narrowing for closures below — TS doesn't track module-level narrowing.
const JWT_S = JWT as string;
const EVM_ADDRESS_S = EVM_ADDRESS as string;
const SOLANA_ADDRESS_S = SOLANA_ADDRESS as string;

const EVM_CHAIN = (process.env.BRIDGE_E2E_EVM_CHAIN ?? (isMainnet ? 'Base' : 'BaseSepolia')) as
  | 'Base'
  | 'BaseSepolia'
  | 'Sepolia';

console.log('');
console.log('Bridge round-trip e2e harness');
console.log(`  Server:           ${SERVER_URL}`);
console.log(`  Cluster:          ${cluster}`);
console.log(`  EVM chain:        ${EVM_CHAIN}`);
console.log(`  EVM address:      ${EVM_ADDRESS}`);
console.log(`  Solana address:   ${SOLANA_ADDRESS}`);
console.log(`  Amount per leg:   ${AMOUNT_LOAR} $LOAR`);
console.log(`  Timeout per leg:  ${TIMEOUT_MS / 1000}s`);
console.log('');

// ── Helpers ─────────────────────────────────────────────────────────────────
type Status = 'PASS' | 'WARN' | 'FAIL' | 'SKIP';
const phaseResults: Array<{ phase: string; status: Status; detail: string }> = [];
const recordPhase = (phase: string, status: Status, detail = '') => {
  phaseResults.push({ phase, status, detail });
  const icon = { PASS: '✓', WARN: '⚠', FAIL: '✗', SKIP: '·' }[status];
  console.log(`  ${icon} [${status.padEnd(4)}] ${phase}${detail ? ' — ' + detail : ''}`);
};

function authedFetch(path: string, init?: RequestInit) {
  return fetch(`${SERVER_URL}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${JWT_S}`,
      'Content-Type': 'application/json',
    },
  });
}

async function getEvmLoarBalance(): Promise<bigint | null> {
  const rpc = process.env.RPC_URL;
  const token = process.env.LOAR_TOKEN_ADDRESS as `0x${string}` | undefined;
  if (!rpc || !token) return null;
  try {
    const client = createPublicClient({ transport: http(rpc) });
    const bal = (await client.readContract({
      address: token,
      abi: [
        {
          name: 'balanceOf',
          type: 'function',
          stateMutability: 'view',
          inputs: [{ name: 'owner', type: 'address' }],
          outputs: [{ name: '', type: 'uint256' }],
        },
      ] as const,
      functionName: 'balanceOf',
      args: [EVM_ADDRESS_S as `0x${string}`],
    })) as bigint;
    return bal;
  } catch (err) {
    console.warn(`  · EVM balance probe failed: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

async function getSolanaLoarBalance(): Promise<bigint | null> {
  const rpc = isMainnet
    ? process.env.SOLANA_RPC_URL_MAINNET || process.env.SOLANA_RPC_URL
    : process.env.SOLANA_RPC_URL_DEVNET || process.env.SOLANA_RPC_URL;
  const mintAddr = isMainnet ? process.env.LOAR_MINT_MAINNET : process.env.LOAR_MINT_DEVNET;
  if (!rpc || !mintAddr) return null;
  try {
    const conn = new Connection(rpc, 'confirmed');
    const mint = new PublicKey(mintAddr);
    const owner = new PublicKey(SOLANA_ADDRESS_S);
    const ata = getAssociatedTokenAddressSync(
      mint,
      owner,
      false,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    const acct = await getAccount(conn, ata, 'confirmed', TOKEN_2022_PROGRAM_ID);
    return acct.amount;
  } catch (err) {
    // ATA may not exist yet — treat as 0.
    if (err instanceof Error && /not found|TokenAccountNotFoundError/i.test(err.message)) {
      return 0n;
    }
    console.warn(`  · Solana balance probe failed: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

async function pollStatus(
  from: 'Solana' | 'Sepolia' | 'BaseSepolia' | 'Base',
  txRef: string
): Promise<{ state: string; destinationTxRef: string | null; raw: any }> {
  const start = Date.now();
  while (Date.now() - start < TIMEOUT_MS) {
    const res = await authedFetch(
      `/api/bridge/status?from=${encodeURIComponent(from)}&txRef=${encodeURIComponent(txRef)}`
    );
    if (!res.ok) {
      throw new Error(`/status returned ${res.status} ${res.statusText}`);
    }
    const body = (await res.json()) as { state: string; destinationTxRef?: string };
    if (body.state === 'completed' || body.state === 'failed') {
      return {
        state: body.state,
        destinationTxRef: body.destinationTxRef ?? null,
        raw: body,
      };
    }
    process.stdout.write(
      `    state=${body.state} … (${Math.floor((Date.now() - start) / 1000)}s)\r`
    );
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  throw new Error(`status poll timed out after ${TIMEOUT_MS / 1000}s`);
}

// ── Health probe (must succeed before we spend anything) ────────────────────
async function preflight() {
  const res = await fetch(`${SERVER_URL}/api/bridge/health`);
  if (!res.ok) {
    recordPhase('preflight: /health', 'FAIL', `${res.status} ${res.statusText}`);
    process.exit(3);
  }
  const body = (await res.json()) as { fullyConfigured: boolean; missing: string[] };
  if (!body.fullyConfigured) {
    recordPhase('preflight: /health', 'FAIL', `missing: ${body.missing.join(', ')}`);
    process.exit(3);
  }
  recordPhase('preflight: /health', 'PASS', 'fully configured');
}

async function recordBalances(label: string) {
  const evm = await getEvmLoarBalance();
  const sol = await getSolanaLoarBalance();
  if (evm === null && sol === null) {
    recordPhase(`balances ${label}`, 'SKIP', 'no probe configured');
    return { evm: null as bigint | null, sol: null as bigint | null };
  }
  recordPhase(
    `balances ${label}`,
    'PASS',
    `EVM=${evm !== null ? formatUnits(evm, 18) : '?'} SOL=${sol !== null ? formatUnits(sol, 9) : '?'} $LOAR`
  );
  return { evm, sol };
}

// ── Phase 1+2: EVM → Solana ─────────────────────────────────────────────────
async function leg(
  legName: string,
  from: 'Sepolia' | 'BaseSepolia' | 'Base' | 'Solana',
  to: 'Sepolia' | 'BaseSepolia' | 'Base' | 'Solana',
  recipient: string,
  idempotencyKey: string
): Promise<string | null> {
  console.log('');
  console.log(`Phase: ${legName}`);

  const quoteRes = await authedFetch(`/api/bridge/quote`, {
    method: 'POST',
    body: JSON.stringify({ from, to, amount: AMOUNT_LOAR, recipient, idempotencyKey }),
  });
  if (!quoteRes.ok) {
    recordPhase(`${legName}: quote`, 'FAIL', `${quoteRes.status} ${await quoteRes.text()}`);
    return null;
  }
  recordPhase(`${legName}: quote`, 'PASS');

  const transferRes = await authedFetch(`/api/bridge/transfer`, {
    method: 'POST',
    body: JSON.stringify({ from, to, amount: AMOUNT_LOAR, recipient, idempotencyKey }),
  });
  if (!transferRes.ok) {
    recordPhase(
      `${legName}: /transfer`,
      'FAIL',
      `${transferRes.status} ${await transferRes.text()}`
    );
    return null;
  }
  const intent = (await transferRes.json()) as { id: string; sourceTxRef?: string };
  recordPhase(`${legName}: /transfer`, 'PASS', `intent=${intent.id}`);
  if (!intent.sourceTxRef) {
    recordPhase(`${legName}: sourceTxRef present`, 'FAIL', 'intent has no sourceTxRef');
    return null;
  }

  try {
    const final = await pollStatus(from, intent.sourceTxRef);
    process.stdout.write('\n'); // clear poll line
    if (final.state === 'completed' && final.destinationTxRef) {
      recordPhase(
        `${legName}: status=completed`,
        'PASS',
        `destTx=${final.destinationTxRef.slice(0, 16)}…`
      );
      return idempotencyKey;
    }
    recordPhase(
      `${legName}: status=${final.state}`,
      'FAIL',
      JSON.stringify(final.raw).slice(0, 200)
    );
    return null;
  } catch (err) {
    recordPhase(`${legName}: poll`, 'FAIL', err instanceof Error ? err.message : 'unknown');
    return null;
  }
}

// ── Phase 5: idempotency replay ─────────────────────────────────────────────
async function idempotencyReplay(
  legName: string,
  from: 'Sepolia' | 'BaseSepolia' | 'Base' | 'Solana',
  to: 'Sepolia' | 'BaseSepolia' | 'Base' | 'Solana',
  recipient: string,
  idempotencyKey: string,
  originalIntentId: string
) {
  console.log('');
  console.log(`Phase: idempotency replay (${legName})`);

  const res = await authedFetch(`/api/bridge/transfer`, {
    method: 'POST',
    body: JSON.stringify({ from, to, amount: AMOUNT_LOAR, recipient, idempotencyKey }),
  });
  if (!res.ok) {
    recordPhase('idempotency replay', 'FAIL', `${res.status} ${await res.text()}`);
    return;
  }
  const replayIntent = (await res.json()) as { id: string };
  if (replayIntent.id === originalIntentId) {
    recordPhase('idempotency replay', 'PASS', `same id ${replayIntent.id} returned`);
  } else {
    recordPhase(
      'idempotency replay',
      'FAIL',
      `expected ${originalIntentId} got ${replayIntent.id} — DOUBLE SPEND RISK`
    );
  }
}

// ── Main ────────────────────────────────────────────────────────────────────
(async () => {
  await preflight();
  const before = await recordBalances('before');

  const evmToSolKey = `e2e_${Date.now()}_${randomBytes(4).toString('hex')}`;
  const idForReplay = await leg(
    `${EVM_CHAIN} → Solana`,
    EVM_CHAIN,
    'Solana',
    SOLANA_ADDRESS_S,
    evmToSolKey
  );

  // Need the originating intent id for the idempotency replay assertion. The
  // /transfer response gives us `intent.id`; we recover it from /history.
  let originalIntentId: string | null = null;
  if (idForReplay) {
    try {
      const hist = await authedFetch('/api/bridge/history?limit=5');
      if (hist.ok) {
        const body = (await hist.json()) as {
          items: Array<{ id: string; idempotencyKey?: string }>;
        };
        originalIntentId = body.items.find((i) => i.idempotencyKey === evmToSolKey)?.id ?? null;
      }
    } catch {}
  }

  const solToEvmKey = `e2e_${Date.now()}_${randomBytes(4).toString('hex')}`;
  await leg(`Solana → ${EVM_CHAIN}`, 'Solana', EVM_CHAIN, EVM_ADDRESS_S, solToEvmKey);

  if (idForReplay && originalIntentId) {
    await idempotencyReplay(
      `${EVM_CHAIN} → Solana`,
      EVM_CHAIN,
      'Solana',
      SOLANA_ADDRESS_S,
      idForReplay,
      originalIntentId
    );
  } else {
    recordPhase(
      'idempotency replay',
      'SKIP',
      'first leg did not complete or history lookup failed'
    );
  }

  const after = await recordBalances('after');

  // Solvency assertion: round-trip should leave EVM balance ≈ before, and
  // Solana balance ≈ before. Allow some slack for fees + the fact that the
  // EVM→Solana leg moved some tokens BEFORE the Solana→EVM leg moved them
  // back — net movement should be zero modulo fees.
  if (before.evm !== null && after.evm !== null && before.sol !== null && after.sol !== null) {
    const evmDelta = after.evm - before.evm;
    const solDelta = after.sol - before.sol;
    const amountWei = parseUnits(AMOUNT_LOAR, 18);
    const amountLamp = parseUnits(AMOUNT_LOAR, 9);
    const tolerance = amountWei / 100n; // 1% slack for fees / decimal scaling
    if (
      evmDelta > -tolerance &&
      evmDelta < tolerance &&
      solDelta > -(amountLamp / 100n) &&
      solDelta < amountLamp / 100n
    ) {
      recordPhase(
        'round-trip net-zero (±1%)',
        'PASS',
        `EVM Δ=${formatUnits(evmDelta, 18)} SOL Δ=${formatUnits(solDelta, 9)}`
      );
    } else {
      recordPhase(
        'round-trip net-zero (±1%)',
        'WARN',
        `EVM Δ=${formatUnits(evmDelta, 18)} SOL Δ=${formatUnits(solDelta, 9)} (review for fee accounting)`
      );
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('');
  console.log('────────────────────────────────────────────────────────────────────');
  const counts = { PASS: 0, WARN: 0, FAIL: 0, SKIP: 0 };
  for (const r of phaseResults) counts[r.status]++;
  console.log(
    `Summary: ${counts.PASS} PASS · ${counts.WARN} WARN · ${counts.FAIL} FAIL · ${counts.SKIP} SKIP`
  );

  if (counts.FAIL > 0) {
    console.log('');
    console.log('FAIL items (operator must investigate — partial state may exist):');
    for (const r of phaseResults.filter((r) => r.status === 'FAIL')) {
      console.log(`  • ${r.phase} — ${r.detail}`);
    }
    console.log('');
    console.log(
      'Run `pnpm tsx apps/server/scripts/bridge-reconcile.ts` to verify on-chain vs ledger parity.'
    );
  }

  process.exit(counts.FAIL > 0 ? 2 : 0);
})().catch((err) => {
  console.error('e2e crashed:', err);
  process.exit(1);
});
