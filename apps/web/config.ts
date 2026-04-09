/**
 * Wagmi Configuration
 *
 * Used alongside Dynamic Labs wallet provider. Dynamic supplies the
 * connectors — this config only declares chains and transports.
 */

import { createConfig, http } from 'wagmi';
import { sepolia } from 'wagmi/chains';

/** Default chain used for contract interactions and wallet prompts. */
export const defaultChain = sepolia;

export const config = createConfig({
  chains: [sepolia],
  multiInjectedProviderDiscovery: false,
  transports: {
    [sepolia.id]: http(),
  },
});
