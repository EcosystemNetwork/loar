/**
 * FaucetBanner — tells fresh Circle wallets where to get Base-Sepolia ETH.
 *
 * Circle Developer Controlled Wallets ship empty. Every on-chain write
 * costs gas. Until Circle Gas Station sponsorship is wired, the user has
 * to fund their own wallet from an external Sepolia faucet.
 *
 * The banner auto-hides once the wallet has > ~0.001 ETH, and auto-hides
 * if the user dismisses it (per-session, not persisted — a fresh session
 * on a still-empty wallet will re-show).
 */
import { useBalance, useChainId } from 'wagmi';
import { useState } from 'react';
import { ExternalLink, Droplets, X, Copy, Check } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { isSupportedChain } from '@/configs/chains';

// Hand-picked public faucets, in order of reliability/ease. No auth walls
// beyond a wallet connect / GitHub/Twitter for some.
const FAUCETS: { chainId: number; name: string; url: string; note?: string }[] = [
  {
    chainId: 84532,
    name: 'Alchemy Base Sepolia Faucet',
    url: 'https://www.alchemy.com/faucets/base-sepolia',
    note: 'No login required for 0.1 ETH/day',
  },
  {
    chainId: 84532,
    name: 'Coinbase Base Sepolia Faucet',
    url: 'https://portal.cdp.coinbase.com/products/faucet',
    note: 'CDP login required',
  },
  {
    chainId: 11155111,
    name: 'Alchemy Sepolia Faucet',
    url: 'https://www.alchemy.com/faucets/ethereum-sepolia',
  },
  {
    chainId: 11155111,
    name: 'Google Cloud Sepolia Faucet',
    url: 'https://cloud.google.com/application/web3/faucet/ethereum/sepolia',
  },
];

const MIN_GAS_WEI = 1_000_000_000_000_000n; // 0.001 ETH — rough floor for a few writes

export function FaucetBanner({ address }: { address: `0x${string}` | undefined }) {
  const chainId = useChainId();
  const [dismissed, setDismissed] = useState(false);
  const [copied, setCopied] = useState(false);

  const { data: balance, isLoading } = useBalance({
    address,
    chainId,
    query: { enabled: !!address, refetchInterval: 15_000 },
  });

  if (!address || dismissed || isLoading) return null;
  if (balance && balance.value >= MIN_GAS_WEI) return null;
  if (!isSupportedChain(chainId)) return null;

  const relevantFaucets = FAUCETS.filter((f) => f.chainId === chainId);
  if (relevantFaucets.length === 0) return null;

  const copy = () => {
    void navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Card className="border-indigo-500/30 bg-gradient-to-br from-indigo-500/10 via-purple-500/5 to-transparent">
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start gap-4">
          <div className="rounded-lg bg-indigo-500/15 p-2.5 shrink-0">
            <Droplets className="h-5 w-5 text-indigo-400" />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Fund your wallet to start</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Your LOAR wallet needs Base-Sepolia ETH before you can mint, create, or trade.
                  It&apos;s free — grab some from a faucet below.
                </p>
              </div>
              <button
                onClick={() => setDismissed(true)}
                aria-label="Dismiss"
                className="shrink-0 text-muted-foreground/60 hover:text-muted-foreground transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Address to paste into faucet */}
            <div className="mt-3 flex items-center gap-2 bg-background/60 border border-border rounded-md px-2.5 py-1.5">
              <code className="text-[11px] sm:text-xs font-mono truncate flex-1">{address}</code>
              <button
                onClick={copy}
                className="shrink-0 text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
              >
                {copied ? (
                  <>
                    <Check className="h-3 w-3" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" />
                    Copy
                  </>
                )}
              </button>
            </div>

            {/* Faucet links */}
            <div className="mt-3 flex flex-wrap gap-2">
              {relevantFaucets.map((f) => (
                <Button key={f.url} asChild variant="outline" size="sm" className="h-8 text-xs">
                  <a href={f.url} target="_blank" rel="noopener noreferrer" title={f.note}>
                    {f.name}
                    <ExternalLink className="h-3 w-3 ml-1.5 opacity-60" />
                  </a>
                </Button>
              ))}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
