/**
 * Earnings tab — aggregate revenue across all monetization channels.
 *
 * Everything here is live:
 *   - all-time total + per-channel breakdown → `revenueDashboard.summary`
 *   - per-universe revenue                   → `revenueDashboard.byUniverse`
 *   - pending payout (claimable ETH / $LOAR) → `revenue.getOnchainBalances`,
 *     read straight from the PaymentRouter contract on Sepolia
 *
 * Channels the server doesn't track a figure for (e.g. appearance royalties)
 * are not listed, rather than shown as a made-up zero.
 */
import { useQuery } from '@tanstack/react-query';
import React from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AssetRow } from '../../src/components/portfolio/AssetRow';
import { StatCard } from '../../src/components/ui/StatCard';
import { SectionHeader } from '../../src/components/ui/SectionHeader';
import { trpc, type RouterOutputs } from '../../src/lib/trpc';

type Summary = RouterOutputs['revenueDashboard']['summary'];
type ByUniverse = RouterOutputs['revenueDashboard']['byUniverse'];
type Onchain = RouterOutputs['revenue']['getOnchainBalances'];

interface EarningsCategory {
  icon: string;
  label: string;
  desc: string;
  amount: number;
}

const usd = (n: number) => `$${n.toFixed(2)}`;

/** The channels `revenueDashboard.summary` reports a figure for. */
function categoriesFrom(summary: Summary | undefined): EarningsCategory[] {
  const by = summary?.revenueBySource;
  return [
    {
      icon: '🎬',
      label: 'NFT Sales',
      desc: 'Episode & character NFT sales',
      amount: by?.nftSales ?? 0,
    },
    {
      icon: '⚖️',
      label: 'Canon Marketplace',
      desc: 'Canon marketplace sales',
      amount: by?.canonMarketplace ?? 0,
    },
    {
      icon: '🔁',
      label: 'Subscriptions',
      desc: 'Universe subscription revenue',
      amount: by?.subscriptions ?? 0,
    },
    { icon: '📢', label: 'Ad Revenue', desc: 'Sponsored content placements', amount: by?.ads ?? 0 },
    {
      icon: '📜',
      label: 'Licensing',
      desc: 'IP licensing & merch deals',
      amount: by?.licensing ?? 0,
    },
  ];
}

function pendingPayout(query: { data?: Onchain; isLoading: boolean; isError: boolean }) {
  if (query.isLoading) return { value: '…', subtitle: 'reading chain' };
  if (query.isError) return { value: '—', subtitle: 'unavailable — pull to retry' };
  const d = query.data;
  if (!d || !d.supported) return { value: '—', subtitle: 'EVM wallet required' };
  const loar = d.claimableLoar !== '0' ? ` · ${d.claimableLoar} LOAR` : '';
  return { value: `${d.claimableEth} ETH`, subtitle: `claimable${loar}` };
}

export default function EarningsScreen() {
  const summaryQuery = useQuery(trpc.revenueDashboard.summary.queryOptions({ period: 'all' }));
  const byUniverseQuery = useQuery(trpc.revenueDashboard.byUniverse.queryOptions({}));
  const onchainQuery = useQuery(trpc.revenue.getOnchainBalances.queryOptions());

  const summary = summaryQuery.data as Summary | undefined;
  const universes = ((byUniverseQuery.data as ByUniverse | undefined)?.universes ?? []).filter(
    (u) => u.totalRevenue > 0 || u.subscribers > 0 || u.holders > 0
  );
  const categories = categoriesFrom(summary);
  const payout = pendingPayout({
    data: onchainQuery.data as Onchain | undefined,
    isLoading: onchainQuery.isLoading,
    isError: onchainQuery.isError,
  });

  const refreshing =
    summaryQuery.isRefetching || byUniverseQuery.isRefetching || onchainQuery.isRefetching;
  const refetchAll = () => {
    void summaryQuery.refetch();
    void byUniverseQuery.refetch();
    void onchainQuery.refetch();
  };

  const totalValue = summaryQuery.isLoading
    ? '…'
    : summary
      ? usd(summary.totalRevenue)
      : summaryQuery.isError
        ? '—'
        : usd(0);

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['bottom']}>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 16,
          paddingBottom: 32,
          gap: 24,
        }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refetchAll} tintColor="#7c3aed" />
        }
      >
        {/* Summary row */}
        <View className="flex-row gap-3">
          <StatCard label="All-Time Earnings" value={totalValue} accent="text-warning" />
          <StatCard
            label="Pending Payout"
            value={payout.value}
            subtitle={payout.subtitle}
            accent="text-success"
          />
        </View>

        {summaryQuery.isError ? (
          <View className="bg-zinc-900 rounded-2xl p-4">
            <Text className="text-text-tertiary text-xs">
              Couldn't load your earnings. Pull down to retry.
            </Text>
          </View>
        ) : null}

        {/* Breakdown by category */}
        <View>
          <SectionHeader title="By Category" />
          <View className="bg-card rounded-2xl border border-border px-4">
            {categories.map((cat) => (
              <AssetRow
                key={cat.label}
                icon={cat.icon}
                label={cat.label}
                subtitle={cat.desc}
                value={cat.amount > 0 ? usd(cat.amount) : '—'}
              />
            ))}
          </View>
        </View>

        {/* Universes that have earned or have an audience */}
        {universes.length > 0 ? (
          <View>
            <SectionHeader title="Earning Universes" count={universes.length} />
            <View className="bg-card rounded-2xl border border-border px-4">
              {universes.map((u) => (
                <AssetRow
                  key={u.universeAddress}
                  icon="🌌"
                  label={u.universeName}
                  subtitle={`${u.subscribers} subscribers · ${u.holders} holders`}
                  value={u.totalRevenue > 0 ? usd(u.totalRevenue) : '—'}
                />
              ))}
            </View>
          </View>
        ) : null}

        {/* Info */}
        <View className="bg-zinc-900 rounded-2xl p-4 gap-2">
          <Text className="text-text-primary font-semibold text-sm">
            Where these numbers come from
          </Text>
          <Text className="text-text-tertiary text-xs leading-relaxed">
            Earnings are the sales, subscriptions, ad and licensing revenue recorded by the LOAR
            server. Pending payout is read live from the PaymentRouter contract on Sepolia — it is
            what you can claim on-chain right now.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
