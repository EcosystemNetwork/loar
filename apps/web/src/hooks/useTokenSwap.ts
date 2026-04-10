/**
 * useTokenSwap — fetch pool data and provide swap link for universe tokens.
 *
 * Reads pool info from the Ponder indexer and constructs a Uniswap deep link.
 * Direct on-chain swaps through PoolManager are complex (routing, slippage),
 * so we link to the Uniswap interface for now.
 */
import { useQuery } from '@tanstack/react-query';
import { ponderGql, ponderQueryDefaults, type Token } from '@/utils/ponder-api';

interface PoolInfo {
  tokenAddress: string;
  tokenName: string;
  tokenSymbol: string;
  poolId: string;
  pairedToken: string;
}

export function useTokenPool(universeAddress: string | undefined) {
  return useQuery({
    queryKey: ['token-pool', universeAddress],
    queryFn: async () => {
      const data = await ponderGql<{ tokens: { items: Token[] } }>(
        `query ($universeAddress: String!) {
          tokens(where: { universeAddress: $universeAddress }, limit: 1) {
            items {
              id
              name
              symbol
              poolId
              pairedToken
              universeAddress
            }
          }
        }`,
        { universeAddress }
      );
      const token = data.tokens.items[0];
      if (!token) return null;
      return {
        tokenAddress: token.id,
        tokenName: token.name,
        tokenSymbol: token.symbol,
        poolId: token.poolId,
        pairedToken: token.pairedToken,
      } as PoolInfo;
    },
    enabled: !!universeAddress,
    ...ponderQueryDefaults,
  });
}

/**
 * Build Uniswap swap URL for a universe token.
 */
export function getSwapUrl(tokenAddress: string, chainId: number): string {
  const chainName = chainId === 11155111 ? 'sepolia' : chainId === 8453 ? 'base' : 'mainnet';
  return `https://app.uniswap.org/swap?inputCurrency=ETH&outputCurrency=${tokenAddress}&chain=${chainName}`;
}
