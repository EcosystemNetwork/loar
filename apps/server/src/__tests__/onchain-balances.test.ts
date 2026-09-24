/**
 * Real-chain test: reads live Sepolia state through the public RPC (no mocks).
 * Skips itself if the RPC is unreachable so a network-less run isn't a failure.
 */
import { describe, expect, it, vi } from 'vitest';

// setup.ts stubs viem's createPublicClient to block RPC; this file is the explicit
// exception — it WANTS the real chain.
vi.unmock('viem');

import { createPublicClient, formatUnits, http, type Address } from 'viem';
import { sepolia } from 'viem/chains';
import { LoarToken, PaymentRouter } from '@loar/abis/addresses';
import { loarTokenAbi } from '@loar/abis/generated';
import {
  isEvmAddress,
  readOnchainBalances,
  supportedChainId,
  trimDecimals,
} from '../services/onchain-balances';

const client = createPublicClient({
  chain: sepolia,
  transport: http(process.env.RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com', {
    timeout: 8_000,
    retryCount: 1,
  }),
});
const chainUp = await client.getBlockNumber().then(
  () => true,
  () => false
);

describe('trimDecimals', () => {
  it('trims to 6 places and drops trailing zeros', () => {
    expect(trimDecimals('1.500000000000000000')).toBe('1.5');
    expect(trimDecimals('0.123456789')).toBe('0.123456');
    expect(trimDecimals('42')).toBe('42');
    expect(trimDecimals('0.0000001')).toBe('0'); // below display precision
  });
});

describe('address helpers', () => {
  it('only treats real EVM addresses as readable', () => {
    expect(isEvmAddress('0x920e9A9bac991554AEE2AB7c76c521e5FB3113b6')).toBe(true);
    expect(isEvmAddress('9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin')).toBe(false); // Solana
    expect(isEvmAddress(null)).toBe(false);
  });
  it('knows which chains have both contracts', () => {
    expect(supportedChainId(sepolia.id)).toBe(true);
    expect(supportedChainId(1)).toBe(false);
  });
});

describe.skipIf(!chainUp)('readOnchainBalances (live Sepolia)', () => {
  const loar = (LoarToken as Record<string, Address>)[String(sepolia.id)];
  const router = (PaymentRouter as Record<string, Address>)[String(sepolia.id)];
  // A wallet that likely holds $LOAR (the token owner); falls back to the router.
  const holderPromise = client
    .readContract({ address: loar, abi: loarTokenAbi, functionName: 'owner' })
    .then((a) => a as Address)
    .catch(() => router);

  it('reports the wallet $LOAR balance exactly as the token contract does', async () => {
    const holder = await holderPromise;
    const direct = (await client.readContract({
      address: loar,
      abi: loarTokenAbi,
      functionName: 'balanceOf',
      args: [holder],
    })) as bigint;
    const got = await readOnchainBalances(client, holder);
    expect(got.chainId).toBe(sepolia.id);
    expect(got.loarBalance).toBe(trimDecimals(formatUnits(direct, 18)));
  });

  it('returns zero claimables for a wallet that has never earned anything', async () => {
    const got = await readOnchainBalances(client, '0x000000000000000000000000000000000000dEaD');
    expect(got.claimableEth).toBe('0');
    expect(got.pendingWithdrawalsEth).toBe('0');
    expect(got.claimableLoar).toBe('0');
  });

  it('a revert on pendingWithdrawals (older proxy implementation) reads as 0, but an RPC outage is NOT swallowed', async () => {
    const router = (PaymentRouter as Record<string, Address>)[String(sepolia.id)];
    // Live: the deployed router currently reverts on pendingWithdrawals -> '0', call still succeeds.
    expect((await readOnchainBalances(client, router)).pendingWithdrawalsEth).toBe('0');

    // A dead RPC must fail the whole call rather than fabricate zeros.
    const dead = createPublicClient({
      chain: sepolia,
      transport: http('http://127.0.0.1:1', { retryCount: 0, timeout: 1_000 }),
    });
    await expect(readOnchainBalances(dead, router)).rejects.toThrow();
  });

  it('refuses a chain without the contracts', async () => {
    await expect(readOnchainBalances(client, router, 1)).rejects.toThrow('not deployed');
  });
});
