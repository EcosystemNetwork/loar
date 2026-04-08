/**
 * ChainBadge — Shows the active chain when Web3 mode is on.
 *
 * Displays a small pill with chain icon + name next to the wallet.
 * Hidden entirely when web3Mode is off.
 */

import { useWeb3Mode } from '@/lib/web3-mode';
import { useMultiChainAuth, type ChainFamily } from '@/lib/use-multi-chain-auth';
import { Badge } from '@/components/ui/badge';

const CHAIN_INFO: Record<ChainFamily, { label: string; color: string }> = {
  evm: { label: 'Base', color: 'bg-blue-500/10 text-blue-400 border-blue-500/20' },
  solana: { label: 'Solana', color: 'bg-purple-500/10 text-purple-400 border-purple-500/20' },
  sui: { label: 'SUI', color: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20' },
};

export function ChainBadge() {
  const { web3Mode } = useWeb3Mode();
  const { chainFamily, isAuthenticated } = useMultiChainAuth();

  if (!web3Mode || !isAuthenticated || !chainFamily) return null;

  const info = CHAIN_INFO[chainFamily];

  return (
    <Badge variant="outline" className={`text-xs font-medium px-2 py-0.5 ${info.color}`}>
      {info.label}
    </Badge>
  );
}
