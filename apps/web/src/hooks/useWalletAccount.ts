/**
 * useWalletAccount — drop-in replacement for wagmi's useAccount()
 * that also checks thirdweb's active account as a fallback.
 *
 * Thirdweb manages wallet connections via its ConnectButton, but wagmi
 * may not have synced the connection state yet. This hook merges both
 * sources so components always see the connected wallet.
 *
 * Usage: replace `import { useAccount } from 'wagmi'` with
 *        `import { useWalletAccount } from '@/hooks/useWalletAccount'`
 */
import { useAccount } from 'wagmi';
import { useActiveAccount } from 'thirdweb/react';

export function useWalletAccount() {
  const wagmi = useAccount();
  const thirdwebAccount = useActiveAccount();

  const address = (wagmi.address ?? thirdwebAccount?.address) as `0x${string}` | undefined;
  const isConnected = wagmi.isConnected || !!thirdwebAccount;

  return {
    ...wagmi,
    address,
    isConnected,
  };
}
