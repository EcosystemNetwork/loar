/**
 * MonetizationOverview — Dashboard overview of all 7 revenue streams.
 *
 * Shows each monetization channel with its status, icon, description,
 * and a direct CTA. Designed to surface what's possible and drive
 * creators to activate revenue on their universes.
 */
import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { CreditStore } from '@/components/CreditStore';
import { useVocab } from '@/hooks/use-vocab';

interface Stream {
  id: string;
  icon: string;
  label: string;
  desc: string;
  potential: string;
  status: 'live' | 'beta' | 'soon';
  ctaLabel: string;
  ctaAction: 'credits' | 'nfts' | 'subs' | 'canon' | 'ads' | 'license' | 'merch';
}

const STREAMS: Stream[] = [
  {
    id: 'credits',
    icon: '⚡',
    label: 'AI Credits',
    desc: 'Buy credits with card, ETH, or $LOAR. 25% margin discount with token.',
    potential: 'Up to 35% margin',
    status: 'live',
    ctaLabel: 'Buy Credits',
    ctaAction: 'credits',
  },
  {
    id: 'nfts',
    icon: '🎬',
    label: 'Own Episodes',
    desc: 'Tokenize your episodes. Set your own price and supply.',
    potential: 'Resale royalties',
    status: 'beta',
    ctaLabel: 'Publish Episode',
    ctaAction: 'nfts',
  },
  {
    id: 'characters',
    icon: '🧬',
    label: 'Own Characters',
    desc: 'Tokenize characters — earn 5% royalty each time they appear in content.',
    potential: '5% appearance royalty',
    status: 'beta',
    ctaLabel: 'Publish Character',
    ctaAction: 'nfts',
  },
  {
    id: 'subs',
    icon: '👥',
    label: 'Subscriptions',
    desc: 'Tier-based fan subscriptions. Early access, voting power, credit bonuses.',
    potential: 'Recurring revenue',
    status: 'beta',
    ctaLabel: 'Set Up Tiers',
    ctaAction: 'subs',
  },
  {
    id: 'canon',
    icon: '🗳️',
    label: 'Canon Shop',
    desc: 'Community votes on storylines. License winning submissions for royalties.',
    potential: 'License fees',
    status: 'live',
    ctaLabel: 'Submit Canon',
    ctaAction: 'canon',
  },
  {
    id: 'ads',
    icon: '📢',
    label: 'Ad Placements',
    desc: 'Auction episode and placement ad slots. Creators earn the winning bid.',
    potential: 'Bid-based earnings',
    status: 'beta',
    ctaLabel: 'Create Slot',
    ctaAction: 'ads',
  },
  {
    id: 'license',
    icon: '📜',
    label: 'IP Licensing',
    desc: 'License your universe IP to third parties — merch, adaptations, collabs.',
    potential: 'One-time + royalties',
    status: 'soon',
    ctaLabel: 'Coming Soon',
    ctaAction: 'license',
  },
];

const STATUS_STYLES: Record<string, string> = {
  live: 'bg-green-900/60 text-green-400 border-green-800',
  beta: 'bg-blue-900/60 text-blue-400 border-blue-800',
  soon: 'bg-zinc-800 text-zinc-500 border-zinc-700',
};

const STATUS_LABELS: Record<string, string> = {
  live: 'LIVE',
  beta: 'BETA',
  soon: 'SOON',
};

export function MonetizationOverview() {
  const [showCreditStore, setShowCreditStore] = useState(false);
  const navigate = useNavigate();
  const v = useVocab();

  const handleCta = (action: Stream['ctaAction'], status: Stream['status']) => {
    if (status === 'soon') return;
    if (action === 'credits') {
      setShowCreditStore(true);
      return;
    }
    // For universe-specific actions, route to dashboard for now
    // In full implementation these would open RevenuePanel tabs
    navigate({ to: '/dashboard' });
  };

  return (
    <section className="mb-10">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-semibold text-white">Monetization</h2>
          <p className="text-sm text-zinc-400 mt-0.5">
            7 ways to earn from your narrative universes
          </p>
        </div>
        <span className="text-xs text-zinc-600 font-mono">ALL STREAMS</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {STREAMS.map((stream) => {
          // Override labels for web3 mode
          const ctaOverrides: Record<string, string> = {
            nfts: stream.id === 'nfts' ? `${v('mint')} Episode` : `${v('mint')} Character`,
            canon: stream.ctaLabel,
          };
          const labelOverrides: Record<string, string> = {
            canon: v('canon-marketplace'),
          };
          const ctaLabel = ctaOverrides[stream.ctaAction] ?? stream.ctaLabel;
          const label = labelOverrides[stream.id] ?? stream.label;
          return (
            <div
              key={stream.id}
              className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex flex-col gap-2 hover:border-zinc-700 transition-colors group"
            >
              {/* Top row */}
              <div className="flex items-start justify-between">
                <span className="text-2xl">{stream.icon}</span>
                <span
                  className={`text-[9px] font-bold px-1.5 py-0.5 rounded border tracking-widest ${STATUS_STYLES[stream.status]}`}
                >
                  {STATUS_LABELS[stream.status]}
                </span>
              </div>

              {/* Label + desc */}
              <div>
                <div className="text-sm font-bold text-white">{label}</div>
                <p className="text-xs text-zinc-500 mt-0.5 leading-relaxed">{stream.desc}</p>
              </div>

              {/* Potential */}
              <div className="text-[10px] text-amber-500 font-semibold mt-auto">
                ◆ {stream.potential}
              </div>

              {/* CTA */}
              <button
                onClick={() => handleCta(stream.ctaAction, stream.status)}
                disabled={stream.status === 'soon'}
                className={`w-full mt-1 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  stream.status === 'soon'
                    ? 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
                    : 'bg-zinc-800 hover:bg-amber-600 text-zinc-300 hover:text-white group-hover:bg-amber-600/20'
                }`}
              >
                {ctaLabel}
              </button>
            </div>
          );
        })}

        {/* Summary card */}
        <div className="bg-gradient-to-br from-amber-950/60 to-zinc-900 border border-amber-800/40 rounded-xl p-4 flex flex-col justify-between">
          <div>
            <div className="text-2xl">💰</div>
            <div className="text-sm font-bold text-white mt-2">$LOAR Advantage</div>
            <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
              Hold $LOAR to get 25% margin on credits vs 35% for card/ETH — plus 10% bonus credits
              on every purchase.
            </p>
          </div>
          <div className="mt-3 space-y-1 text-xs">
            <div className="flex justify-between text-zinc-400">
              <span>Card / ETH margin</span>
              <span className="text-red-400">35%</span>
            </div>
            <div className="flex justify-between text-zinc-400">
              <span>$LOAR margin</span>
              <span className="text-green-400">25% + 10% bonus</span>
            </div>
          </div>
        </div>
      </div>

      {showCreditStore && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Credit Store"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowCreditStore(false);
          }}
        >
          <div className="bg-zinc-950 border border-zinc-800 rounded-xl shadow-2xl w-full max-w-3xl max-h-[80vh] overflow-y-auto p-6 mx-4">
            <CreditStore onClose={() => setShowCreditStore(false)} />
          </div>
        </div>
      )}
    </section>
  );
}
