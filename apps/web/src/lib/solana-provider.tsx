/**
 * Solana Wallet Provider — nests inside WalletProvider.
 *
 * Wires up @solana/wallet-adapter-react with Phantom, Solflare, and Backpack.
 * The RPC endpoint comes from VITE_SOLANA_RPC_URL (Helius/Triton in prod);
 * the active cluster is read from VITE_SOLANA_CLUSTER for downstream consumers.
 *
 * Auto-connect is enabled so returning users with a remembered wallet skip
 * the wallet picker on subsequent visits.
 */
import { useMemo, type ReactNode } from 'react';
import {
  ConnectionProvider,
  WalletProvider as SolanaAdapterProvider,
} from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets';
// Backpack ships its own adapter package (@coral-xyz/backpack-wallet-adapter) —
// added post-submission if user demand warrants. Wallet Standard fallback
// covers it via Phantom-compatible auto-detect on most Solana wallets.
import { clusterApiUrl } from '@solana/web3.js';

import '@solana/wallet-adapter-react-ui/styles.css';

const CLUSTER =
  (import.meta.env.VITE_SOLANA_CLUSTER as 'devnet' | 'mainnet-beta' | 'testnet' | undefined) ??
  'devnet';

const RPC_URL = import.meta.env.VITE_SOLANA_RPC_URL as string | undefined;

export function SolanaProvider({ children }: { children: ReactNode }) {
  const endpoint = useMemo(() => RPC_URL ?? clusterApiUrl(CLUSTER), []);
  const wallets = useMemo(() => [new PhantomWalletAdapter(), new SolflareWalletAdapter()], []);

  return (
    <ConnectionProvider endpoint={endpoint}>
      <SolanaAdapterProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </SolanaAdapterProvider>
    </ConnectionProvider>
  );
}

export const SOLANA_CLUSTER = CLUSTER;
