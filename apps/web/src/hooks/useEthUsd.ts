import { useQuery } from '@tanstack/react-query';
import { formatEther } from 'viem';

const COINGECKO_URL =
  'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd';

async function fetchEthUsd(): Promise<number> {
  const res = await fetch(COINGECKO_URL);
  if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
  const json = (await res.json()) as { ethereum?: { usd?: number } };
  const rate = json.ethereum?.usd;
  if (typeof rate !== 'number' || !Number.isFinite(rate)) {
    throw new Error('Invalid rate');
  }
  return rate;
}

export function useEthUsd() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['eth-usd-rate'],
    queryFn: fetchEthUsd,
    staleTime: 60 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 2,
  });
  return { rate: data ?? null, isLoading, isError };
}

export function ethToUsd(eth: number, rate: number | null): number | null {
  if (rate == null) return null;
  return eth * rate;
}

export function weiToUsd(wei: bigint | string, rate: number | null): number | null {
  if (rate == null) return null;
  try {
    const bi = typeof wei === 'string' ? BigInt(wei) : wei;
    return Number(formatEther(bi)) * rate;
  } catch {
    return null;
  }
}

export function formatUsd(amount: number, opts?: { compact?: boolean }): string {
  if (opts?.compact) {
    if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(2)}M`;
    if (amount >= 10_000) return `$${(amount / 1_000).toFixed(1)}K`;
  }
  const fractionDigits = amount === 0 ? 2 : amount < 0.01 ? 4 : 2;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: fractionDigits,
  }).format(amount);
}

export function formatEth(amount: number, opts?: { decimals?: number }): string {
  if (amount === 0) return '0';
  const decimals = opts?.decimals ?? (amount < 0.0001 ? 6 : amount < 1 ? 4 : 3);
  return amount.toFixed(decimals);
}
