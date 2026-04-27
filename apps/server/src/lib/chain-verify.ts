/**
 * Chain-verify helper — re-reads critical state directly from RPC before
 * acting on indexer-derived data.
 *
 * INF-5: the server consults the Ponder indexer DB for universe ownership,
 * balances, and pool state. An attacker with write access to that DB could
 * spoof events — e.g. claim ownership of a universe by inserting a fake
 * `UniverseOwner` row — and the server would act on the lie. For any
 * decision that moves funds or grants admin, call these helpers to re-check
 * the live chain before trusting the indexer.
 *
 * The helpers are narrow on purpose. Each one reads a single small slot and
 * compares it to an expected value; if they don't match we refuse the action
 * and surface a loud alert for oncall.
 */

import { createPublicClient, http, type Address } from 'viem';
import { sepolia, baseSepolia } from 'viem/chains';

function rpcForChain(chainId: number): string {
  const url =
    chainId === baseSepolia.id
      ? process.env.RPC_URL_BASE_SEPOLIA
      : (process.env.RPC_URL ?? process.env.PONDER_RPC_URL_2);
  if (!url || url.trim() === '') {
    throw new Error(
      `[chain-verify] no RPC URL configured for chain ${chainId}. Refusing to trust indexer for high-value ops.`
    );
  }
  return url;
}

function clientFor(chainId: number) {
  // Build fresh per call — low call volume, simpler types. If this becomes
  // hot, memoize via per-chain `let` bindings above.
  if (chainId === baseSepolia.id) {
    return createPublicClient({ chain: baseSepolia, transport: http(rpcForChain(chainId)) });
  }
  return createPublicClient({ chain: sepolia, transport: http(rpcForChain(sepolia.id)) });
}

/** Minimal Ownable ABI for `owner()` lookups. */
const ABI_OWNABLE = [
  {
    type: 'function',
    name: 'owner',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
] as const;

/**
 * Assert the current on-chain `owner()` of `contract` equals `expected`.
 * Caller is the server-side tRPC route that was about to trust an
 * indexer-derived owner claim; we re-check the chain so a spoofed event
 * can't grant admin privileges.
 */
export async function assertChainOwner(params: {
  chainId: number;
  contract: Address;
  expected: Address;
}): Promise<void> {
  const client = clientFor(params.chainId);
  const actual = (await client.readContract({
    address: params.contract,
    abi: ABI_OWNABLE,
    functionName: 'owner',
  })) as Address;
  if (actual.toLowerCase() !== params.expected.toLowerCase()) {
    const msg = `[chain-verify] ownership mismatch for ${params.contract} on chain ${params.chainId}: expected ${params.expected}, chain reports ${actual}`;
    console.error(msg);
    throw new Error(msg);
  }
}

/**
 * Assert the current on-chain ERC-20 balance of `holder` is at least
 * `minBalance`. Use for balance-gated actions (e.g. staking threshold checks)
 * where the indexer value would otherwise be accepted as-is.
 */
const ABI_ERC20_BALANCEOF = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
] as const;

export async function assertChainBalanceAtLeast(params: {
  chainId: number;
  token: Address;
  holder: Address;
  minBalance: bigint;
}): Promise<void> {
  const client = clientFor(params.chainId);
  const actual = (await client.readContract({
    address: params.token,
    abi: ABI_ERC20_BALANCEOF,
    functionName: 'balanceOf',
    args: [params.holder],
  })) as bigint;
  if (actual < params.minBalance) {
    const msg = `[chain-verify] balance below threshold for ${params.holder} of token ${params.token} on chain ${params.chainId}: have ${actual}, need ≥ ${params.minBalance}`;
    console.error(msg);
    throw new Error(msg);
  }
}

const ABI_VOTES = [
  {
    type: 'function',
    name: 'getVotes',
    stateMutability: 'view',
    inputs: [{ type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
] as const;

/**
 * Read the current voting power of `holder` for an ERC20Votes governance
 * token. Falls back to `balanceOf` when the token does not implement the
 * IVotes interface (e.g. `getVotes` reverts).
 *
 * Use this when the server needs to derive a vote weight authoritatively
 * — never accept a client-supplied weight, since the client can lie about
 * its balance and stuff votes. Note: this is the *current* voting power,
 * so it is still vulnerable to flash loans within the vote window. For
 * flash-loan-resistant weight, mirror CanonMarketplace's snapshotBlock
 * pattern with `getPastVotes(holder, snapshotBlock)`.
 */
export async function getChainVotingPower(params: {
  chainId: number;
  token: Address;
  holder: Address;
}): Promise<bigint> {
  const client = clientFor(params.chainId);
  try {
    return (await client.readContract({
      address: params.token,
      abi: ABI_VOTES,
      functionName: 'getVotes',
      args: [params.holder],
    })) as bigint;
  } catch {
    return (await client.readContract({
      address: params.token,
      abi: ABI_ERC20_BALANCEOF,
      functionName: 'balanceOf',
      args: [params.holder],
    })) as bigint;
  }
}
