/**
 * Chain-agnostic NFT minting hook.
 * Routes episode, character, and entity minting to the correct chain.
 */
import { useChainFamily } from './useChainDetection';
import { useEpisodeMint } from './useEpisodeMint';
import { useSolanaMint } from './solana/useSolanaMint';
import { useSuiMint } from './sui/useSuiMint';

export function useMultiChainMint() {
  const chain = useChainFamily();
  const evm = useEpisodeMint();
  const solana = useSolanaMint();
  const sui = useSuiMint();

  return {
    chain,
    // Currently EVM minting is off-chain, Solana/SUI are on-chain stubs
    mintEpisodeEdition:
      chain === 'solana'
        ? solana.mintEpisodeEdition
        : chain === 'sui'
          ? sui.mintEpisodeEdition
          : null, // EVM uses useEpisodeMint separately
    mintCharacter:
      chain === 'solana' ? solana.mintCharacter : chain === 'sui' ? sui.mintCharacter : null,
    mintEntity: chain === 'solana' ? solana.mintEntity : chain === 'sui' ? sui.mintEntity : null,
    isPending: chain === 'solana' ? solana.isPending : chain === 'sui' ? sui.isPending : false,
    error: chain === 'solana' ? solana.error : chain === 'sui' ? sui.error : null,
    evm,
    solana,
    sui,
  };
}
