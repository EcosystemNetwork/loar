/**
 * Mainnet runbook dry-run.
 *
 * Walks every step of `docs/solana-mainnet-runbook.md` against a target
 * cluster (default: devnet) WITHOUT executing any deploy/transfer/mint
 * tx. The point is to flush "missing script", "wrong env var name",
 * "step ordering", and "stale binary" bugs **before** they cost real
 * mainnet SOL.
 *
 * Each step prints PASS / WARN / FAIL with a one-line reason; the script
 * exits non-zero on any FAIL so it pipes cleanly into a CI gate.
 *
 * Usage:
 *   pnpm tsx apps/programs/scripts/mainnet-runbook-dryrun.ts                    # devnet
 *   SOLANA_CLUSTER=mainnet-beta pnpm tsx apps/programs/scripts/mainnet-runbook-dryrun.ts
 *
 * Flags:
 *   --skip-rpc      don't make any RPC calls (env-only audit)
 *   --verbose       echo the resolved env var values (NEVER for mainnet!)
 *
 * Exit codes:
 *   0 — all checks passed (cluster ready)
 *   1 — usage / unexpected error
 *   2 — at least one FAIL (cluster NOT ready)
 *
 * What this does NOT do:
 *   - Run `anchor deploy` (real spend, real keypair).
 *   - Transfer upgrade authority (irreversible).
 *   - Initialize the payment Config PDA (mutates on-chain state).
 *   - Create a Bubblegum tree (real spend).
 *
 * Read each FAIL/WARN against the corresponding runbook step before
 * acting. The dry-run is advisory; the runbook is authoritative.
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import { homedir } from 'node:os';
import dotenv from 'dotenv';
import { Connection, PublicKey } from '@solana/web3.js';
import { getMint, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../../.env') });

type Status = 'PASS' | 'WARN' | 'FAIL' | 'SKIP';
interface Result {
  step: string;
  check: string;
  status: Status;
  detail: string;
}
const results: Result[] = [];
const log = (step: string, check: string, status: Status, detail: string) => {
  results.push({ step, check, status, detail });
  const icon = { PASS: '✓', WARN: '⚠', FAIL: '✗', SKIP: '·' }[status];
  const color = { PASS: '\x1b[32m', WARN: '\x1b[33m', FAIL: '\x1b[31m', SKIP: '\x1b[90m' }[status];
  const reset = '\x1b[0m';
  console.log(`  ${color}${icon}${reset} [${status.padEnd(4)}] ${check.padEnd(56)} ${detail}`);
};

const SKIP_RPC = process.argv.includes('--skip-rpc');
const VERBOSE = process.argv.includes('--verbose');
const cluster = process.env.SOLANA_CLUSTER ?? 'devnet';
const isMainnet = cluster === 'mainnet-beta';

console.log('');
console.log(`Mainnet Runbook Dry-Run`);
console.log(`Cluster:    ${cluster}`);
console.log(`Skip RPC:   ${SKIP_RPC}`);
console.log(`Verbose:    ${VERBOSE}`);
console.log('');

if (isMainnet) {
  console.warn(
    `\x1b[33m⚠  cluster=mainnet-beta — this script will only READ chain state, but be sure no other terminal is mid-deploy.\x1b[0m`
  );
  console.log('');
}

// ── Step 1: CLI cluster ─────────────────────────────────────────────────────
console.log('Step 1 — solana CLI cluster');
function step1() {
  let cliCluster = '';
  try {
    cliCluster = execSync('solana config get json_rpc_url', { encoding: 'utf-8' })
      .trim()
      .split('\n')
      .pop()!
      .replace(/^RPC URL:\s*/, '');
  } catch {
    log('1', 'solana CLI installed', 'FAIL', '`solana` not found in $PATH');
    return;
  }
  log('1', 'solana CLI installed', 'PASS', cliCluster);

  if (isMainnet && !cliCluster.includes('mainnet')) {
    log(
      '1',
      'CLI cluster matches SOLANA_CLUSTER',
      'WARN',
      `CLI=${cliCluster} but SOLANA_CLUSTER=mainnet-beta`
    );
  } else if (!isMainnet && cliCluster.includes('mainnet')) {
    log(
      '1',
      'CLI cluster matches SOLANA_CLUSTER',
      'WARN',
      `CLI=${cliCluster} but SOLANA_CLUSTER=devnet (CLI commands will hit mainnet)`
    );
  } else {
    log('1', 'CLI cluster matches SOLANA_CLUSTER', 'PASS', '');
  }

  try {
    const balance = execSync('solana balance', { encoding: 'utf-8' }).trim();
    const sol = parseFloat(balance);
    const minRequired = isMainnet ? 12 : 1;
    if (isNaN(sol)) {
      log('1', 'deployer balance', 'WARN', `unreadable: "${balance}"`);
    } else if (sol < minRequired) {
      log('1', 'deployer balance', 'FAIL', `${sol} SOL < required ${minRequired}`);
    } else {
      log('1', 'deployer balance', 'PASS', `${balance}`);
    }
  } catch {
    log('1', 'deployer balance', 'FAIL', 'solana balance failed');
  }

  try {
    const addr = execSync('solana address', { encoding: 'utf-8' }).trim();
    log('1', 'deployer address', 'PASS', addr);
  } catch {
    log('1', 'deployer address', 'FAIL', 'solana address failed');
  }
}
step1();

// ── Step 2: program binaries + keypairs ─────────────────────────────────────
console.log('');
console.log('Step 2 — program binaries + keypairs');
const PROGRAMS = ['universe', 'episode', 'payment'] as const;
const programsDir = resolve(__dirname, '..');
function step2() {
  const buildDir = resolve(programsDir, 'target/deploy');
  if (!fs.existsSync(buildDir)) {
    log('2', 'target/deploy exists', 'FAIL', `${buildDir} missing — run \`anchor build\` first`);
    return;
  }
  log('2', 'target/deploy exists', 'PASS', '');

  for (const name of PROGRAMS) {
    const so = resolve(buildDir, `${name}.so`);
    const kp = resolve(buildDir, `${name}-keypair.json`);
    log('2', `${name}.so`, fs.existsSync(so) ? 'PASS' : 'FAIL', so);
    log('2', `${name}-keypair.json`, fs.existsSync(kp) ? 'PASS' : 'FAIL', kp);
  }

  // Backup discipline: encrypted offline copy required for mainnet (SOL-OPS-15).
  const backupRoots = [
    resolve(homedir(), `loar-mainnet-program-keypairs-backup`),
    resolve(homedir(), `loar-mainnet-program-keypairs-${new Date().toISOString().slice(0, 10)}`),
  ];
  if (isMainnet) {
    const anyBackup = backupRoots.some((d) => fs.existsSync(d));
    if (!anyBackup) {
      log(
        '2',
        'offline keypair backup',
        'FAIL',
        `no backup at ~/loar-mainnet-program-keypairs* — run apps/programs/scripts/backup-keypairs.sh first`
      );
    } else {
      log('2', 'offline keypair backup', 'PASS', backupRoots.find((d) => fs.existsSync(d))!);
    }
  } else {
    log('2', 'offline keypair backup', 'SKIP', 'devnet');
  }
}
step2();

// ── Step 3: $LOAR Token-2022 mint ───────────────────────────────────────────
console.log('');
console.log('Step 3 — $LOAR Token-2022 mint');
async function step3() {
  const mintEnv = isMainnet ? 'LOAR_MINT_MAINNET' : 'LOAR_MINT_DEVNET';
  const mintAddr = process.env[mintEnv];
  if (!mintAddr) {
    log('3', mintEnv, 'FAIL', 'unset');
    return;
  }
  log('3', mintEnv, 'PASS', VERBOSE ? mintAddr : `${mintAddr.slice(0, 6)}…${mintAddr.slice(-4)}`);

  if (SKIP_RPC) {
    log('3', 'mint authority verified on-chain', 'SKIP', '--skip-rpc');
    return;
  }

  const rpcUrl = isMainnet
    ? process.env.SOLANA_RPC_URL_MAINNET || process.env.SOLANA_RPC_URL
    : process.env.SOLANA_RPC_URL_DEVNET || process.env.SOLANA_RPC_URL;
  if (!rpcUrl) {
    log('3', 'RPC URL', 'FAIL', `set SOLANA_RPC_URL${isMainnet ? '_MAINNET' : '_DEVNET'}`);
    return;
  }

  let mint;
  try {
    const conn = new Connection(rpcUrl, 'confirmed');
    mint = await getMint(conn, new PublicKey(mintAddr), 'confirmed', TOKEN_2022_PROGRAM_ID);
  } catch (err) {
    log('3', 'mint exists on-chain', 'FAIL', err instanceof Error ? err.message : 'unknown');
    return;
  }
  log('3', 'mint exists on-chain', 'PASS', `decimals=${mint.decimals} supply=${mint.supply}`);

  if (!mint.freezeAuthority) {
    log('3', 'freeze authority null', 'PASS', '(production-safe — no admin-frozen accounts)');
  } else {
    log(
      '3',
      'freeze authority null',
      isMainnet ? 'FAIL' : 'WARN',
      `freezeAuthority=${mint.freezeAuthority.toBase58()} — null required for mainnet`
    );
  }

  // Mainnet: mint authority must be a Squads vault PDA, not the deployer EOA.
  if (isMainnet) {
    let deployer = '';
    try {
      deployer = execSync('solana address', { encoding: 'utf-8' }).trim();
    } catch {}
    if (mint.mintAuthority?.toBase58() === deployer && deployer) {
      log(
        '3',
        'mint authority off deployer EOA',
        'FAIL',
        `mintAuthority=${deployer} (still the deployer — transfer to Squads vault)`
      );
    } else {
      log(
        '3',
        'mint authority off deployer EOA',
        'PASS',
        `mintAuthority=${mint.mintAuthority?.toBase58() ?? '<null>'}`
      );
    }
  } else {
    log('3', 'mint authority off deployer EOA', 'SKIP', 'devnet');
  }
}

// ── Step 4: Bubblegum tree ──────────────────────────────────────────────────
console.log('');
console.log('Step 4 — Bubblegum tree');
async function step4() {
  const treeEnv = isMainnet ? 'BUBBLEGUM_TREE_MAINNET' : 'BUBBLEGUM_TREE_DEVNET';
  const treeAddr = process.env[treeEnv];
  if (!treeAddr) {
    log('4', treeEnv, isMainnet ? 'FAIL' : 'WARN', 'unset');
    return;
  }
  log('4', treeEnv, 'PASS', VERBOSE ? treeAddr : `${treeAddr.slice(0, 6)}…${treeAddr.slice(-4)}`);

  if (SKIP_RPC) {
    log('4', 'tree exists on-chain', 'SKIP', '--skip-rpc');
    return;
  }
  const rpcUrl = isMainnet
    ? process.env.SOLANA_RPC_URL_MAINNET || process.env.SOLANA_RPC_URL
    : process.env.SOLANA_RPC_URL_DEVNET || process.env.SOLANA_RPC_URL;
  if (!rpcUrl) {
    log('4', 'RPC URL', 'FAIL', 'no RPC URL');
    return;
  }
  try {
    const conn = new Connection(rpcUrl, 'confirmed');
    const acct = await conn.getAccountInfo(new PublicKey(treeAddr), 'confirmed');
    if (!acct) {
      log('4', 'tree exists on-chain', 'FAIL', 'account not found');
    } else {
      log(
        '4',
        'tree exists on-chain',
        'PASS',
        `owner=${acct.owner.toBase58().slice(0, 8)}… size=${acct.data.length}`
      );
    }
  } catch (err) {
    log('4', 'tree exists on-chain', 'FAIL', err instanceof Error ? err.message : 'unknown');
  }
}

// ── Step 5: payment program Config PDA ──────────────────────────────────────
console.log('');
console.log('Step 5 — payment program Config PDA');
async function step5() {
  const programId = process.env.PAYMENT_PROGRAM_ID;
  if (!programId) {
    log('5', 'PAYMENT_PROGRAM_ID', 'FAIL', 'unset');
    return;
  }
  log('5', 'PAYMENT_PROGRAM_ID', 'PASS', programId);

  if (SKIP_RPC) {
    log('5', 'Config PDA initialized', 'SKIP', '--skip-rpc');
    return;
  }
  const rpcUrl = isMainnet
    ? process.env.SOLANA_RPC_URL_MAINNET || process.env.SOLANA_RPC_URL
    : process.env.SOLANA_RPC_URL_DEVNET || process.env.SOLANA_RPC_URL;
  if (!rpcUrl) {
    log('5', 'RPC URL', 'FAIL', 'no RPC URL');
    return;
  }
  try {
    const [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('config')],
      new PublicKey(programId)
    );
    const conn = new Connection(rpcUrl, 'confirmed');
    const acct = await conn.getAccountInfo(configPda, 'confirmed');
    if (!acct) {
      log(
        '5',
        'Config PDA initialized',
        'FAIL',
        `${configPda.toBase58()} not found — run init-payment.ts`
      );
    } else {
      log('5', 'Config PDA initialized', 'PASS', `${configPda.toBase58()} (${acct.data.length}B)`);
    }
  } catch (err) {
    log('5', 'Config PDA initialized', 'FAIL', err instanceof Error ? err.message : 'unknown');
  }
}

// ── Step 6: upgrade authorities (Squads multisig) ───────────────────────────
console.log('');
console.log('Step 6 — upgrade authorities (Squads multisig handoff)');
function step6() {
  if (SKIP_RPC) {
    log('6', 'upgrade authorities', 'SKIP', '--skip-rpc');
    return;
  }
  let deployer = '';
  try {
    deployer = execSync('solana address', { encoding: 'utf-8' }).trim();
  } catch {}

  const squadsVar = isMainnet ? 'SQUADS_VAULT_MAINNET' : 'SQUADS_VAULT_DEVNET';
  const squadsVault = process.env[squadsVar];
  if (isMainnet && !squadsVault) {
    log(
      '6',
      squadsVar,
      'FAIL',
      'unset — Squads vault PDA required to verify mainnet authority handoff'
    );
  }

  for (const name of PROGRAMS) {
    const idVar = `${name.toUpperCase()}_PROGRAM_ID`;
    const programId = process.env[idVar];
    if (!programId) {
      log('6', `${name} program id`, 'FAIL', `${idVar} unset`);
      continue;
    }
    let auth: string | null = null;
    try {
      const out = execSync(`solana program show ${programId} --url ${cluster}`, {
        encoding: 'utf-8',
      });
      const m = out.match(/Authority:\s+(\S+)/);
      auth = m ? m[1] : null;
    } catch {
      log('6', `${name} authority readable`, 'FAIL', 'solana program show failed');
      continue;
    }
    if (!auth) {
      log('6', `${name} authority readable`, 'FAIL', 'no Authority line in output');
      continue;
    }

    if (isMainnet) {
      if (auth === deployer) {
        log(
          '6',
          `${name} authority off deployer`,
          'FAIL',
          `still ${deployer.slice(0, 8)}… — transfer to Squads`
        );
      } else if (squadsVault && auth === squadsVault) {
        log(
          '6',
          `${name} authority = Squads vault`,
          'PASS',
          `${auth.slice(0, 8)}…${auth.slice(-4)}`
        );
      } else {
        log(
          '6',
          `${name} authority`,
          'WARN',
          `auth=${auth} (set ${squadsVar} to verify a specific Squads vault)`
        );
      }
    } else {
      log('6', `${name} authority`, 'PASS', `${auth.slice(0, 8)}…${auth.slice(-4)} (devnet)`);
    }
  }
}
step6();

// ── Step 7: server env (production) ─────────────────────────────────────────
console.log('');
console.log('Step 7 — server + indexer env');
function step7() {
  const required = [
    'SOLANA_CLUSTER',
    'UNIVERSE_PROGRAM_ID',
    'EPISODE_PROGRAM_ID',
    'PAYMENT_PROGRAM_ID',
    'HELIUS_API_KEY',
    'HELIUS_WEBHOOK_SECRET',
  ];
  required.push(isMainnet ? 'LOAR_MINT_MAINNET' : 'LOAR_MINT_DEVNET');
  required.push(isMainnet ? 'BUBBLEGUM_TREE_MAINNET' : 'BUBBLEGUM_TREE_DEVNET');
  required.push(isMainnet ? 'SOLANA_RPC_URL_MAINNET' : 'SOLANA_RPC_URL_DEVNET');

  const optionalIfBridge = [
    'SOL_BRIDGE_VAULT_ATA',
    'EVM_BRIDGE_VAULT_ADDRESS',
    'LOAR_TOKEN_ADDRESS',
    'CIRCLE_BRIDGE_SIGNER_ID_EVM',
    'CIRCLE_BRIDGE_SIGNER_ID_SOL',
  ];

  for (const v of required) {
    if (!process.env[v]) {
      log('7', v, 'FAIL', 'unset');
    } else {
      log('7', v, 'PASS', VERBOSE ? process.env[v]! : 'set');
    }
  }

  // Bridge env: all-or-nothing (partial config is the most common foot-gun
  // per the runbook).
  const bridgeSet = optionalIfBridge.filter((v) => !!process.env[v]).length;
  if (bridgeSet === 0) {
    log('7', 'bridge env (all-or-nothing)', 'WARN', 'unconfigured (bridge will be 503)');
  } else if (bridgeSet === optionalIfBridge.length) {
    log('7', 'bridge env (all-or-nothing)', 'PASS', `all ${bridgeSet} present`);
  } else {
    const missing = optionalIfBridge.filter((v) => !process.env[v]);
    log(
      '7',
      'bridge env (all-or-nothing)',
      'FAIL',
      `partial config (${bridgeSet}/${optionalIfBridge.length}) missing: ${missing.join(', ')}`
    );
  }

  // VITE_ vars must mirror server vars or the browser will silently break.
  const viteRequired = [
    ['VITE_SOLANA_CLUSTER', 'SOLANA_CLUSTER'],
    ['VITE_UNIVERSE_PROGRAM_ID', 'UNIVERSE_PROGRAM_ID'],
    ['VITE_EPISODE_PROGRAM_ID', 'EPISODE_PROGRAM_ID'],
    [
      isMainnet ? 'VITE_LOAR_MINT_MAINNET' : 'VITE_LOAR_MINT_DEVNET',
      isMainnet ? 'LOAR_MINT_MAINNET' : 'LOAR_MINT_DEVNET',
    ],
    [
      isMainnet ? 'VITE_BUBBLEGUM_TREE_MAINNET' : 'VITE_BUBBLEGUM_TREE_DEVNET',
      isMainnet ? 'BUBBLEGUM_TREE_MAINNET' : 'BUBBLEGUM_TREE_DEVNET',
    ],
  ] as const;
  for (const [vite, server] of viteRequired) {
    const v = process.env[vite];
    const s = process.env[server];
    if (!v) {
      log('7', vite, 'WARN', `unset (frontend will lack ${server})`);
    } else if (s && v !== s) {
      log(
        '7',
        `${vite} mirrors ${server}`,
        'FAIL',
        `${vite}=${v.slice(0, 8)}… ≠ ${server}=${s.slice(0, 8)}…`
      );
    } else {
      log('7', `${vite} mirrors ${server}`, 'PASS', '');
    }
  }
}
step7();

// ── Step 8: indexer reachability ────────────────────────────────────────────
console.log('');
console.log('Step 8 — indexer reachability');
async function step8() {
  const url = process.env.SOLANA_INDEXER_PUBLIC_URL;
  if (!url) {
    log('8', 'SOLANA_INDEXER_PUBLIC_URL', 'WARN', 'unset (skip indexer probes)');
    return;
  }
  log('8', 'SOLANA_INDEXER_PUBLIC_URL', 'PASS', url);
  if (SKIP_RPC) {
    log('8', 'GET /healthz', 'SKIP', '--skip-rpc');
    return;
  }
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/healthz`);
    if (res.ok) {
      const body = (await res.json()) as Record<string, unknown>;
      log('8', 'GET /healthz', 'PASS', JSON.stringify(body).slice(0, 80));
    } else {
      log('8', 'GET /healthz', 'FAIL', `${res.status} ${res.statusText}`);
    }
  } catch (err) {
    log('8', 'GET /healthz', 'FAIL', err instanceof Error ? err.message : 'unknown');
  }
}

// ── Step 9: bridge config + reconciliation ──────────────────────────────────
console.log('');
console.log('Step 9 — bridge config + reconciliation');
async function step9() {
  // Re-use the server's auditBridgeConfig path so this stays in lockstep with
  // the runtime check. Imported lazily so this script doesn't crash if the
  // server package isn't installed.
  let auditFn: (() => { fullyConfigured: boolean; missing: string[] }) | null = null;
  try {
    const mod = await import('../../server/src/lib/bridge-custodial');
    auditFn = mod.auditBridgeConfig;
  } catch {
    log(
      '9',
      'auditBridgeConfig importable',
      'WARN',
      'server module not resolvable from this script'
    );
  }
  if (auditFn) {
    const audit = auditFn();
    if (audit.fullyConfigured) {
      log('9', 'auditBridgeConfig()', 'PASS', 'fully configured');
    } else if (audit.missing.length === 6) {
      log('9', 'auditBridgeConfig()', 'WARN', 'unconfigured (bridge stays 503)');
    } else {
      log(
        '9',
        'auditBridgeConfig()',
        'FAIL',
        `partial config — missing: ${audit.missing.join(', ')}`
      );
    }
  }

  // Reconcile is a live RPC + Firestore call — only attempt if both bridge
  // env and a public URL are present.
  const url = process.env.SOLANA_INDEXER_PUBLIC_URL || process.env.SERVER_PUBLIC_URL;
  if (!url || SKIP_RPC) {
    log('9', 'GET /api/bridge/reconcile', 'SKIP', SKIP_RPC ? '--skip-rpc' : 'no SERVER_PUBLIC_URL');
    return;
  }
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/api/bridge/reconcile`);
    if (res.status === 503) {
      log('9', 'GET /api/bridge/reconcile', 'WARN', '503 (bridge unconfigured)');
      return;
    }
    if (!res.ok) {
      log('9', 'GET /api/bridge/reconcile', 'FAIL', `${res.status} ${res.statusText}`);
      return;
    }
    const body = (await res.json()) as {
      results: Array<{ direction: string; driftBaseUnits: string }>;
    };
    const drift = body.results?.filter((r) => r.driftBaseUnits !== '0') ?? [];
    if (drift.length === 0) {
      log('9', 'GET /api/bridge/reconcile', 'PASS', 'parity ok');
    } else {
      log(
        '9',
        'GET /api/bridge/reconcile',
        'FAIL',
        `drift in ${drift.length} direction(s): ${drift.map((d) => d.direction).join(',')}`
      );
    }
  } catch (err) {
    log('9', 'GET /api/bridge/reconcile', 'FAIL', err instanceof Error ? err.message : 'unknown');
  }
}

(async () => {
  await step3();
  await step4();
  await step5();
  await step8();
  await step9();

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('');
  console.log('────────────────────────────────────────────────────────────────────');
  const counts = { PASS: 0, WARN: 0, FAIL: 0, SKIP: 0 };
  for (const r of results) counts[r.status]++;
  console.log(
    `Summary: ${counts.PASS} PASS · ${counts.WARN} WARN · ${counts.FAIL} FAIL · ${counts.SKIP} SKIP`
  );

  if (counts.FAIL > 0) {
    console.log('');
    console.log('FAIL items (must clear before mainnet):');
    for (const r of results.filter((r) => r.status === 'FAIL')) {
      console.log(`  • Step ${r.step}: ${r.check} — ${r.detail}`);
    }
  }
  if (isMainnet && counts.WARN > 0) {
    console.log('');
    console.log('WARN items (review before mainnet):');
    for (const r of results.filter((r) => r.status === 'WARN')) {
      console.log(`  • Step ${r.step}: ${r.check} — ${r.detail}`);
    }
  }

  process.exit(counts.FAIL > 0 ? 2 : 0);
})().catch((err) => {
  console.error('dry-run crashed:', err);
  process.exit(1);
});
