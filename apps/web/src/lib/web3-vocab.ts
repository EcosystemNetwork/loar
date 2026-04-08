/**
 * Web3 Vocabulary Mapping
 *
 * Maps blockchain-native terms to user-friendly equivalents.
 * Use `vocab(key, web3Mode)` throughout the UI so labels
 * automatically adapt to the user's disclosure level.
 */

const VOCAB_MAP = {
  mint: { web2: 'Publish', web3: 'Mint' },
  'mint-nft': { web2: 'Publish to Collection', web3: 'Mint NFT' },
  nft: { web2: 'Collectible', web3: 'NFT' },
  nfts: { web2: 'Collectibles', web3: 'NFTs' },
  token: { web2: 'Credits', web3: 'Token' },
  tokens: { web2: 'Credits', web3: 'Tokens' },
  wallet: { web2: 'Account', web3: 'Wallet' },
  'connect-wallet': { web2: 'Sign In', web3: 'Connect Wallet' },
  chain: { web2: 'Network', web3: 'Chain' },
  'gas-fee': { web2: 'Processing fee', web3: 'Gas fee' },
  transaction: { web2: 'Action', web3: 'Transaction' },
  'on-chain': { web2: 'Permanent', web3: 'On-chain' },
  marketplace: { web2: 'Shop', web3: 'Marketplace' },
  'smart-contract': { web2: 'Automated agreement', web3: 'Smart contract' },
  governance: { web2: 'Community voting', web3: 'Governance' },
  dao: { web2: 'Community', web3: 'DAO' },
  stake: { web2: 'Lock credits', web3: 'Stake' },
  royalty: { web2: 'Revenue share', web3: 'Royalty' },
  'token-gate': { web2: 'Members only', web3: 'Token-gated' },
  bridge: { web2: 'Transfer', web3: 'Bridge' },
  'block-explorer': { web2: 'Receipt', web3: 'Block explorer' },
  burn: { web2: 'Remove permanently', web3: 'Burn' },
  airdrop: { web2: 'Free drop', web3: 'Airdrop' },
  listing: { web2: 'For sale', web3: 'Listed' },
} as const;

export type VocabKey = keyof typeof VOCAB_MAP;

/**
 * Returns the appropriate label based on web3Mode.
 *
 * @example
 * vocab('mint', false)  // → "Publish"
 * vocab('mint', true)   // → "Mint"
 */
export function vocab(key: VocabKey, web3Mode: boolean): string {
  const entry = VOCAB_MAP[key];
  return web3Mode ? entry.web3 : entry.web2;
}

/**
 * React hook version — pulls web3Mode from context automatically.
 * Import and call: const v = useVocab(); v('mint')
 */
export { VOCAB_MAP };
