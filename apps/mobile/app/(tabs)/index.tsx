/**
 * Portfolio Home — overview of everything the user owns.
 *
 * Sections:
 *   - Summary stats (credits, collectibles, subs, earnings)
 *   - Owned universes (horizontal scroll)
 *   - Quick links: Collections, Tokens, Subscriptions, Credits, Drafts, Earnings
 */
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import React from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PortfolioSummaryRow } from '../../src/components/portfolio/PortfolioSummary';
import { UniverseCard } from '../../src/components/portfolio/UniverseCard';
import { AssetRow } from '../../src/components/portfolio/AssetRow';
import { LoadingSpinner } from '../../src/components/ui/LoadingSpinner';
import { SectionHeader } from '../../src/components/ui/SectionHeader';
import { useAuth } from '../../src/contexts/AuthContext';
import { trpc } from '../../src/lib/trpc';
import type { PortfolioSummary } from '../../src/types';

export default function PortfolioHomeScreen() {
  const router = useRouter();
  const { address } = useAuth();

  // Single unified BFF call — replaces 4 separate queries
  const portfolioQuery = useQuery(trpc.portfolio.summary.queryOptions());

  const isLoading = portfolioQuery.isLoading;
  const refetch = () => portfolioQuery.refetch();

  const data = portfolioQuery.data;
  const universes = data?.universes ?? [];

  const summary: PortfolioSummary = {
    creditsBalance: data?.creditsBalance ?? 0,
    totalCollectibles: data?.totalCollectibles ?? 0,
    activeSubscriptions: data?.activeSubscriptions ?? 0,
    pendingEarnings: data?.pendingEarningsUsd ?? 0,
    universesOwned: data?.universesOwned ?? 0,
    draftsCount: data?.draftsCount ?? 0,
  };

  if (isLoading) return <LoadingSpinner message="Loading portfolio…" />;

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
          <RefreshControl refreshing={false} onRefresh={refetch} tintColor="#7c3aed" />
        }
      >
        {/* Wallet address pill */}
        <View className="flex-row items-center justify-between">
          <Text className="text-text-primary text-xl font-bold">My Assets</Text>
          {address ? (
            <View className="bg-zinc-900 rounded-full px-3 py-1">
              <Text className="text-text-secondary text-xs">
                {address.slice(0, 6)}…{address.slice(-4)}
              </Text>
            </View>
          ) : null}
        </View>

        {/* Summary stats */}
        <PortfolioSummaryRow summary={summary} />

        {/* Universes */}
        {universes.length > 0 ? (
          <View>
            <SectionHeader
              title="Universes"
              count={universes.length}
              onSeeAll={() => router.push('/universe/' + universes[0].id)}
            />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 12 }}
            >
              {universes.map((u) => (
                <UniverseCard key={u.id} universe={u as any} />
              ))}
            </ScrollView>
          </View>
        ) : (
          <View className="bg-card rounded-2xl border border-border p-6 items-center gap-2">
            <Text className="text-2xl">🌌</Text>
            <Text className="text-text-secondary text-sm text-center">
              No universes yet. Create one in the web app to get started.
            </Text>
          </View>
        )}

        {/* Quick navigation */}
        <View>
          <SectionHeader title="Assets" />
          <View className="bg-card rounded-2xl border border-border px-4">
            <AssetRow
              icon="🖼"
              label="Collections"
              subtitle="Episode & character NFTs"
              value={summary.totalCollectibles || undefined}
              onPress={() => router.push('/(tabs)/collections')}
            />
            <AssetRow
              icon="💎"
              label="Token Holdings"
              subtitle="Universe governance tokens"
              onPress={() => router.push('/(tabs)/tokens')}
            />
            <AssetRow
              icon="🔁"
              label="Subscriptions"
              subtitle={`${summary.activeSubscriptions} active`}
              onPress={() => router.push('/subscriptions')}
            />
            <AssetRow
              icon="⚡"
              label="Credits"
              subtitle="Generation credits"
              value={data?.creditsBalance ?? 0}
              onPress={() => router.push('/credits')}
            />
            <AssetRow
              icon="📝"
              label="Drafts"
              subtitle={`${summary.draftsCount} unpublished`}
              onPress={() => router.push('/drafts')}
            />
            <AssetRow
              icon="💰"
              label="Earnings"
              subtitle="Revenue & royalties"
              onPress={() => router.push('/(tabs)/earnings')}
            />
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
