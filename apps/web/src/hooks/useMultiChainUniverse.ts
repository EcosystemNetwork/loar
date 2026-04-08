/**
 * Chain-agnostic universe creation hook.
 * Routes to EVM, Solana, or SUI based on connected wallet.
 */
import { useChainFamily } from './useChainDetection';
import { useUniverseManager } from './useUniverseManager';
import { useSolanaUniverse } from './solana/useSolanaUniverse';
import { useSuiUniverse } from './sui/useSuiUniverse';

export function useMultiChainUniverse() {
  const chain = useChainFamily();
  const evm = useUniverseManager();
  const solana = useSolanaUniverse();
  const sui = useSuiUniverse();

  return {
    chain,
    createUniverse:
      chain === 'evm'
        ? evm.createUniverse
        : chain === 'solana'
          ? solana.createUniverse
          : chain === 'sui'
            ? sui.createUniverse
            : null,
    isPending:
      chain === 'evm'
        ? evm.isPending
        : chain === 'solana'
          ? solana.isPending
          : chain === 'sui'
            ? sui.isPending
            : false,
    error:
      chain === 'evm'
        ? evm.error
        : chain === 'solana'
          ? solana.error
          : chain === 'sui'
            ? sui.error
            : null,
    // Expose chain-specific hooks for advanced usage
    evm,
    solana,
    sui,
  };
}
