/**
 * useVocab — React hook for chain-agnostic vocabulary.
 *
 * Usage:
 *   const v = useVocab();
 *   <button>{v('mint')}</button>   // "Publish" or "Mint"
 */

import { useWeb3Mode } from '@/lib/web3-mode';
import { vocab, type VocabKey } from '@/lib/web3-vocab';

export function useVocab() {
  const { web3Mode } = useWeb3Mode();
  return (key: VocabKey) => vocab(key, web3Mode);
}
