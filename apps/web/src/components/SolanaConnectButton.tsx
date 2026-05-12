/**
 * Solana Connect Button — Phantom / Solflare / Backpack + SIWS sign-in.
 *
 * Three states:
 *   1. Disconnected     → "Connect Solana" (opens wallet picker)
 *   2. Connected, not signed in → "Sign in with Solana" (triggers SIWS)
 *   3. Signed in        → shows truncated address + sign-out
 *
 * Drop anywhere the existing EVM connect button lives. Independent state —
 * a user can be signed in via EVM/Circle AND have a Solana session, or only
 * one of the two.
 */
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { useSolanaAuth } from '../lib/solana-auth';

function truncate(addr: string): string {
  return addr.length > 10 ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : addr;
}

export function SolanaConnectButton() {
  const { wallet, signIn, signOut, isAuthenticated, isSigningIn, address, error } = useSolanaAuth();
  const { setVisible } = useWalletModal();

  if (isAuthenticated && address) {
    return (
      <button
        type="button"
        onClick={() => void signOut()}
        className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm font-medium text-neutral-200 hover:bg-neutral-800"
        title={`Solana: ${address}`}
      >
        ◎ {truncate(address)}
      </button>
    );
  }

  if (!wallet.connected) {
    return (
      <button
        type="button"
        onClick={() => setVisible(true)}
        className="rounded-md bg-purple-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-purple-500"
      >
        Connect Solana
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void signIn()}
      disabled={isSigningIn}
      className="rounded-md bg-purple-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-purple-500 disabled:opacity-50"
      title={error ?? undefined}
    >
      {isSigningIn ? 'Signing…' : 'Sign in with Solana'}
    </button>
  );
}
