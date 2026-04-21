/**
 * Home / Landing Page — Netflix × Webtoons hybrid
 *
 * Full-bleed hero billboard, horizontal scroll content rows,
 * tall portrait cards, genre discovery, dark cinematic vibe.
 */

import { createFileRoute, Link } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { resolveIpfsUrl } from '@/utils/ipfs-url';

import {
  Play,
  Plus,
  Search,
  TrendingUp,
  Users,
  ChevronLeft,
  ChevronRight,
  Flame,
  Sparkles,
  Clock,
  Star,
  X,
  Tv,
  BookOpen,
  Zap,
  Eye,
} from 'lucide-react';
import { LoarIcon } from '@/components/loar-icons';
import { GettingStartedPopup } from '@/components/GettingStartedBanner';
import { useQuery } from '@tanstack/react-query';
import {
  ponderGql,
  ponderQueryDefaults,
  type Universe,
  type Token,
  type Node,
  type NodeContent,
  type Swap,
  type TokenHolder,
} from '@/utils/ponder-api';
import type { FirestoreUniverse } from '@/types/firestore';
import type { EnrichedUniverse } from '@/components/home/types';
import { trpc, trpcClient } from '@/utils/trpc';
import { useMemo, useState, useEffect, useRef, useCallback } from 'react';

export const Route = createFileRoute('/')({
  component: HomeComponent,
});

import {
  HeroSkeleton,
  HeroBillboard,
  ActivityTicker,
  Top10Strip,
  TrendingRow,
  RecentEpisodes,
  NewArrivalsRow,
  AllUniversesRow,
  MostEpisodesRow,
  CommunityCreations,
  TokenPoweredRow,
  CreateBanner,
  SearchOverlay,
} from '../components/home/HomeSections';

/* ──────────────────────────────────────────
 * Main Home Component
 * ────────────────────────────────────────── */
function HomeComponent() {
  const [searchOpen, setSearchOpen] = useState(false);

  // Keyboard shortcut: Cmd/Ctrl + K to open search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ─── Primary: Firestore universes (always available) ───
  const { data: firestoreUniverses, isLoading: universesLoading } = useQuery({
    queryKey: ['universes', 'all'],
    queryFn: () => trpcClient.universes.getAll.query().then((r) => r.data as FirestoreUniverse[]),
    staleTime: 30_000,
  });

  // ─── Optional: Ponder blockchain enrichment (silent fail) ───
  const { data: ponderUniverses } = useQuery({
    queryKey: ['ponder', 'universes', 'top-50'],
    queryFn: () =>
      ponderGql<{ universes: { items: Universe[] } }>(`{
        universes(orderBy: "createdAt", orderDirection: "desc", limit: 50) {
          items { id universeId creator createdAt name description imageURL tokenAddress governorAddress nodeCount }
        }
      }`).then((d) => d.universes.items),
    ...ponderQueryDefaults,
  });

  const { data: tokensData } = useQuery({
    queryKey: ['ponder', 'tokens'],
    queryFn: () =>
      ponderGql<{ tokens: { items: Token[] } }>(`{
        tokens(limit: 1000) {
          items { id universeAddress deployer tokenAdmin name symbol imageURL metadata context startingTick poolHook poolId pairedToken locker createdAt }
        }
      }`).then((d) => d.tokens.items),
    ...ponderQueryDefaults,
  });

  const { data: swapsData } = useQuery({
    queryKey: ['ponder', 'swaps'],
    queryFn: () =>
      ponderGql<{ swaps: { items: Swap[] } }>(`{
        swaps(orderBy: "timestamp", orderDirection: "desc", limit: 1000) {
          items { id poolId sender amount0 amount1 sqrtPriceX96 liquidity tick timestamp blockNumber }
        }
      }`).then((d) => d.swaps.items),
    ...ponderQueryDefaults,
  });

  const { data: holdersData } = useQuery({
    queryKey: ['ponder', 'tokenHolders'],
    queryFn: () =>
      ponderGql<{ tokenHolders: { items: TokenHolder[] } }>(`{
        tokenHolders(limit: 1000) {
          items { id tokenAddress holderAddress balance }
        }
      }`).then((d) => d.tokenHolders.items),
    ...ponderQueryDefaults,
  });

  const ponderOnline = !!ponderUniverses;

  // ─── Merge: Firestore base + optional Ponder enrichment ───
  const universes = useMemo(() => {
    // Normalize Firestore docs into the shape UI cards expect
    const base = (firestoreUniverses || []).map((u: FirestoreUniverse) => ({
      id: u.id,
      name: u.name || u.description?.slice(0, 40) || '',
      description: u.description || '',
      imageURL: u.image_url || u.imageURL || '',
      portraitImageURL: u.portrait_image_url || '',
      creator: u.creator || '',
      tokenAddress: u.tokenAddress || null,
      governorAddress: u.governanceAddress || null,
      nodeCount: 0,
      createdAt: u.created_at?._seconds || 0,
    }));

    // Build lookup from Ponder data
    const ponderMap = new Map<string, Universe>();
    if (ponderUniverses) {
      ponderUniverses.forEach((u) => ponderMap.set(u.id.toLowerCase(), u));
    }

    const tokenMap = new Map<string, Token>();
    if (tokensData) {
      tokensData.forEach((t) => tokenMap.set(t.universeAddress.toLowerCase(), t));
    }

    const now = Date.now() / 1000;
    const dayAgo = now - 86400;
    const volumeMap = new Map<string, number>();
    if (swapsData) {
      swapsData.forEach((s) => {
        if (s.timestamp >= dayAgo) {
          const current = volumeMap.get(s.poolId) || 0;
          volumeMap.set(s.poolId, current + Math.abs(Number(s.amount0)));
        }
      });
    }

    const holderCountMap = new Map<string, number>();
    if (holdersData) {
      holdersData.forEach((h) => {
        const current = holderCountMap.get(h.tokenAddress.toLowerCase()) || 0;
        holderCountMap.set(h.tokenAddress.toLowerCase(), current + 1);
      });
    }

    // Enrich base with Ponder data where available
    const enriched = base.map((u: Partial<EnrichedUniverse>) => {
      const ponder = ponderMap.get(u.id.toLowerCase());
      let tokenData = tokenMap.get(u.id.toLowerCase());
      // Fallback: if Ponder doesn't have the token but Firestore has a non-zero tokenAddress,
      // create a minimal tokenData so the universe shows in Token-Powered section
      if (
        !tokenData &&
        u.tokenAddress &&
        u.tokenAddress !== '0x0000000000000000000000000000000000000000'
      ) {
        tokenData = {
          id: u.tokenAddress,
          universeAddress: u.id,
          name: u.name,
          symbol: '',
          imageURL: u.imageURL,
        } as Token;
      }
      const poolId = tokenData?.poolId;
      const swapVolume = poolId ? volumeMap.get(poolId) || 0 : 0;
      const holderCount = tokenData ? holderCountMap.get(tokenData.id.toLowerCase()) || 0 : 0;
      return {
        ...u,
        // Override with Ponder fields when available
        name: ponder?.name || u.name,
        description: ponder?.description || u.description,
        imageURL: ponder?.imageURL || u.imageURL,
        nodeCount: ponder?.nodeCount || u.nodeCount,
        tokenData,
        swapVolume,
        holderCount,
      };
    });

    // Add any Ponder-only universes not in Firestore (skip duplicates by name)
    if (ponderUniverses) {
      const baseIds = new Set(base.map((u: Partial<EnrichedUniverse>) => u.id!.toLowerCase()));
      const baseNames = new Set(
        base.map((u: Partial<EnrichedUniverse>) => (u.name || '').toLowerCase())
      );
      ponderUniverses.forEach((pu) => {
        if (baseIds.has(pu.id.toLowerCase())) return;
        if (baseNames.has((pu.name || '').toLowerCase())) return;
        const tokenData = tokenMap.get(pu.id.toLowerCase());
        const poolId = tokenData?.poolId;
        const swapVolume = poolId ? volumeMap.get(poolId) || 0 : 0;
        const holderCount = tokenData ? holderCountMap.get(tokenData.id.toLowerCase()) || 0 : 0;
        enriched.push({ ...pu, tokenData, swapVolume, holderCount });
      });
    }

    return enriched;
  }, [firestoreUniverses, ponderUniverses, tokensData, swapsData, holdersData]);

  return (
    <div className="min-h-screen bg-background">
      {/* Ken Burns animation */}
      <style>{`
        @keyframes kenburns {
          0% { transform: scale(1.05) translate(0, 0); }
          100% { transform: scale(1.12) translate(-1%, -1%); }
        }
      `}</style>

      {ponderOnline && <ActivityTicker />}

      {/* Floating search button */}
      <button
        onClick={() => setSearchOpen(true)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-primary text-white shadow-lg shadow-primary/30 flex items-center justify-center hover:scale-105 active:scale-95 transition-transform md:hidden"
      >
        <Search className="h-5 w-5" />
      </button>

      {/* Desktop search shortcut hint in header area */}
      <button
        onClick={() => setSearchOpen(true)}
        className="hidden md:flex fixed top-[18px] right-56 z-50 items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-sm text-muted-foreground hover:bg-white/10 hover:text-white transition-all"
      >
        <Search className="h-3.5 w-3.5" />
        <span>Search</span>
        <kbd className="text-[10px] bg-white/10 px-1.5 py-0.5 rounded font-mono inline-flex items-center gap-0.5">
          {navigator.platform?.includes('Mac') ? (
            <LoarIcon name="command" size={10} className="inline-block" />
          ) : (
            <span>Ctrl</span>
          )}
          <span>+</span>
          <span>K</span>
        </kbd>
      </button>

      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} universes={universes} />

      {/* One-time onboarding popup after first login */}
      <GettingStartedPopup />

      {/* Hero: skeleton during load, real billboard once data arrives */}
      {universesLoading ? <HeroSkeleton /> : <HeroBillboard universes={universes} />}

      {/* Content Rows — only render once we have real data */}
      {!universesLoading && (
        <div className="-mt-16 relative z-10 pb-20 space-y-2">
          <Top10Strip universes={universes} />
          <TrendingRow universes={universes} />
          {ponderOnline && <RecentEpisodes universes={universes} />}
          <NewArrivalsRow universes={universes} />
          <AllUniversesRow universes={universes} />
          <MostEpisodesRow universes={universes} />
          <CommunityCreations />
          <TokenPoweredRow universes={universes} />
          <CreateBanner />
        </div>
      )}
    </div>
  );
}
