/**
 * Wagmi Configuration
 *
 * Coinbase Smart Wallet (v4) with social logins (Google, email, passkeys)
 * and chain abstraction across multiple L1/L2 networks.
 */

import { createConfig, http } from 'wagmi';
import {
  base,
  baseSepolia,
  sepolia,
  mainnet,
  arbitrum,
  optimism,
  polygon,
} from 'wagmi/chains';
import { coinbaseWallet } from 'wagmi/connectors';

/** Default chain used for contract interactions and wallet prompts. */
export const defaultChain = sepolia;

/**
 * Chain abstraction: users sign in with social (Google, passkeys, email) via
 * Coinbase Smart Wallet and can pay/transact from any supported chain.
 */
export const config = createConfig({
  chains: [sepolia, baseSepolia, base, mainnet, arbitrum, optimism, polygon],
  multiInjectedProviderDiscovery: false,
  connectors: [
    coinbaseWallet({
      appName: 'LOAR - Decentralized Narrative Control',
      appLogoUrl: undefined,
      version: '4',
      preference: 'smartWalletOnly',
    }),
  ],
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
