/**
 * useWalletAccount — Wallet account hook backed by Circle auth session.
 *
 * Previously merged wagmi + thirdweb account state.
 * Now reads from localStorage (set during Circle login) and
 * falls back to wagmi for read-only chain info.
 *
 * Usage: replace `import { useAccount } from 'wagmi'` with
 *        `import { useWalletAccount } from '@/hooks/useWalletAccount'`
 */
import { useAccount } from 'wagmi';
import { getSiweAddress, hasSession } from '@/lib/wallet-auth';
import { useSyncExternalStore } from 'react';

// Re-subscribe to auth state changes
let listeners: Array<() => void> = [];
function subscribe(listener: () => void) {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

// Listen for localStorage changes (cross-tab + same-tab via emitChange)
if (typeof window !== 'undefined') {
  const originalSetItem = localStorage.setItem;
  localStorage.setItem = function (key: string, value: string) {
    originalSetItem.call(this, key, value);
    if (key === 'siwe-address') {
      for (const l of listeners) l();
    }
  };
  const originalRemoveItem = localStorage.removeItem;
  localStorage.removeItem = function (key: string) {
    originalRemoveItem.call(this, key);
    if (key === 'siwe-address') {
      for (const l of listeners) l();
    }
  };
}

function getSnapshot(): string | null {
  return getSiweAddress();
}

function getServerSnapshot(): string | null {
  return null;
}

export function useWalletAccount() {
  const wagmi = useAccount();
  const storedAddress = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // Circle auth: address from session storage
  // wagmi: used for chain info only (read-only contract calls)
  const address = (storedAddress ?? wagmi.address) as `0x${string}` | undefined;
  const isConnected = !!storedAddress || wagmi.isConnected;

  return {
    ...wagmi,
    address,
    isConnected,
  };
}
