/**
 * Earnings tab — aggregate revenue across all monetization channels.
 *
 * Categories from PRD:
 *   - NFT sales
 *   - Appearance royalties
 *   - Subscriptions received
 *   - Canon rewards
 *   - Ads
 *   - Licensing / merch
 */
import { useQuery } from '@tanstack/react-query';
import React from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AssetRow } from '../../src/components/portfolio/AssetRow';
import { StatCard } from '../../src/components/ui/StatCard';
import { SectionHeader } from '../../src/components/ui/SectionHeader';
import { useAuth } from '../../src/contexts/AuthContext';
import { trpc } from '../../src/lib/trpc';

interface EarningsCategory {
  icon: string;
  label: string;
  amount: number;
  desc: string;
}

export default function EarningsScreen() {
  const { address } = useAuth();

  // Pull subscription revenue (subscriptionRevenue collection filtered to creator)
  // Using existing subscription stats for universes the user created
  const universesQuery = useQuery(
    trpc.universes.getByCreator.queryOptions(
      { creator: address ?? '' },
      { enabled: Boolean(address) }
    )
  );

  const universes = universesQuery.data ?? [];

  // Aggregate subscription stats per universe
  const subStatsQueries = universes
    .slice(0, 5)
    .map((u: any) => trpc.subscriptions.getUniverseStats.queryOptions({ universeId: u.id }));

  // Placeholder breakdowns — these will be populated as monetization backends mature
  const categories: EarningsCategory[] = [
    { icon: '🎬', label: 'NFT Sales', amount: 0, desc: 'Episode & character NFT sales' },
    { icon: '👑', label: 'Royalties', amount: 0, desc: 'Appearance & derivative royalties' },
    { icon: '🔁', label: 'Subscriptions', amount: 0, desc: 'Universe subscription revenue' },
    { icon: '⚖️', label: 'Canon Rewards', amount: 0, desc: 'Accepted canon submissions' },
    { icon: '📢', label: 'Ad Revenue', amount: 0, desc: 'Sponsored content placements' },
    { icon: '📜', label: 'Licensing', amount: 0, desc: 'IP licensing & merch deals' },
  ];

  const totalEarnings = categories.reduce((s, c) => s + c.amount, 0);
  const pendingPayout = 0; // TODO: claimable balance from contracts

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
          <RefreshControl
            refreshing={universesQuery.isFetching}
            onRefresh={() => universesQuery.refetch()}
            tintColor="#7c3aed"
          />
        }
      >
        {/* Summary row */}
        <View className="flex-row gap-3">
          <StatCard
            label="All-Time Earnings"
            value={`$${totalEarnings.toFixed(2)}`}
            accent="text-warning"
          />
          <StatCard
            label="Pending Payout"
            value={`$${pendingPayout.toFixed(2)}`}
            subtitle="claimable"
            accent="text-success"
          />
        </View>

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
                value={cat.amount > 0 ? `$${cat.amount.toFixed(2)}` : '—'}
              />
            ))}
          </View>
        </View>

        {/* Universes with revenue potential */}
        {universes.length > 0 ? (
          <View>
            <SectionHeader title="Earning Universes" count={universes.length} />
            <View className="bg-card rounded-2xl border border-border px-4">
              {universes.map((u: any) => (
                <AssetRow
                  key={u.id}
                  icon="🌌"
                  label={u.name ?? u.description?.slice(0, 28) ?? 'Universe'}
                  subtitle="Active revenue channels"
                  value="—"
                />
              ))}
            </View>
          </View>
        ) : null}

        {/* Info */}
        <View className="bg-zinc-900 rounded-2xl p-4 gap-2">
          <Text className="text-text-primary font-semibold text-sm">Earnings Aggregation</Text>
          <Text className="text-text-tertiary text-xs leading-relaxed">
            On-chain revenue (NFT royalties, canon rewards, subscription payments) requires the LOAR
            indexer to index your universes. Off-chain revenue (ad placements, licensing deals) is
            tracked in the LOAR server.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
