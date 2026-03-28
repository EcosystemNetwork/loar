// ── Asset types mirroring PRD 2 data model ──────────────────────

export type AssetKind =
  | 'universe'
  | 'character'
  | 'episode'
  | 'thing'
  | 'token'
  | 'subscription'
  | 'draft'
  | 'revenue';

export interface Universe {
  id: string;
  address: string;
  creator: string;
  tokenAddress: string;
  governanceAddress: string;
  imageUrl: string;
  description: string;
  name?: string;
  onChainUniverseId?: string;
  mintTxHash?: string;
  createdAt: string;
}

export interface NFT {
  id: string;
  tokenId: string;
  contractAddress: string;
  kind: 'episode' | 'character';
  name: string;
  description?: string;
  imageUrl?: string;
  videoUrl?: string;
  universeId?: string;
  universeName?: string;
  ownerAddress: string;
  mintedAt?: string;
  listingPrice?: string;
  isListed: boolean;
}

export interface TokenPosition {
  tokenAddress: string;
  universeId: string;
  universeName?: string;
  symbol: string;
  balance: string; // raw bigint as string
  balanceFormatted: string; // human readable
  imageUrl?: string;
}

export interface Subscription {
  id: string;
  universeId: string;
  universeName?: string;
  universeImageUrl?: string;
  tier: 'FREE' | 'BASIC' | 'PREMIUM' | 'VIP';
  startedAt: string | null;
  expiresAt: string | null;
  autoRenew: boolean;
  active: boolean;
  amount?: string;
}

export interface CreditBalance {
  balance: number;
  totalPurchased: number;
  totalSpent: number;
  totalBonusReceived: number;
  totalLoarPurchases: number;
  totalFiatPurchases: number;
}

export interface CreditPackage {
  id: string;
  name: string;
  credits: number;
  bonusCredits: number;
  fiatPriceUsd: number;
  loarPriceUsd: number;
  loarTokenAmount: number;
  popular: boolean;
  active: boolean;
  loarBonusCredits: number;
}

export interface Draft {
  id: string;
  title: string;
  prompt: string;
  imageUrl: string | null;
  videoUrl: string | null;
  model: string | null;
  tags: string[];
  status: string;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface EarningsBreakdown {
  nftSales: number;
  royalties: number;
  subscriptions: number;
  canon: number;
  ads: number;
  licensing: number;
  total: number;
}

export interface PortfolioSummary {
  creditsBalance: number;
  totalCollectibles: number;
  activeSubscriptions: number;
  pendingEarnings: number;
  universesOwned: number;
  draftsCount: number;
}
