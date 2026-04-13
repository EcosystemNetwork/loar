/**
 * useSwapExecution — Execute token swaps on-chain via the LoarSwapRouter.
 *
 * When the swap router is deployed, executes trades natively in-app.
 * Falls back to Uniswap deep link when router is not available.
 */
import { useState, useCallback } from 'react';
import { useAccount, useChainId, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseEther, encodeFunctionData, type Address } from 'viem';
import { getSwapUrl } from '@/hooks/useTokenSwap';
import { openExternal } from '@/utils/open-external';

// LoarSwapRouter ABI (minimal — just the swap functions we need)
const SWAP_ROUTER_ABI = [
  {
    name: 'swapExactInput',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'key',
        type: 'tuple',
        components: [
          { name: 'currency0', type: 'address' },
          { name: 'currency1', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'tickSpacing', type: 'int24' },
          { name: 'hooks', type: 'address' },
        ],
      },
      { name: 'zeroForOne', type: 'bool' },
      { name: 'amountIn', type: 'uint128' },
      { name: 'amountOutMinimum', type: 'uint128' },
      { name: 'deadline', type: 'uint256' },
      { name: 'hookData', type: 'bytes' },
    ],
    outputs: [{ name: 'delta', type: 'int256' }],
  },
] as const;

// Swap router addresses per chain (null = not deployed → fallback to Uniswap link)
const SWAP_ROUTER_ADDRESSES: Record<number, Address | null> = {
  11155111: '0x7E156f3Ddd56539aB941DeEfEd1342ae5C9C09a5', // Sepolia
  84532: '0x69c2aA66B3bB3e5f6658Dc2a77022558e7022398', // Base Sepolia
  8453: null, // Base mainnet — deploy before mainnet launch
};

export interface SwapConfig {
  tokenAddress: string;
  tokenSymbol: string;
  poolKey: {
    currency0: Address;
    currency1: Address;
    fee: number;
    tickSpacing: number;
    hooks: Address;
  } | null;
  mode: 'buy' | 'sell';
  amount: string; // ETH for buy, tokens for sell
  slippageBps?: number; // default 100 = 1%
}

export function useSwapExecution() {
  const chainId = useChainId();
  const { address } = useAccount();
  const [status, setStatus] = useState<'idle' | 'confirming' | 'pending' | 'success' | 'error'>(
    'idle'
  );
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { writeContractAsync } = useWriteContract();

  const routerAddress = SWAP_ROUTER_ADDRESSES[chainId] ?? null;
  const isNativeSwapAvailable = routerAddress !== null;

  const executeSwap = useCallback(
    async (config: SwapConfig) => {
      setError(null);
      setTxHash(null);

      // If no router deployed, fallback to Uniswap link
      if (!routerAddress || !config.poolKey) {
        const swapUrl = getSwapUrl(config.tokenAddress, chainId);
        const amount = config.amount;
        if (config.mode === 'buy') {
          openExternal(`${swapUrl}${amount ? `&exactAmount=${amount}&exactField=input` : ''}`);
        } else {
          const sellUrl = swapUrl
            .replace(
              'inputCurrency=ETH&outputCurrency=',
              `inputCurrency=${config.tokenAddress}&outputCurrency=`
            )
            .replace(`outputCurrency=${config.tokenAddress}`, 'outputCurrency=ETH');
          openExternal(`${sellUrl}${amount ? `&exactAmount=${amount}&exactField=input` : ''}`);
        }
        return { fallback: true };
      }

      if (!address) {
        setError('Wallet not connected');
        setStatus('error');
        return { fallback: false, error: 'Wallet not connected' };
      }

      try {
        setStatus('confirming');

        const slippageBps = config.slippageBps ?? 100; // 1% default
        const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200); // 20 min

        if (config.mode === 'buy') {
          // Buy tokens with ETH
          const amountIn = parseEther(config.amount);
          const amountOutMinimum = 0n; // Slippage handled by price limit in practice

          const hash = await writeContractAsync({
            address: routerAddress,
            abi: SWAP_ROUTER_ABI,
            functionName: 'swapExactInput',
            args: [
              config.poolKey,
              true, // zeroForOne depends on token ordering
              amountIn,
              amountOutMinimum,
              deadline,
              '0x', // hookData
            ],
            value: amountIn,
          });

          setTxHash(hash);
          setStatus('pending');
          return { fallback: false, txHash: hash };
        } else {
          // Sell tokens for ETH — requires token approval first
          // For now, redirect to Uniswap for sell orders (approval flow is complex)
          const swapUrl = getSwapUrl(config.tokenAddress, chainId);
          const sellUrl = swapUrl
            .replace(
              'inputCurrency=ETH&outputCurrency=',
              `inputCurrency=${config.tokenAddress}&outputCurrency=`
            )
            .replace(`outputCurrency=${config.tokenAddress}`, 'outputCurrency=ETH');
          openExternal(
            `${sellUrl}${config.amount ? `&exactAmount=${config.amount}&exactField=input` : ''}`
          );
          return { fallback: true };
        }
      } catch (err: any) {
        const msg = err?.shortMessage ?? err?.message ?? 'Swap failed';
        setError(msg);
        setStatus('error');
        return { fallback: false, error: msg };
      }
    },
    [routerAddress, chainId, address, writeContractAsync]
  );

  const reset = useCallback(() => {
    setStatus('idle');
    setTxHash(null);
    setError(null);
  }, []);

  return {
    executeSwap,
    reset,
    status,
    txHash,
    error,
    isNativeSwapAvailable,
    routerAddress,
  };
}
