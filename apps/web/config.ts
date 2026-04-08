/**
 * Wagmi Configuration
 *
 * Used alongside Dynamic Labs wallet provider. Dynamic supplies the
 * connectors — this config only declares chains and transports.
 */

import { createConfig, http } from 'wagmi';
import { base, baseSepolia, sepolia, mainnet, arbitrum, optimism, polygon } from 'wagmi/chains';

/** Default chain used for contract interactions and wallet prompts. */
export const defaultChain = sepolia;

export const config = createConfig({
  chains: [sepolia, baseSepolia, base, mainnet, arbitrum, optimism, polygon],
  multiInjectedProviderDiscovery: false,
  transports: {
    [sepolia.id]: http(),
    [baseSepolia.id]: http(),
    [base.id]: http(),
    [mainnet.id]: http(),
    [arbitrum.id]: http(),
    [optimism.id]: http(),
    [polygon.id]: http(),
  },
});
