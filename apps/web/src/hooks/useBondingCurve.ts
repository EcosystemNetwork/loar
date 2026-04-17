/**
 * useBondingCurve — hooks for interacting with graduated bonding curves.
 *
 * Provides state reads (price, progress, supply), previews (buy/sell estimates),
 * and write actions (buy, sell) for tokens in their bonding curve phase.
 * After graduation, the token trades on Uniswap v4 via the standard swap router.
 */
import { useState, useCallback, useMemo } from 'react';
import { useReadContract, useChainId } from 'wagmi';
import { useWriteContract } from '@/hooks/useThirdwebWrite';
import { useActiveAccount } from 'thirdweb/react';
import { parseEther, formatEther, type Address } from 'viem';
import { useVisibilityAwareInterval, POLL_INTERVALS } from './useSmartPolling';

// ── BondingCurve ABI (minimal) ───────────────────────────────────────

const BONDING_CURVE_ABI = [
  {
    name: 'buy',
    type: 'function',
    stateMutability: 'payable',
    inputs: [{ name: 'minTokensOut', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'sell',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'tokenAmount', type: 'uint256' },
      { name: 'minEthOut', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'graduate',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    name: 'curveState',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: '_tokensSold', type: 'uint256' },
      { name: '_ethRaised', type: 'uint256' },
      { name: '_graduated', type: 'bool' },
      { name: '_currentPrice', type: 'uint256' },
      { name: '_totalCurveSupply', type: 'uint256' },
      { name: '_graduationEth', type: 'uint256' },
    ],
  },
  {
    name: 'getProgress',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'raised', type: 'uint256' },
      { name: 'target', type: 'uint256' },
      { name: 'percentBps', type: 'uint256' },
    ],
  },
  {
    name: 'getTokensForEth',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'ethAmount', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'getEthForTokens',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'tokenAmount', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'getCurrentPrice',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'MAX_BUY_AMOUNT',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

// ── Types ────────────────────────────────────────────────────────────

export interface CurveState {
  tokensSold: bigint;
  ethRaised: bigint;
  graduated: boolean;
  currentPrice: bigint;
  totalCurveSupply: bigint;
  graduationEth: bigint;
}

export interface CurveProgress {
  raised: bigint;
  target: bigint;
  percentBps: bigint;
}

// ── Read hooks ───────────────────────────────────────────────────────

export function useCurveState(bondingCurveAddress: Address | undefined) {
  const pollInterval = useVisibilityAwareInterval(POLL_INTERVALS.REALTIME);
  const { data, isLoading, refetch } = useReadContract({
    address: bondingCurveAddress,
    abi: BONDING_CURVE_ABI,
    functionName: 'curveState',
    query: {
      enabled: !!bondingCurveAddress,
      refetchInterval: pollInterval,
    },
  });

  const state: CurveState | null = useMemo(() => {
    if (!data) return null;
    const [tokensSold, ethRaised, graduated, currentPrice, totalCurveSupply, graduationEth] = data;
    return { tokensSold, ethRaised, graduated, currentPrice, totalCurveSupply, graduationEth };
  }, [data]);

  return { state, isLoading, refetch };
}

export function useCurveProgress(bondingCurveAddress: Address | undefined) {
  const { data, isLoading } = useReadContract({
    address: bondingCurveAddress,
    abi: BONDING_CURVE_ABI,
    functionName: 'getProgress',
    query: {
      enabled: !!bondingCurveAddress,
      refetchInterval: pollInterval,
    },
  });

  const progress: CurveProgress | null = useMemo(() => {
    if (!data) return null;
    const [raised, target, percentBps] = data;
    return { raised, target, percentBps };
  }, [data]);

  return { progress, isLoading };
}

export function usePreviewBuy(bondingCurveAddress: Address | undefined, ethAmount: string) {
  const parsedAmount = ethAmount && !isNaN(Number(ethAmount)) ? parseEther(ethAmount) : 0n;

  const { data, isLoading } = useReadContract({
    address: bondingCurveAddress,
    abi: BONDING_CURVE_ABI,
    functionName: 'getTokensForEth',
    args: [parsedAmount],
    query: {
      enabled: !!bondingCurveAddress && parsedAmount > 0n,
    },
  });

  return { tokensOut: data ?? 0n, isLoading };
}

export function usePreviewSell(bondingCurveAddress: Address | undefined, tokenAmount: bigint) {
  const { data, isLoading } = useReadContract({
    address: bondingCurveAddress,
    abi: BONDING_CURVE_ABI,
    functionName: 'getEthForTokens',
    args: [tokenAmount],
    query: {
      enabled: !!bondingCurveAddress && tokenAmount > 0n,
    },
  });

  return { ethOut: data ?? 0n, isLoading };
}

export function useMaxBuyAmount(bondingCurveAddress: Address | undefined) {
  const { data } = useReadContract({
    address: bondingCurveAddress,
    abi: BONDING_CURVE_ABI,
    functionName: 'MAX_BUY_AMOUNT',
    query: { enabled: !!bondingCurveAddress },
  });

  return data ?? 0n;
}

// ── Write hooks ──────────────────────────────────────────────────────

export function useBondingCurveActions(bondingCurveAddress: Address | undefined) {
  const thirdwebAccount = useActiveAccount();
  const { writeContractAsync } = useWriteContract();
  const [status, setStatus] = useState<'idle' | 'confirming' | 'pending' | 'success' | 'error'>(
    'idle'
  );
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const buy = useCallback(
    async (ethAmount: string, slippageBps = 500) => {
      if (!bondingCurveAddress || !thirdwebAccount) {
        setError('Wallet not connected');
        setStatus('error');
        return;
      }

      try {
        setStatus('confirming');
        setError(null);

        const value = parseEther(ethAmount);
        // minTokensOut = 0 for now (slippage protection via frontend warning)
        // In production, call getTokensForEth first and apply slippage
        const minTokensOut = 0n;

        const hash = await writeContractAsync({
          address: bondingCurveAddress,
          abi: BONDING_CURVE_ABI,
          functionName: 'buy',
          args: [minTokensOut],
          value,
        });

        setTxHash(hash);
        setStatus('success');
        return hash;
      } catch (err: any) {
        const message = err?.shortMessage ?? err?.message ?? 'Buy failed';
        if (message.includes('User rejected') || message.includes('user rejected')) {
          setStatus('idle');
          return;
        }
        setError(message);
        setStatus('error');
      }
    },
    [bondingCurveAddress, thirdwebAccount, writeContractAsync]
  );

  const sell = useCallback(
    async (tokenAmount: bigint, minEthOut = 0n) => {
      if (!bondingCurveAddress || !thirdwebAccount) {
        setError('Wallet not connected');
        setStatus('error');
        return;
      }

      try {
        setStatus('confirming');
        setError(null);

        const hash = await writeContractAsync({
          address: bondingCurveAddress,
          abi: BONDING_CURVE_ABI,
          functionName: 'sell',
          args: [tokenAmount, minEthOut],
        });

        setTxHash(hash);
        setStatus('success');
        return hash;
      } catch (err: any) {
        const message = err?.shortMessage ?? err?.message ?? 'Sell failed';
        if (message.includes('User rejected') || message.includes('user rejected')) {
          setStatus('idle');
          return;
        }
        setError(message);
        setStatus('error');
      }
    },
    [bondingCurveAddress, thirdwebAccount, writeContractAsync]
  );

  const reset = useCallback(() => {
    setStatus('idle');
    setTxHash(null);
    setError(null);
  }, []);

  return { buy, sell, status, error, txHash, reset };
}

// ── Composite hook ───────────────────────────────────────────────────

export function useBondingCurve(bondingCurveAddress: Address | undefined) {
  const { state, isLoading: stateLoading, refetch } = useCurveState(bondingCurveAddress);
  const { progress, isLoading: progressLoading } = useCurveProgress(bondingCurveAddress);
  const actions = useBondingCurveActions(bondingCurveAddress);

  const isInBondingPhase = !!bondingCurveAddress && state != null && !state.graduated;

  return {
    state,
    progress,
    isInBondingPhase,
    isLoading: stateLoading || progressLoading,
    refetch,
    ...actions,
  };
}
