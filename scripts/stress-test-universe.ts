/**
 * Stress test — monetize all entities in Voidborn Saga, check mint eligibility,
 * and verify every wiki/API endpoint handles 16 entities of all kinds.
 *
 * Usage: pnpm tsx scripts/stress-test-universe.ts
 */
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { getAddress } from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const rawKey = process.env.PRIVATE_KEY ?? '';
const PRIVATE_KEY = (rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`) as `0x${string}`;
const SERVER_URL = process.env.VITE_SERVER_URL ?? 'http://localhost:3000';
const account = privateKeyToAccount(PRIVATE_KEY);

const UNIVERSE_ADDR = '0x89669812f850f34f907ee9e9009f501d1b008420';

// ── SIWE Auth ─────────────────────────────────────────────────────────
function buildSiweMessage(params: { address: string; nonce: string; chainId: number }): string {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 5 * 60 * 1000);
  return [
    `localhost wants you to sign in with your Ethereum account:`,
    params.address,
    '',
    'Sign in to LOAR',
    '',
    `URI: http://localhost:5173`,
    `Version: 1`,
    `Chain ID: ${params.chainId}`,
    `Nonce: ${params.nonce}`,
    `Issued At: ${now.toISOString()}`,
    `Expiration Time: ${expiresAt.toISOString()}`,
  ].join('\n');
}

async function getAuthToken(): Promise<string> {
  const nonceRes = await fetch(`${SERVER_URL}/auth/nonce`);
  const { nonce } = (await nonceRes.json()) as { nonce: string };
  const message = buildSiweMessage({
    address: getAddress(account.address),
    nonce,
    chainId: sepolia.id,
  });
  const signature = await account.signMessage({ message });
  const verifyRes = await fetch(`${SERVER_URL}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
    body: JSON.stringify({ message, signature }),
  });
  const setCookie = verifyRes.headers.get('set-cookie') ?? '';
  const match = setCookie.match(/siwe-session=([^;]+)/);
  if (!match) throw new Error('No session cookie');
  return match[1];
}

async function tRPCMutate<T>(procedure: string, input: unknown, token: string): Promise<T> {
  const res = await fetch(`${SERVER_URL}/trpc/${procedure}?batch=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ '0': input }),
  });
  const json = (await res.json()) as any[];
  if (json[0]?.error)
    throw new Error(`tRPC ${procedure}: ${JSON.stringify(json[0].error).slice(0, 500)}`);
  return json[0]?.result?.data;
}

async function tRPCQuery<T>(procedure: string, input: unknown, token?: string): Promise<T> {
  const url = `${SERVER_URL}/trpc/${procedure}?batch=1&input=${encodeURIComponent(JSON.stringify({ '0': input }))}`;
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { headers });
  const json = (await res.json()) as any[];
  if (json[0]?.error)
    throw new Error(`tRPC ${procedure}: ${JSON.stringify(json[0].error).slice(0, 500)}`);
  return json[0]?.result?.data;
}

function log(step: string, msg: string) {
  console.log(`  [${step.padEnd(20)}] ${msg}`);
}

const ALL_KINDS = [
  'person',
  'place',
  'thing',
  'faction',
  'event',
  'lore',
  'species',
  'vehicle',
  'technology',
  'organization',
  'timeline',
  'reality',
  'dimension',
  'plane',
  'realm',
  'domain',
];

async function main() {
  console.log('═'.repeat(65));
  console.log('  Stress Test: Voidborn Saga — All 16 Entity Kinds');
  console.log('═'.repeat(65));

  // ── Auth ─────────────────────────────────────────────────────────────
  console.log('\n[AUTH] Authenticating...');
  const token = await getAuthToken();
  console.log(`[AUTH] OK — ${account.address}\n`);

  let passed = 0;
  let failed = 0;
  const failures: string[] = [];

  function pass(test: string) {
    passed++;
    log('PASS', test);
  }
  function fail(test: string, err: string) {
    failed++;
    failures.push(`${test}: ${err}`);
    log('FAIL', `${test} → ${err}`);
  }

  // ── Test 1: List all entities in universe ────────────────────────────
  console.log('── Test 1: List all entities in universe ──────────────');
  try {
    const result = await tRPCQuery<{ entities: any[]; total: number }>('entities.list', {
      universeAddress: UNIVERSE_ADDR,
    });
    if (result.total === 16) {
      pass(`entities.list returned ${result.total} entities`);
    } else {
      fail(`entities.list count`, `expected 16, got ${result.total}`);
    }

    // Verify all kinds present
    const kinds = new Set(result.entities.map((e: any) => e.kind));
    const missing = ALL_KINDS.filter((k) => !kinds.has(k));
    if (missing.length === 0) {
      pass(`All 16 kinds present in listing`);
    } else {
      fail(`Missing kinds`, missing.join(', '));
    }
  } catch (err: any) {
    fail('entities.list', err.message);
  }

  // ── Test 2: Filter by each kind ─────────────────────────────────────
  console.log('\n── Test 2: Filter by each kind ────────────────────────');
  for (const kind of ALL_KINDS) {
    try {
      const result = await tRPCQuery<{ entities: any[]; total: number }>('entities.list', {
        universeAddress: UNIVERSE_ADDR,
        kind,
      });
      if (result.total >= 1) {
        pass(`entities.list(kind=${kind}) → ${result.total} result(s)`);
      } else {
        fail(`entities.list(kind=${kind})`, `returned 0 entities`);
      }
    } catch (err: any) {
      fail(`entities.list(kind=${kind})`, err.message);
    }
  }

  // ── Test 3: listByKind (global) ─────────────────────────────────────
  console.log('\n── Test 3: Global listByKind ──────────────────────────');
  for (const kind of ALL_KINDS) {
    try {
      const result = await tRPCQuery<{ entities: any[]; total: number }>('entities.listByKind', {
        kind,
      });
      if (result.total >= 1) {
        pass(`entities.listByKind(${kind}) → ${result.total}`);
      } else {
        fail(`entities.listByKind(${kind})`, `returned 0`);
      }
    } catch (err: any) {
      fail(`entities.listByKind(${kind})`, err.message);
    }
  }

  // ── Test 4: Get each entity by ID ───────────────────────────────────
  console.log('\n── Test 4: Get each entity by ID ─────────────────────');
  const allEntities = await tRPCQuery<{ entities: any[] }>('entities.list', {
    universeAddress: UNIVERSE_ADDR,
  });
  for (const entity of allEntities.entities) {
    try {
      const result = await tRPCQuery<any>('entities.get', { entityId: entity.id });
      if (result.name === entity.name && result.kind === entity.kind) {
        pass(`get(${entity.kind}) → "${entity.name}"`);
      } else {
        fail(`get(${entity.kind})`, `name mismatch`);
      }
    } catch (err: any) {
      fail(`get(${entity.kind})`, err.message);
    }
  }

  // ── Test 5: Monetize all entities ───────────────────────────────────
  console.log('\n── Test 5: Update all entities to monetized (original) ─');
  for (const entity of allEntities.entities) {
    try {
      const result = await tRPCMutate<any>(
        'entities.update',
        { entityId: entity.id, monetized: true, rightsDeclaration: 'original' },
        token
      );
      if (result.success) {
        pass(`monetize ${entity.kind} "${entity.name}"`);
      } else {
        fail(`monetize ${entity.kind}`, `success=false`);
      }
    } catch (err: any) {
      fail(`monetize ${entity.kind}`, err.message);
    }
  }

  // ── Test 6: Check mint eligibility for all ──────────────────────────
  console.log('\n── Test 6: Mint eligibility check ────────────────────');
  // Re-fetch entities to get updated monetized state
  const refreshed = await tRPCQuery<{ entities: any[] }>('entities.list', {
    universeAddress: UNIVERSE_ADDR,
  });
  for (const entity of refreshed.entities) {
    try {
      const result = await tRPCQuery<any>('entities.mintEligibility', { entityId: entity.id });
      if (result.eligible) {
        pass(`mintEligible(${entity.kind}) → eligible`);
      } else {
        fail(`mintEligible(${entity.kind})`, `not eligible: ${result.reason}`);
      }
    } catch (err: any) {
      fail(`mintEligible(${entity.kind})`, err.message);
    }
  }

  // ── Test 7: List by creator ─────────────────────────────────────────
  console.log('\n── Test 7: List by creator ────────────────────────────');
  try {
    const result = await tRPCQuery<{ entities: any[] }>('entities.listByCreator', {
      creator: account.address.toLowerCase(),
    });
    const count = result.entities?.length ?? 0;
    if (count >= 16) {
      pass(`listByCreator → ${count} entities`);
    } else {
      fail(`listByCreator`, `expected ≥16, got ${count}`);
    }
  } catch (err: any) {
    fail(`listByCreator`, err.message);
  }

  // ── Test 8: Parent-child relationships ──────────────────────────────
  console.log('\n── Test 8: Structural hierarchy (children) ────────────');
  const structuralEntities = allEntities.entities.filter((e: any) =>
    ['timeline', 'reality', 'dimension', 'plane', 'realm', 'domain'].includes(e.kind)
  );
  for (const entity of structuralEntities) {
    try {
      const result = await tRPCQuery<{ children: any[] }>('entities.children', {
        parentId: entity.id,
      });
      const childCount = result.children?.length ?? 0;
      log('INFO', `${entity.kind} "${entity.name}" has ${childCount} children`);
      passed++;
    } catch (err: any) {
      fail(`children(${entity.kind})`, err.message);
    }
  }

  // ── Test 9: Universe get (ensure universe can handle all entities) ──
  console.log('\n── Test 9: Universe metadata ──────────────────────────');
  try {
    const universe = await tRPCQuery<any>('universes.get', { id: UNIVERSE_ADDR });
    const name = universe?.data?.name ?? universe?.name;
    if (name) {
      pass(`Universe "${name}" loads OK`);
    } else {
      fail(`universes.get`, `no name returned`);
    }
  } catch (err: any) {
    fail(`universes.get`, err.message);
  }

  // ── Test 10: Verify metadata integrity on all entities ──────────────
  console.log('\n── Test 10: Metadata integrity ────────────────────────');
  for (const entity of refreshed.entities) {
    try {
      const full = await tRPCQuery<any>('entities.get', { entityId: entity.id });
      const meta = full?.metadata || {};
      const metaKeys = Object.keys(meta).length;
      if (metaKeys > 0) {
        pass(
          `${entity.kind} metadata has ${metaKeys} fields — monetized=${full.monetized}, rights=${full.rightsDeclaration}`
        );
      } else {
        fail(`${entity.kind} metadata`, `empty metadata`);
      }
    } catch (err: any) {
      fail(`${entity.kind} metadata`, err.message);
    }
  }

  // ── Summary ─────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(65));
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log('\n  Failures:');
    for (const f of failures) {
      console.log(`    ✗ ${f}`);
    }
  }
  console.log('═'.repeat(65));

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
