/**
 * NTT (Native Token Transfers) Configuration
 *
 * $LOAR token bridge configuration across 4 chains:
 *   - Base (Hub / Locking) — 1B supply minted here
 *   - Solana (Spoke / Burn-and-Mint)
 *   - SUI (Spoke / Burn-and-Mint)
 *   - Ethereum (Spoke / Burn-and-Mint)
 *
 * When bridging FROM Base: tokens are locked in NTT Manager escrow
 * When bridging TO Base: tokens are released from escrow
 * When bridging between spokes: burn on source, mint on destination
 *
 * The 0.05% transfer fee fires on the source chain for every bridge transfer.
 */

// ---------------------------------------------------------------------------
// Chain Config
// ---------------------------------------------------------------------------

export interface NttChainConfig {
  /** Wormhole chain name (matches NTT CLI). */
  chain: string;
  /** Wormhole chain ID. */
  wormholeChainId: number;
  /** NTT mode: 'locking' for hub, 'burning' for spokes. */
  mode: 'locking' | 'burning';
  /** LOAR token address on this chain. */
  token: string;
  /** NTT Manager contract/program address. */
  manager: string;
  /** Wormhole Transceiver address. */
  transceiver: string;
  /** RPC endpoint. */
  rpc: string;
  /** Whether this is the hub chain (where 1B supply lives). */
  isHub: boolean;
}

// ---------------------------------------------------------------------------
// Testnet Configuration
// ---------------------------------------------------------------------------

export const NTT_TESTNET_CONFIG: Record<string, NttChainConfig> = {
  baseSepolia: {
    chain: 'BaseSepolia',
    wormholeChainId: 30,
    mode: 'locking', // HUB — tokens locked, not burned
    token: process.env.VITE_LOAR_TOKEN_BASE_SEPOLIA || '',
    manager: '', // Set after `ntt deploy`
    transceiver: '', // Set after `ntt deploy`
    rpc: process.env.VITE_RPC_BASE_SEPOLIA || 'https://sepolia.base.org',
    isHub: true,
  },
  solana: {
    chain: 'Solana',
    wormholeChainId: 1,
    mode: 'burning', // SPOKE — burn on departure, mint on arrival
    token: '', // SPL Token 2022 mint address
    manager: '', // NTT Solana program
    transceiver: '',
    rpc: process.env.VITE_SOLANA_RPC_URL || 'https://api.devnet.solana.com',
    isHub: false,
  },
  sui: {
    chain: 'Sui',
    wormholeChainId: 21,
    mode: 'burning',
    token: '', // SUI coin type
    manager: '',
    transceiver: '',
    rpc: process.env.VITE_SUI_RPC_URL || 'https://fullnode.testnet.sui.io',
    isHub: false,
  },
  sepolia: {
    chain: 'Sepolia',
    wormholeChainId: 10002,
    mode: 'burning',
    token: '', // ERC20 on Ethereum Sepolia
    manager: '',
    transceiver: '',
    rpc: process.env.VITE_RPC_SEPOLIA || '',
    isHub: false,
  },
};

// ---------------------------------------------------------------------------
// Mainnet Configuration (fill after testnet validated)
// ---------------------------------------------------------------------------

export const NTT_MAINNET_CONFIG: Record<string, NttChainConfig> = {
  base: {
    chain: 'Base',
    wormholeChainId: 30,
    mode: 'locking',
    token: '',
    manager: '',
    transceiver: '',
    rpc: process.env.VITE_RPC_BASE || 'https://mainnet.base.org',
    isHub: true,
  },
  solana: {
    chain: 'Solana',
    wormholeChainId: 1,
    mode: 'burning',
    token: '',
    manager: '',
    transceiver: '',
    rpc: process.env.VITE_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
    isHub: false,
  },
  sui: {
    chain: 'Sui',
    wormholeChainId: 21,
    mode: 'burning',
    token: '',
    manager: '',
    transceiver: '',
    rpc: process.env.VITE_SUI_RPC_URL || 'https://fullnode.mainnet.sui.io',
    isHub: false,
  },
  ethereum: {
    chain: 'Ethereum',
    wormholeChainId: 2,
    mode: 'burning',
    token: '',
    manager: '',
    transceiver: '',
    rpc: process.env.VITE_RPC_ETHEREUM || '',
    isHub: false,
  },
};

// ---------------------------------------------------------------------------
// Rate Limits
// ---------------------------------------------------------------------------

/**
 * Per-chain rate limits for NTT transfers.
 * These prevent a compromised spoke from draining the hub.
 *
 * Inbound = receiving tokens from another chain.
 * Outbound = sending tokens to another chain.
 * Values in LOAR (no decimals — NTT CLI handles scaling).
 */
export const RATE_LIMITS = {
  /** Max tokens that can leave any single chain per 24h. */
  outboundPerDay: 5_000_000, // 5M LOAR (0.5% of supply) — start conservative, raise after confidence

  /** Max tokens that can arrive on any single chain per 24h. */
  inboundPerDay: 5_000_000,

  /** Per-transfer cap. */
  maxPerTransfer: 1_000_000, // 1M LOAR
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Get all spoke chains (everything except the hub). */
export function getSpokes(config: Record<string, NttChainConfig>): NttChainConfig[] {
  return Object.values(config).filter((c) => !c.isHub);
}

/** Get the hub chain config. */
export function getHub(config: Record<string, NttChainConfig>): NttChainConfig | undefined {
  return Object.values(config).find((c) => c.isHub);
}

/**
 * When a user bridges LOAR, the 0.05% transfer fee is collected on the
 * source chain. This means:
 *
 * - Base → Solana: 0.05% goes to Base LP (from the lock transfer to NTT Manager)
 * - Solana → Base: 0.05% goes to Solana LP (from the burn transfer)
 * - Solana → SUI: 0.05% goes to Solana LP + 0% on SUI (mint is fee-exempt)
 *
 * Cross-chain arbitrage creates a natural flow:
 * If LOAR is $0.12 on Base and $0.11 on Solana, arbers bridge Solana→Base,
 * paying 0.05% to Solana LP. This activity deepens the cheaper pool.
 */
export const FEE_BEHAVIOR = {
  hubToSpoke: 'Fee on hub (lock transfer to NTT Manager)',
  spokeToHub: 'Fee on spoke (burn transfer)',
  spokeToSpoke: 'Fee on source spoke (burn transfer)',
} as const;
