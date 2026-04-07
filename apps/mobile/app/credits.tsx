/**
 * Credits screen — balance, transaction history, and purchase packages.
 *
 * Dual-margin pricing:
 *   Card / ETH / Crypto  → 35% margin
 *   $LOAR payments       → 25% margin + 10% bonus credits
 */
import { useQuery } from '@tanstack/react-query';
import React, { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Badge } from '../src/components/ui/Badge';
import { Button } from '../src/components/ui/Button';
import { Card } from '../src/components/ui/Card';
import { LoadingSpinner } from '../src/components/ui/LoadingSpinner';
import { SectionHeader } from '../src/components/ui/SectionHeader';
import { StatCard } from '../src/components/ui/StatCard';
import { trpc } from '../src/lib/trpc';
import type { CreditPackage } from '../src/types';

type PriceMode = 'fiat' | 'loar';

export default function CreditsScreen() {
  const [priceMode, setPriceMode] = useState<PriceMode>('fiat');

  const balanceQuery = useQuery(trpc.credits.getBalance.queryOptions());
  const packagesQuery = useQuery(trpc.credits.getPackages.queryOptions());
  const historyQuery = useQuery(trpc.credits.getHistory.queryOptions({ limit: 10 }));
  const costsQuery = useQuery(trpc.credits.getCosts.queryOptions());

  const balance = balanceQuery.data;
  const packages = (packagesQuery.data ?? []) as CreditPackage[];
  const history = historyQuery.data ?? [];
  const costs = costsQuery.data ?? {};

  const isLoading = balanceQuery.isLoading;

  const refetchAll = () => {
    balanceQuery.refetch();
    historyQuery.refetch();
  };

  if (isLoading) return <LoadingSpinner message="Loading credits…" />;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['bottom']}>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 32, gap: 24 }}
        refreshControl={
          <RefreshControl
            refreshing={balanceQuery.isFetching}
            onRefresh={refetchAll}
            tintColor="#7c3aed"
          />
        }
      >
        {/* Balance row */}
        <View className="flex-row gap-3">
          <StatCard
            label="Credits Balance"
            value={(balance?.balance ?? 0).toLocaleString()}
            accent="text-primary-light"
          />
          <StatCard
            label="Total Spent"
            value={(balance?.totalSpent ?? 0).toLocaleString()}
            accent="text-text-secondary"
          />
        </View>

        {/* Stats */}
        <View className="bg-card rounded-2xl border border-border p-4 gap-3">
          <Text className="text-text-primary font-semibold">Account</Text>
          {[
            { label: 'Purchased', value: (balance?.totalPurchased ?? 0).toLocaleString() },
            { label: 'Bonus Received', value: (balance?.totalBonusReceived ?? 0).toLocaleString() },
            { label: 'Fiat Purchases', value: balance?.totalFiatPurchases ?? 0 },
            { label: '$LOAR Purchases', value: balance?.totalLoarPurchases ?? 0 },
          ].map((row) => (
            <View key={row.label} className="flex-row justify-between">
              <Text className="text-text-tertiary text-sm">{row.label}</Text>
              <Text className="text-text-secondary text-sm font-medium">{row.value}</Text>
            </View>
          ))}
        </View>

        {/* Purchase packages */}
        <View>
          <View className="flex-row items-center justify-between mb-3">
            <Text className="text-text-primary text-base font-bold">Buy Credits</Text>
            {/* Price mode toggle */}
            <View className="flex-row bg-zinc-900 rounded-lg overflow-hidden">
              {(['fiat', 'loar'] as PriceMode[]).map((mode) => (
                <Pressable
                  key={mode}
                  onPress={() => setPriceMode(mode)}
                  className={`px-3 py-1.5 ${priceMode === mode ? 'bg-primary' : ''}`}
                >
                  <Text
                    className={`text-xs font-semibold ${
                      priceMode === mode ? 'text-white' : 'text-text-secondary'
                    }`}
                  >
                    {mode === 'fiat' ? 'Card/ETH' : '$LOAR'}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View className="gap-3">
            {packages.map((pkg) => (
              <Card key={pkg.id} className={pkg.popular ? 'border-primary' : ''}>
                <View className="flex-row items-start justify-between">
                  <View className="flex-1 gap-1">
                    <View className="flex-row items-center gap-2">
                      <Text className="text-text-primary font-bold">{pkg.name}</Text>
                      {pkg.popular ? <Badge variant="primary">Popular</Badge> : null}
                    </View>
                    <Text className="text-text-secondary text-sm">
                      {pkg.credits.toLocaleString()} credits
                      {pkg.bonusCredits > 0 ? ` + ${pkg.bonusCredits} bonus` : ''}
                      {priceMode === 'loar' && pkg.loarBonusCredits > 0
                        ? ` + ${pkg.loarBonusCredits} $LOAR bonus`
                        : ''}
                    </Text>
                  </View>
                  <View className="items-end gap-1">
                    <Text className="text-text-primary text-lg font-bold">
                      {priceMode === 'fiat'
                        ? `$${pkg.fiatPriceUsd}`
                        : `${pkg.loarTokenAmount} LOAR`}
                    </Text>
                    <Text className="text-text-tertiary text-xs">
                      {priceMode === 'fiat' ? '35% margin' : '25% margin'}
                    </Text>
                  </View>
                </View>
                <Button
                  onPress={() => {}}
                  variant={pkg.popular ? 'primary' : 'secondary'}
                  size="sm"
                  fullWidth
                  // Payment flow opens in web app for now
                >
                  Purchase via Web
                </Button>
              </Card>
            ))}
          </View>
        </View>

        {/* Generation costs */}
        <View>
          <SectionHeader title="Generation Costs" />
          <View className="bg-card rounded-2xl border border-border px-4">
            {Object.entries(costs)
              .filter(([key]) => !['video'].includes(key)) // skip legacy
              .map(([type, cost]) => (
                <View
                  key={type}
                  className="flex-row justify-between items-center py-2.5 border-b border-border last:border-0"
                >
                  <Text className="text-text-secondary text-sm capitalize">
                    {type.replace('_', ' ')}
                  </Text>
                  <Text className="text-text-primary text-sm font-semibold">
                    {cost as number} credits
                  </Text>
                </View>
              ))}
          </View>
        </View>

        {/* Recent history */}
        {history.length > 0 ? (
          <View>
            <SectionHeader title="Recent Transactions" />
            <View className="bg-card rounded-2xl border border-border px-4">
              {history.slice(0, 8).map((tx: any) => (
                <View
                  key={tx.id}
                  className="flex-row justify-between items-center py-2.5 border-b border-border last:border-0"
                >
                  <View>
                    <Text className="text-text-secondary text-sm capitalize">
                      {tx.type} — {tx.generationType ?? tx.packageName ?? ''}
                    </Text>
                    {tx.createdAt ? (
                      <Text className="text-text-tertiary text-xs">
                        {new Date(tx.createdAt?.toDate?.() ?? tx.createdAt).toLocaleDateString()}
                      </Text>
                    ) : null}
                  </View>
                  <Text
                    className={`font-semibold text-sm ${
                      (tx.credits ?? tx.totalCredits ?? 0) > 0
                        ? 'text-success'
                        : 'text-error'
                    }`}
                  >
                    {(tx.credits ?? tx.totalCredits ?? 0) > 0 ? '+' : ''}
                    {tx.credits ?? tx.totalCredits ?? 0}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
