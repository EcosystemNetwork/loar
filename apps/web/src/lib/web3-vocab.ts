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
  'mint-as-nft': { web2: 'Publish as Collectible', web3: 'Mint as NFT' },
  minting: { web2: 'Publishing...', web3: 'Minting...' },
  nft: { web2: 'Collectible', web3: 'NFT' },
  'nft-listed': { web2: 'Published!', web3: 'NFT Listed!' },
  nfts: { web2: 'Collectibles', web3: 'NFTs' },
  'nft-sales': { web2: 'Collectible Sales', web3: 'NFT Sales' },
  token: { web2: 'Credits', web3: 'Token' },
  tokens: { web2: 'Credits', web3: 'Tokens' },
  'token-balance': { web2: 'Credit Balance', web3: 'Token Balance' },
  'governance-token': { web2: 'Community Pass', web3: 'Governance Token' },
  'token-holders': { web2: 'Members', web3: 'Token Holders' },
  wallet: { web2: 'Account', web3: 'Wallet' },
  'connect-wallet': { web2: 'Sign In', web3: 'Connect Wallet' },
  'connect-wallet-to-buy': { web2: 'Sign In to Buy', web3: 'Connect Wallet to Buy' },
  'connect-wallet-to-bid': { web2: 'Sign In to Bid', web3: 'Connect Wallet to Bid' },
  'connect-wallet-to-sell': { web2: 'Sign in to sell', web3: 'Connect your wallet to sell' },
  'connect-wallet-to-register': { web2: 'Sign In to Register', web3: 'Connect Wallet to Register' },
  chain: { web2: 'Network', web3: 'Chain' },
  'gas-fee': { web2: 'Processing fee', web3: 'Gas fee' },
  transaction: { web2: 'Action', web3: 'Transaction' },
  'on-chain': { web2: 'Permanent', web3: 'On-chain' },
  marketplace: { web2: 'Shop', web3: 'Marketplace' },
  'canon-marketplace': { web2: 'Canon Shop', web3: 'Canon Marketplace' },
  'smart-contract': { web2: 'Automated agreement', web3: 'Smart contract' },
  governance: { web2: 'Community voting', web3: 'Governance' },
  dao: { web2: 'Community', web3: 'DAO' },
  stake: { web2: 'Lock credits', web3: 'Stake' },
  staking: { web2: 'Credit Locking', web3: 'Staking' },
  'stake-loar': { web2: 'Lock $LOAR', web3: 'Stake $LOAR' },
  unstake: { web2: 'Unlock', web3: 'Unstake' },
  stakers: { web2: 'Top Lockers', web3: 'Top Stakers' },
  'staker-rewards': { web2: 'Holder Rewards', web3: 'Staker Rewards' },
  royalty: { web2: 'Revenue share', web3: 'Royalty' },
  royalties: { web2: 'Revenue shares', web3: 'Royalties' },
  'canon-royalties': { web2: 'Canon Revenue', web3: 'Canon Royalties' },
  'token-gate': { web2: 'Members only', web3: 'Token-gated' },
  'token-gates': { web2: 'Access Rules', web3: 'Token Gates' },
  'token-gate-rules': { web2: 'Access Rules', web3: 'Token Gate Rules' },
  'token-gate-threshold': { web2: 'Access Threshold', web3: 'Token Gate Threshold' },
  bridge: { web2: 'Transfer', web3: 'Bridge' },
  'block-explorer': { web2: 'Receipt', web3: 'Block explorer' },
  burn: { web2: 'Remove permanently', web3: 'Burn' },
  airdrop: { web2: 'Free drop', web3: 'Airdrop' },
  listing: { web2: 'For sale', web3: 'Listed' },
  'voting-power': { web2: 'Influence', web3: 'Voting Power' },
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
