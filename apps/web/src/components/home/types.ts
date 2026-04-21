import type { Token } from '@/utils/ponder-api';

export interface EnrichedUniverse {
  id: string;
  name: string;
  description: string;
  imageURL?: string;
  portraitImageURL?: string;
  creator?: string;
  tokenAddress?: string | null;
  governanceAddress?: string | null;
  nodeCount: number;
  createdAt: number;
  tokenData?: Token;
  swapVolume: number;
  holderCount: number;
  _rank?: number;
}
