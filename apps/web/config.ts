/**
 * Wagmi Configuration
 *
 * Declares chains, transports, and connectors for wallet interaction.
 * Chain set is controlled by VITE_CHAIN_ENV (see src/configs/chains.ts).
 */

import { createConfig, http } from 'wagmi';
import { sepolia, base, baseSepolia } from 'wagmi/chains';
import { injected, walletConnect, coinbaseWallet } from 'wagmi/connectors';
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

export const config = createConfig({
  chains: chains as unknown as readonly [(typeof chains)[0], ...typeof chains],
  connectors: [
    injected(),
    coinbaseWallet({ appName: 'LOAR' }),
    ...(import.meta.env.VITE_WALLETCONNECT_PROJECT_ID
      ? [walletConnect({ projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID })]
      : []),
  ],
  transports: transports as any,
});
