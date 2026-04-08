/**
 * Detect which chain family the user is connected to.
 * Used by multi-chain hooks to route to correct implementation.
 */
import { useMultiChainAuth, type ChainFamily } from '@/lib/use-multi-chain-auth';

export function useChainFamily(): ChainFamily | null {
  const { chainFamily } = useMultiChainAuth();
  return chainFamily;
}

export function useRequireChain(): ChainFamily {
  const chain = useChainFamily();
  if (!chain) throw new Error('No wallet connected');
  return chain;
}
