/**
 * Price — mode-aware monetary value display.
 *
 * Web2 mode: USD via CoinGecko ETH→USD rate ($12.45)
 * Web3 mode: native ETH with chain suffix (0.0042 ETH on Base Sepolia)
 *
 * Falls back to ETH when the rate is unavailable so the UI never blocks.
 */
import { useChainId } from 'wagmi';
import { formatEther } from 'viem';
import { useWeb3Mode } from '@/lib/web3-mode';
import { useEthUsd, formatUsd, formatEth } from '@/hooks/useEthUsd';
import { CHAIN_NAMES, SUPPORTED_EVM_CHAIN_IDS } from '@/configs/chains';

interface PriceProps {
  /** Amount in wei. Either wei or eth must be provided. */
  wei?: bigint | string | null;
  /** Amount in ETH (number). Either wei or eth must be provided. */
  eth?: number | null;
  /** Override chain for chain suffix in web3 mode. Defaults to active chain. */
  chainId?: number;
  /** Hide the "on <Chain>" suffix in web3 mode. */
  hideChain?: boolean;
  /** Compact display ($1.2M, $4.5K). */
  compact?: boolean;
  /** Override decimal places for ETH side. */
  decimals?: number;
  /** Render placeholder when value is null/undefined. */
  placeholder?: string;
  className?: string;
  /** Suffix className (chain pill / unit). */
  suffixClassName?: string;
}

function toEth(wei?: bigint | string | null, eth?: number | null): number | null {
  if (eth != null) return eth;
  if (wei == null) return null;
  try {
    const bi = typeof wei === 'string' ? BigInt(wei) : wei;
    return Number(formatEther(bi));
  } catch {
    return null;
  }
}

export function Price({
  wei,
  eth,
  chainId,
  hideChain,
  compact,
  decimals,
  placeholder = '—',
  className,
  suffixClassName,
}: PriceProps) {
  const { web3Mode } = useWeb3Mode();
  const activeChainId = useChainId();
  const { rate } = useEthUsd();

  const ethAmount = toEth(wei, eth);

  if (ethAmount == null) {
    return <span className={className}>{placeholder}</span>;
  }

  if (!web3Mode) {
    if (rate != null) {
      return <span className={className}>{formatUsd(ethAmount * rate, { compact })}</span>;
    }
    return (
      <span className={className}>
        {formatEth(ethAmount, { decimals })}
        <span className={suffixClassName ?? 'ml-1 opacity-70'}>ETH</span>
      </span>
    );
  }

  const targetChain = chainId ?? activeChainId ?? SUPPORTED_EVM_CHAIN_IDS[0];
  const chainName = CHAIN_NAMES[targetChain];

  return (
    <span className={className}>
      {formatEth(ethAmount, { decimals })}
      <span className={suffixClassName ?? 'ml-1 opacity-70'}>ETH</span>
      {!hideChain && chainName && <span className="ml-1 text-xs opacity-60">on {chainName}</span>}
    </span>
  );
}

/**
 * ListingPrice — multi-currency listing display.
 * Listings are denominated in ETH, LOAR, USDC/USD, or CREDITS.
 * Routes ETH amounts through <Price/>; other currencies render directly.
 */
export function ListingPrice({
  amount,
  currency,
  className,
  hideChain = true,
  freeLabel = 'Free',
}: {
  amount: string | number | null | undefined;
  currency: string | null | undefined;
  className?: string;
  hideChain?: boolean;
  freeLabel?: string;
}) {
  const { web3Mode } = useWeb3Mode();
  const { rate } = useEthUsd();

  const num = typeof amount === 'string' ? parseFloat(amount) : (amount ?? 0);
  if (!Number.isFinite(num) || num === 0) {
    return <span className={className}>{freeLabel}</span>;
  }

  const cur = (currency ?? 'ETH').toUpperCase();

  if (cur === 'ETH') {
    return <Price eth={num} hideChain={hideChain} className={className} />;
  }
  if (cur === 'USD' || cur === 'USDC') {
    return <span className={className}>{formatUsd(num)}</span>;
  }
  if (cur === 'LOAR') {
    if (!web3Mode) {
      return <span className={className}>{num.toLocaleString()} credits</span>;
    }
    return <span className={className}>{num.toLocaleString()} $LOAR</span>;
  }
  if (cur === 'CREDITS') {
    return <span className={className}>{num.toLocaleString()} credits</span>;
  }
  // Unknown currency — display as-is, but in web2 try to show USD if it parses as a number we can convert via ETH rate (fallback)
  void rate;
  return (
    <span className={className}>
      {num} {cur}
    </span>
  );
}

/**
 * PriceText — string-only formatter for cases where JSX can't be rendered
 * (e.g. aria-labels, table cells with custom layout). Same logic as <Price/>.
 */
export function usePriceText() {
  const { web3Mode } = useWeb3Mode();
  const activeChainId = useChainId();
  const { rate } = useEthUsd();

  return function priceText(
    input: { wei?: bigint | string | null; eth?: number | null },
    opts?: { hideChain?: boolean; compact?: boolean; decimals?: number; chainId?: number }
  ): string {
    const ethAmount = toEth(input.wei, input.eth);
    if (ethAmount == null) return '—';

    if (!web3Mode) {
      if (rate != null) return formatUsd(ethAmount * rate, { compact: opts?.compact });
      return `${formatEth(ethAmount, { decimals: opts?.decimals })} ETH`;
    }

    const targetChain = opts?.chainId ?? activeChainId ?? SUPPORTED_EVM_CHAIN_IDS[0];
    const chainName = CHAIN_NAMES[targetChain];
    const base = `${formatEth(ethAmount, { decimals: opts?.decimals })} ETH`;
    return opts?.hideChain || !chainName ? base : `${base} on ${chainName}`;
  };
}
