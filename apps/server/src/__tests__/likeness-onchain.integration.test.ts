/**
 * Live on-chain integration tests against the DEPLOYED Phase 1.5 contracts.
 *
 * NO MOCKS: real viem `createPublicClient` → public Sepolia + Base Sepolia
 * RPC endpoints → the actual proxies the marketplace router talks to in
 * production.
 *
 * These tests catch regressions like:
 *   - Address drift in `packages/abis/src/addresses.ts` vs what's actually
 *     on-chain (the original bug that took down Phase 1.5's first deploy).
 *   - ABI / function-selector drift (e.g., RightsRegistry upgrade renames
 *     `creatorNonce` → something else).
 *   - ContentLicensing initializer wiring (paymentRouter / rightsRegistry
 *     / splitRouter must all point at real proxies with live bytecode).
 *
 * Skipped automatically when run offline — the public RPCs occasionally
 * 5xx, so we don't want CI to flake on transient infra.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';

// setup.ts mocks `viem`'s createPublicClient to block all RPC calls in tests.
// This file is the explicit exception — we WANT real RPC. vi.unmock undoes
// the global mock for this file only.
vi.unmock('viem');

import { createPublicClient, http, type Address } from 'viem';
import { sepolia, baseSepolia } from 'viem/chains';
import { rightsRegistryAbi, contentLicensingAbi } from '@loar/abis/generated';
import { RightsRegistry, ContentLicensing, PaymentRouter, SplitRouter } from '@loar/abis/addresses';

const SEPOLIA_RPC = 'https://ethereum-sepolia-rpc.publicnode.com';
const BASE_SEPOLIA_RPC = 'https://sepolia.base.org';

// Skip these tests when offline / RPC down so CI doesn't false-fail.
let onlineSepolia = false;
let onlineBase = false;

beforeAll(async () => {
  for (const [url, setOnline] of [
    [SEPOLIA_RPC, (v: boolean) => (onlineSepolia = v)],
    [BASE_SEPOLIA_RPC, (v: boolean) => (onlineBase = v)],
  ] as const) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_chainId', params: [], id: 1 }),
        signal: AbortSignal.timeout(5_000),
      });
      setOnline(res.ok);
    } catch {
      setOnline(false);
    }
  }
});

// Return type omitted intentionally: each branch produces a `PublicClient`
// generic over a different `chain`, and naming the wider `PublicClient` here
// trips TS2719 when viem types appear under multiple resolutions in the
// workspace. Inference unions the two correctly without the conflict.
function chainClient(chainId: 11155111 | 84532) {
  return chainId === 11155111
    ? createPublicClient({ chain: sepolia, transport: http(SEPOLIA_RPC) })
    : createPublicClient({ chain: baseSepolia, transport: http(BASE_SEPOLIA_RPC) });
}

const ZERO = '0x0000000000000000000000000000000000000000';
const SELLER = '0x116C28e6DCABCa363f83217C712d79DCE168d90e'; // historical deployer

describe('live deployed addresses (Sepolia)', () => {
  it('all canonical addresses have bytecode on-chain', async () => {
    if (!onlineSepolia) return;
    const client = chainClient(11155111);
    const addrs = {
      RightsRegistry: RightsRegistry['11155111'],
      ContentLicensing: ContentLicensing['11155111'],
      PaymentRouter: PaymentRouter['11155111'],
      SplitRouter: SplitRouter['11155111'],
    };
    for (const [name, addr] of Object.entries(addrs)) {
      const code = await client.getBytecode({ address: addr as Address });
      expect(code, `${name} @ ${addr} should have bytecode`).toBeTruthy();
      expect(code).not.toBe('0x');
    }
  });
});

describe('RightsRegistry — Sepolia (hardened impl)', () => {
  const proxy = RightsRegistry['11155111'] as Address;

  it('isMonetizable(unset hash) returns FALSE (default-deny after upgrade)', async () => {
    if (!onlineSepolia) return;
    const client = chainClient(11155111);
    const result = await client.readContract({
      address: proxy,
      abi: rightsRegistryAbi,
      functionName: 'isMonetizable',
      args: ['0x' + 'f'.repeat(64)] as never,
    });
    expect(result).toBe(false);
  });

  it('creatorNonce(deployer) returns a uint (function exists post-upgrade)', async () => {
    if (!onlineSepolia) return;
    const client = chainClient(11155111);
    const nonce = await client.readContract({
      address: proxy,
      abi: rightsRegistryAbi,
      functionName: 'creatorNonce',
      args: [SELLER as Address],
    });
    expect(typeof nonce).toBe('bigint');
    expect(nonce as bigint).toBeGreaterThanOrEqual(0n);
  });

  it('operators(deployer) returns true (operator was re-set after upgrade)', async () => {
    if (!onlineSepolia) return;
    const client = chainClient(11155111);
    const isOp = await client.readContract({
      address: proxy,
      abi: rightsRegistryAbi,
      functionName: 'operators',
      args: [SELLER as Address],
    });
    expect(isOp).toBe(true);
  });

  it('owner() is the deployer', async () => {
    if (!onlineSepolia) return;
    const client = chainClient(11155111);
    const owner = await client.readContract({
      address: proxy,
      abi: rightsRegistryAbi,
      functionName: 'owner',
    });
    expect((owner as string).toLowerCase()).toBe(SELLER.toLowerCase());
  });
});

describe('ContentLicensing — Sepolia (wired to canonical proxies)', () => {
  const proxy = ContentLicensing['11155111'] as Address;

  it('rightsRegistry() points at the canonical RightsRegistry proxy', async () => {
    if (!onlineSepolia) return;
    const client = chainClient(11155111);
    const rr = await client.readContract({
      address: proxy,
      abi: contentLicensingAbi,
      functionName: 'rightsRegistry',
    });
    expect((rr as string).toLowerCase()).toBe(RightsRegistry['11155111'].toLowerCase());
  });

  it('paymentRouter() points at the canonical PaymentRouter proxy', async () => {
    if (!onlineSepolia) return;
    const client = chainClient(11155111);
    const pr = await client.readContract({
      address: proxy,
      abi: contentLicensingAbi,
      functionName: 'paymentRouter',
    });
    expect((pr as string).toLowerCase()).toBe(PaymentRouter['11155111'].toLowerCase());
  });

  it('splitRouter() points at the Sepolia SplitRouter we deployed', async () => {
    if (!onlineSepolia) return;
    const client = chainClient(11155111);
    const sr = await client.readContract({
      address: proxy,
      abi: contentLicensingAbi,
      functionName: 'splitRouter',
    });
    expect((sr as string).toLowerCase()).toBe(SplitRouter['11155111'].toLowerCase());
  });

  it('platformFeeBps() is 500 (5%)', async () => {
    if (!onlineSepolia) return;
    const client = chainClient(11155111);
    const fee = await client.readContract({
      address: proxy,
      abi: contentLicensingAbi,
      functionName: 'platformFeeBps',
    });
    expect(fee).toBe(500);
  });

  it('MAX_DURATION_DAYS = 365 + MAX_RENT_PRICE_PER_DAY = 1000 ETH (matches server-side caps)', async () => {
    if (!onlineSepolia) return;
    const client = chainClient(11155111);
    const [maxDays, maxRent] = await Promise.all([
      client.readContract({
        address: proxy,
        abi: contentLicensingAbi,
        functionName: 'MAX_DURATION_DAYS',
      }),
      client.readContract({
        address: proxy,
        abi: contentLicensingAbi,
        functionName: 'MAX_RENT_PRICE_PER_DAY',
      }),
    ]);
    expect(maxDays).toBe(365n);
    expect(maxRent).toBe(1000n * 10n ** 18n);
  });

  it('getRegistration(unset hash) returns the zero struct (creator = 0x0)', async () => {
    if (!onlineSepolia) return;
    const client = chainClient(11155111);
    const reg = await client.readContract({
      address: proxy,
      abi: contentLicensingAbi,
      functionName: 'getRegistration',
      args: ['0x' + '1'.repeat(64)] as never,
    });
    // The struct is returned in field order; unregistered entries default to
    // all-zeros. We only need to confirm `creator` is the zero address.
    const creator =
      (reg as { creator: string }).creator ?? (reg as unknown as readonly unknown[])[1];
    expect((creator as string).toLowerCase()).toBe(ZERO);
  });
});

describe('SplitRouter — Sepolia (newly deployed)', () => {
  // Minimal ABI for the one read — SplitRouter's `paymentRouter` getter
  // doesn't appear in the shared paymentRouterAbi import (different contract).
  const splitRouterPRAbi = [
    {
      type: 'function',
      name: 'paymentRouter',
      stateMutability: 'view',
      inputs: [],
      outputs: [{ type: 'address' }],
    },
  ] as const;

  it('paymentRouter() on the new Sepolia SplitRouter matches addresses.ts', async () => {
    if (!onlineSepolia) return;
    const client = chainClient(11155111);
    const pr = await client.readContract({
      address: SplitRouter['11155111'] as Address,
      abi: splitRouterPRAbi,
      functionName: 'paymentRouter',
    });
    expect((pr as string).toLowerCase()).toBe(PaymentRouter['11155111'].toLowerCase());
  });
});

describe('RightsRegistry — Base Sepolia (hardened impl)', () => {
  const proxy = RightsRegistry['84532'] as Address;

  it('isMonetizable(unset hash) returns FALSE post-upgrade', async () => {
    if (!onlineBase) return;
    const client = chainClient(84532);
    const result = await client.readContract({
      address: proxy,
      abi: rightsRegistryAbi,
      functionName: 'isMonetizable',
      args: ['0x' + 'f'.repeat(64)] as never,
    });
    expect(result).toBe(false);
  });

  it('operators(deployer) returns true', async () => {
    if (!onlineBase) return;
    const client = chainClient(84532);
    const isOp = await client.readContract({
      address: proxy,
      abi: rightsRegistryAbi,
      functionName: 'operators',
      args: [SELLER as Address],
    });
    expect(isOp).toBe(true);
  });
});

describe('ContentLicensing — Base Sepolia (wired to canonical proxies)', () => {
  const proxy = ContentLicensing['84532'] as Address;

  it('rightsRegistry() points at the canonical Base Sepolia RightsRegistry proxy', async () => {
    if (!onlineBase) return;
    const client = chainClient(84532);
    const rr = await client.readContract({
      address: proxy,
      abi: contentLicensingAbi,
      functionName: 'rightsRegistry',
    });
    expect((rr as string).toLowerCase()).toBe(RightsRegistry['84532'].toLowerCase());
  });

  it('splitRouter() points at the existing Base Sepolia SplitRouter', async () => {
    if (!onlineBase) return;
    const client = chainClient(84532);
    const sr = await client.readContract({
      address: proxy,
      abi: contentLicensingAbi,
      functionName: 'splitRouter',
    });
    expect((sr as string).toLowerCase()).toBe(SplitRouter['84532'].toLowerCase());
  });
});
