/**
 * Wormhole Bridge Configuration
 *
 * Configuration for bridging $LOAR between Base (EVM) and Solana
 * using Wormhole's Token Bridge (Portal).
 *
 * The same $LOAR token exists on both chains:
 * - Base: ERC20 with 0.05% transfer fee (LoarToken.sol)
 * - Solana: SPL Token 2022 with 0.05% transfer fee (native extension)
 *
 * Wormhole mints a wrapped version on the destination chain.
 * The native token on each chain is the "real" one; wrapped tokens
 * can be redeemed back to native by bridging in reverse.
 */

// ---------------------------------------------------------------------------
// Wormhole Chain IDs (NOT the same as EVM chain IDs)
// ---------------------------------------------------------------------------

export const WORMHOLE_CHAIN_IDS = {
  ethereum: 2,
  solana: 1,
  base: 30,
  sui: 21,
} as const;

// ---------------------------------------------------------------------------
// Contract Addresses
// ---------------------------------------------------------------------------

/** Wormhole core bridge contract addresses. */
export const WORMHOLE_CORE_BRIDGE = {
  // Mainnet
  base: '0xbebdb6C8ddC678FfA9f8748f85C815C556Dd8ac6',
  solana: 'worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth',
  sui: '0xaeab97f96cf9877fee2883315d459552b2b921edc16d7ceac6eab944dd88919c',
  // Testnet
  baseSepolia: '0x79A1027a6A159502049F10906D333EC57E95F083',
  solanaDevnet: '3u8hJUVTA4jH1wYAyUur7FFZVQ8H634K3yVk7rs3PqDL',
  suiTestnet: '0x31358d198147da50db32eda2562951d53973a0c0ad5ed738e9b17d88b213d790',
} as const;

/** Wormhole Token Bridge (Portal) addresses. */
export const WORMHOLE_TOKEN_BRIDGE = {
  // Mainnet
  base: '0x8d2de8d2f73F1F4cAB472AC9A881C9b123C79627',
  solana: 'wormDTUJ6AWPNvk59vGQbDvGJmqbDTdgWgAqcLBCgUb',
  sui: '0xc57508ee0d4595e5a8728974a4a93a787d38f339757230d441e895422c07aba9',
  // Testnet
  baseSepolia: '0x86F55A04690fd7815A3D802bD587e83eA888B239',
  solanaDevnet: 'DZnkkTmCiFWfYTfT41X3Rd1kDgozqzxWaHqsw6W4x2oe',
  suiTestnet: '0x6fb10cdb7aa299e9a4f5b66e47089fb95d48ab14a024ac81cad49deb0d6f571b',
} as const;

// ---------------------------------------------------------------------------
// Bridge Config
// ---------------------------------------------------------------------------

export interface BridgeConfig {
  /** Source chain Wormhole ID. */
  sourceChain: number;
  /** Destination chain Wormhole ID. */
  destChain: number;
  /** LOAR token address on source chain. */
  sourceToken: string;
  /** Wrapped LOAR address on destination (set after first bridge). */
  wrappedToken: string;
  /** Token Bridge contract on source. */
  tokenBridge: string;
  /** Whether this is a testnet config. */
  isTestnet: boolean;
}

/** Pre-configured bridge routes for $LOAR. */
export const BRIDGE_ROUTES: Record<string, BridgeConfig> = {
  'base-to-solana': {
    sourceChain: WORMHOLE_CHAIN_IDS.base,
    destChain: WORMHOLE_CHAIN_IDS.solana,
    sourceToken: '', // Set after LOAR deployment on Base
    wrappedToken: '', // Set after first bridge attestation
    tokenBridge: WORMHOLE_TOKEN_BRIDGE.base,
    isTestnet: false,
  },
  'solana-to-base': {
    sourceChain: WORMHOLE_CHAIN_IDS.solana,
    destChain: WORMHOLE_CHAIN_IDS.base,
    sourceToken: '', // Set after LOAR deployment on Solana
    wrappedToken: '', // Set after first bridge attestation
    tokenBridge: WORMHOLE_TOKEN_BRIDGE.solana,
    isTestnet: false,
  },
  'base-sepolia-to-solana-devnet': {
    sourceChain: WORMHOLE_CHAIN_IDS.base,
    destChain: WORMHOLE_CHAIN_IDS.solana,
    sourceToken: '',
    wrappedToken: '',
    tokenBridge: WORMHOLE_TOKEN_BRIDGE.baseSepolia,
    isTestnet: true,
  },
  'solana-devnet-to-base-sepolia': {
    sourceChain: WORMHOLE_CHAIN_IDS.solana,
    destChain: WORMHOLE_CHAIN_IDS.base,
    sourceToken: '',
    wrappedToken: '',
    tokenBridge: WORMHOLE_TOKEN_BRIDGE.solanaDevnet,
    isTestnet: true,
  },
  // SUI routes
  'base-to-sui': {
    sourceChain: WORMHOLE_CHAIN_IDS.base,
    destChain: WORMHOLE_CHAIN_IDS.sui,
    sourceToken: '',
    wrappedToken: '',
    tokenBridge: WORMHOLE_TOKEN_BRIDGE.base,
    isTestnet: false,
  },
  'sui-to-base': {
    sourceChain: WORMHOLE_CHAIN_IDS.sui,
    destChain: WORMHOLE_CHAIN_IDS.base,
    sourceToken: '',
    wrappedToken: '',
    tokenBridge: WORMHOLE_TOKEN_BRIDGE.sui,
    isTestnet: false,
  },
  'base-sepolia-to-sui-testnet': {
    sourceChain: WORMHOLE_CHAIN_IDS.base,
    destChain: WORMHOLE_CHAIN_IDS.sui,
    sourceToken: '',
    wrappedToken: '',
    tokenBridge: WORMHOLE_TOKEN_BRIDGE.baseSepolia,
    isTestnet: true,
  },
  'sui-testnet-to-base-sepolia': {
    sourceChain: WORMHOLE_CHAIN_IDS.sui,
    destChain: WORMHOLE_CHAIN_IDS.base,
    sourceToken: '',
    wrappedToken: '',
    tokenBridge: WORMHOLE_TOKEN_BRIDGE.suiTestnet,
    isTestnet: true,
  },
};

// ---------------------------------------------------------------------------
// Bridge Helpers
// ---------------------------------------------------------------------------

/**
 * Estimate bridge transfer time.
 * Wormhole finality: Base ~15min, Solana ~15sec.
 * Total includes guardian attestation (~1-2 min).
 */
export function estimateBridgeTime(sourceChain: 'base' | 'solana' | 'sui'): {
  minSeconds: number;
  maxSeconds: number;
} {
  if (sourceChain === 'base') {
    return { minSeconds: 900, maxSeconds: 1200 }; // 15-20 min
  }
  if (sourceChain === 'sui') {
    return { minSeconds: 60, maxSeconds: 180 }; // 1-3 min (~3sec finality + guardian)
  }
  return { minSeconds: 60, maxSeconds: 180 }; // 1-3 min (Solana)
}

/**
 * The 0.05% transfer fee applies on BOTH chains independently:
 * - Bridging OUT of Base: 0.05% fee on the EVM transfer to the bridge
 * - Bridging INTO Solana: the wrapped token receives the net amount
 * - The fee feeds LP on the source chain
 *
 * This means cross-chain arbitrage naturally feeds both pools.
 */
export const BRIDGE_FEE_NOTE =
  'A 0.05% transfer fee is collected on the source chain when bridging. ' +
  'This fee goes to the LOAR liquidity pool on that chain.';
