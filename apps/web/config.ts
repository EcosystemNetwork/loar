/**
 * Wagmi Configuration
 *
 * Declares chains, transports, and connectors for wallet interaction.
 * Chain set is controlled by VITE_CHAIN_ENV (see src/configs/chains.ts).
 */

import { createConfig, http } from 'wagmi';
import { sepolia, base, baseSepolia } from 'wagmi/chains';
import { SUPPORTED_EVM_CHAIN_IDS } from './src/configs/chains';

const allChains = {
  [sepolia.id]: sepolia,
  [base.id]: base,
  [baseSepolia.id]: baseSepolia,
} as const;

const chains = SUPPORTED_EVM_CHAIN_IDS.map((id) => allChains[id]);

/** Default chain used for contract interactions and wallet prompts. */
export const defaultChain = chains[0];

const transports = Object.fromEntries(chains.map((c) => [c.id, http()])) as Record<
  (typeof chains)[number]['id'],
  ReturnType<typeof http>
>;

// Connectors are intentionally omitted — thirdweb's ConnectButton manages
// wallet connections (injected, WalletConnect, Coinbase, etc.) and syncs
// state into wagmi automatically.  Declaring wagmi connectors here would
// double-register them, causing each to probe/initialize on page load and
// trigger browser popup-blocked warnings.
export const config = createConfig({
  chains: chains as unknown as readonly [(typeof chains)[0], ...typeof chains],
  transports: transports as any,
  // Disable built-in ENS resolution — the app runs on Base/Sepolia, not
  // mainnet. Without this wagmi attempts mainnet ENS lookups on every
  // connected wallet, producing "Failed to resolve ENS" console errors.
  ens: { enabled: false },
});
