/**
 * QuickBuyButton — a lightning "buy" affordance for launchpad cards/rows.
 *
 * It doesn't execute on-chain here (bonding-curve vs Uniswap routing lives on
 * the detail page). Instead it deep-links to the token page with a `buy` amount
 * pre-filled so the swap panel opens ready to confirm.
 */
import { useNavigate } from '@tanstack/react-router';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Zap } from 'lucide-react';

const PRESETS = ['0.01', '0.05', '0.1', '0.5'];

export function QuickBuyButton({
  tokenId,
  compact = false,
}: {
  tokenId: string;
  compact?: boolean;
}) {
  const navigate = useNavigate();

  const go = (amount: string) => {
    navigate({
      to: '/tokens/$address',
      params: { address: tokenId },
      search: { buy: amount },
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          className={
            compact
              ? 'inline-flex items-center justify-center rounded p-1 text-primary/70 hover:text-primary hover:bg-primary/10'
              : 'inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-2 py-1 text-[11px] font-semibold text-primary hover:bg-primary/20'
          }
          title="Quick buy"
        >
          <Zap className={compact ? 'h-3.5 w-3.5' : 'h-3 w-3'} />
          {!compact && 'Buy'}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[8rem]">
        {PRESETS.map((amt) => (
          <DropdownMenuItem
            key={amt}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              go(amt);
            }}
            className="justify-between text-xs"
          >
            <span>Buy</span>
            <span className="font-mono">{amt} ETH</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
