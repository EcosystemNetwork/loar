/**
 * Web3Gate — Conditional rendering based on Web3 mode.
 *
 * Shows children only when web3Mode is enabled.
 * Optionally shows a fallback (web2-friendly) component instead.
 */

import { useWeb3Mode } from '@/lib/web3-mode';
import type { ReactNode } from 'react';

interface Web3GateProps {
  children: ReactNode;
  /** Shown when web3Mode is OFF (optional) */
  fallback?: ReactNode;
}

/**
 * Renders children only when Web3 mode is enabled.
 *
 * Usage:
 *   <Web3Gate fallback={<span>Publish</span>}>
 *     <span>Mint NFT on Base</span>
 *   </Web3Gate>
 */
export function Web3Gate({ children, fallback = null }: Web3GateProps) {
  const { web3Mode } = useWeb3Mode();
  return <>{web3Mode ? children : fallback}</>;
}

/**
 * Inverse — renders children only when Web3 mode is OFF.
 */
export function Web2Only({ children }: { children: ReactNode }) {
  const { web3Mode } = useWeb3Mode();
  return <>{web3Mode ? null : children}</>;
}
