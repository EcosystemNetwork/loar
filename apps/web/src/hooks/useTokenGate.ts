/**
 * useTokenGate — checks whether the connected wallet satisfies a specific
 * token gate rule for a universe.
 *
 * Each universe can have multiple gate rules (view, create, canon, wiki,
 * governance, play), each with its own minimum ownership % threshold.
 *
 * Fetches all gate rules for the universe once, then checks the relevant
 * rule against on-chain balance / totalSupply.
 */
import { useAccount, useReadContract, useChainId } from 'wagmi';
import { useActiveAccount } from 'thirdweb/react';
import { useQuery } from '@tanstack/react-query';
import { governanceErc20Abi } from '@loar/abis/generated';
import { trpc } from '../utils/trpc';
import { useUniverseAddresses } from './useUniverseAddresses';

export type GateTarget = 'view' | 'create' | 'canon' | 'wiki' | 'governance' | 'play';

export interface GateRule {
  id: string;
  target: GateTarget;
  minPercentage: number;
  enabled: boolean;
  label: string | null;
  tokenAddress: string;
}

export interface TokenGateStatus {
  /** Whether an enabled gate exists for this target */
  hasGate: boolean;
  /** Whether the connected wallet passes the gate */
  passes: boolean;
  /** Whether data is still loading */
  isLoading: boolean;
  /** The minimum percentage required */
  minPercentage: number;
  /** The user's current ownership percentage */
  ownershipPercentage: number;
  /** Gate label (optional description) */
  label: string | null;
  /** The specific target being checked */
  target: GateTarget;
}

/**
 * Fetch all gate rules for a universe (shared across all useTokenGate calls).
 */
export function useTokenGateRules(universeId: string | undefined) {
  const { data, isLoading } = useQuery(
    trpc.tokenGates.list.queryOptions({ universeId: universeId ?? '' })
  );

  const rules = (data ?? []).map((r: any) => ({
    id: r.id as string,
    target: r.target as GateTarget,
    minPercentage: (r.minPercentage as number) ?? 0,
    enabled: r.enabled !== false,
    label: (r.label as string) ?? null,
    tokenAddress: (r.tokenAddress as string) ?? '',
  })) satisfies GateRule[];

  return { rules, isLoading };
}

/**
 * Check a specific gate target for a universe.
 *
 * @param universeId - The universe contract address or ID
 * @param target - Which gate to check (view, create, canon, wiki, governance, play)
 */
export function useTokenGate(
  universeId: string | undefined,
  target: GateTarget = 'view'
): TokenGateStatus {
  const { address: wagmiAddress } = useAccount();
  const thirdwebAccount = useActiveAccount();
  const address = (wagmiAddress ?? thirdwebAccount?.address) as `0x${string}` | undefined;
  const chainId = useChainId();
  const { tokenAddress: fallbackToken } = useUniverseAddresses(universeId);
  const { rules, isLoading: rulesLoading } = useTokenGateRules(universeId);

  // Find the matching enabled rule
  const rule = rules.find((r) => r.target === target && r.enabled);
  const gateTokenAddress = (rule?.tokenAddress || fallbackToken) as `0x${string}` | undefined;

  // Read user balance
  const { data: balance, isLoading: balanceLoading } = useReadContract({
    address: gateTokenAddress,
    abi: governanceErc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId,
    query: { enabled: !!address && !!gateTokenAddress && !!rule },
  });

  // Read total supply
  const { data: totalSupply, isLoading: supplyLoading } = useReadContract({
    address: gateTokenAddress,
    abi: governanceErc20Abi,
    functionName: 'totalSupply',
    chainId,
    query: { enabled: !!gateTokenAddress && !!rule },
  });

  const isLoading = rulesLoading || (!!rule && (balanceLoading || supplyLoading));

  if (!rule) {
    return {
      hasGate: false,
      passes: true,
      isLoading: rulesLoading,
      minPercentage: 0,
      ownershipPercentage: 0,
      label: null,
      target,
    };
  }

  // Calculate ownership percentage via basis points for precision
  let ownershipPercentage = 0;
  if (balance && totalSupply && totalSupply > 0n) {
    const bps = (balance * 10000n) / totalSupply;
    ownershipPercentage = Number(bps) / 100;
  }

  const passes = ownershipPercentage >= rule.minPercentage;

  return {
    hasGate: true,
    passes,
    isLoading,
    minPercentage: rule.minPercentage,
    ownershipPercentage,
    label: rule.label,
    target,
  };
}
