/**
 * Reown AppKit initialization for mobile wallet connection.
 *
 * AppKit handles WalletConnect v2 session management, wallet deep links,
 * and EIP-1193 provider for message signing.
 *
 * Setup:
 *  1. Get a project ID from https://cloud.reown.com
 *  2. Set EXPO_PUBLIC_REOWN_PROJECT_ID in your .env
 *  3. Replace "YOUR_REOWN_PROJECT_ID" in app.json plugins config
 */
import { createAppKit, defaultConfig } from '@reown/appkit-react-native';

const projectId = process.env.EXPO_PUBLIC_REOWN_PROJECT_ID ?? 'YOUR_REOWN_PROJECT_ID';

// Supported chains — Sepolia testnet (primary) + Ethereum mainnet (future)
const chains = [
  {
    chainId: 11155111,
    name: 'Ethereum Sepolia',
    currency: 'ETH',
    explorerUrl: 'https://sepolia.etherscan.io',
    rpcUrl: 'https://rpc.sepolia.org',
  },
  {
    chainId: 1,
    name: 'Ethereum',
    currency: 'ETH',
    explorerUrl: 'https://etherscan.io',
    rpcUrl: 'https://cloudflare-eth.com',
  },
] as const;

const metadata = {
  name: 'LOAR Vault',
  description: 'Decentralized portfolio for your LOAR universes, collectibles, and earnings',
  url: 'https://loartech.xyz',
  icons: ['https://loartech.xyz/icon.png'],
  redirect: {
    native: 'loarvault://',
    universal: 'https://loartech.xyz',
  },
};

export const appKitConfig = defaultConfig({ metadata, chains });

export function initAppKit() {
  createAppKit({
    projectId,
    chains,
    config: appKitConfig,
    themeMode: 'dark',
    themeVariables: {
      '--w3m-accent': '#7c3aed',
      '--w3m-background': '#000000',
    },
    featuredWalletIds: [
      'c57ca95b47569778a828d19178114f4db188b89b763c899ba0be274e97267d96', // MetaMask
      'fd20dc426fb37566d803205b19bbc1d4096b248ac04548695ad517d10d9b01f', // Coinbase Wallet
      '4622a2b2d6af1c9844944291e5e7351a6aa24cd7b23099efac1b2fd875da31a0', // Trust Wallet
    ],
  });
}
