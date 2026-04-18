/**
 * Universe detail screen.
 *
 * Shows:
 *  - Universe image, name, description
 *  - Token & governance info
 *  - Subscription stats
 *  - Team member count
 *  - Quick actions
 */
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { Image, ScrollView, Share, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Badge } from '../../src/components/ui/Badge';
import { Button } from '../../src/components/ui/Button';
import { Card } from '../../src/components/ui/Card';
import { LoadingSpinner } from '../../src/components/ui/LoadingSpinner';
import { StatCard } from '../../src/components/ui/StatCard';
import { trpc } from '../../src/lib/trpc';

export default function UniverseDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const universeQuery = useQuery(trpc.universes.get.queryOptions({ id }));
  const subStatsQuery = useQuery(
    trpc.subscriptions.getUniverseStats.queryOptions({ universeId: id })
  );

  const universeRaw = universeQuery.data as
    | { success?: boolean; data?: any }
    | Record<string, any>
    | null
    | undefined;
  const universe: any =
    universeRaw && 'success' in universeRaw && universeRaw.data ? universeRaw.data : universeRaw;
  const subStats = subStatsQuery.data as any;

  const handleShare = async () => {
    await Share.share({
      message: `Check out this LOAR Universe: ${universe?.description?.slice(0, 80) ?? ''}`,
      url: `https://loar.fun/universe/${id}`,
    });
  };

  if (universeQuery.isLoading) return <LoadingSpinner message="Loading universe…" />;

  if (!universe) {
    return (
      <SafeAreaView className="flex-1 bg-background items-center justify-center gap-4">
        <Text className="text-3xl">😕</Text>
        <Text className="text-text-secondary">Universe not found</Text>
        <Button onPress={() => router.back()} variant="secondary" size="sm">
          Go Back
        </Button>
      </SafeAreaView>
    );
  }

  const u = universe as any;
  const shortAddr = (addr: string) => (addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : '–');

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['bottom']}>
      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 32 }}>
        {/* Hero image */}
        {u.imageUrl ? (
          <Image
            source={{ uri: u.imageUrl }}
            className="w-full"
            style={{ aspectRatio: 21 / 9 }}
            resizeMode="cover"
          />
        ) : (
          <View
            className="w-full bg-zinc-900 items-center justify-center"
            style={{ aspectRatio: 21 / 9 }}
          >
            <Text className="text-7xl">🌌</Text>
          </View>
        )}

        <View className="px-4 pt-5 gap-5">
          {/* Title */}
          <View className="gap-1">
            <Text className="text-text-primary text-2xl font-bold">
              {u.name ?? u.description?.slice(0, 40) ?? 'Universe'}
            </Text>
            {u.description ? (
              <Text className="text-text-secondary text-sm leading-relaxed">{u.description}</Text>
            ) : null}
          </View>

          {/* Stats row */}
          <View className="flex-row gap-3">
            <StatCard
              label="Subscribers"
              value={subStats?.totalSubscribers ?? 0}
              accent="text-success"
            />
            <StatCard
              label="Tiers"
              value={subStats?.availableTiers?.length ?? 0}
              accent="text-primary-light"
            />
          </View>

          {/* Addresses */}
          <Card>
            <Text className="text-text-primary font-semibold mb-3">On-Chain</Text>
            {[
              { label: 'Universe Contract', value: shortAddr(u.address) },
              { label: 'Token', value: shortAddr(u.tokenAddress) },
              { label: 'Governor', value: shortAddr(u.governanceAddress) },
              { label: 'Creator', value: shortAddr(u.creator) },
            ].map((row) => (
              <View
                key={row.label}
                className="flex-row justify-between py-1.5 border-b border-border last:border-0"
              >
                <Text className="text-text-tertiary text-xs">{row.label}</Text>
                <Text className="text-text-secondary text-xs font-mono">{row.value}</Text>
              </View>
            ))}
          </Card>

          {/* Subscription tiers */}
          {subStats?.availableTiers && subStats.availableTiers.length > 0 ? (
            <View className="gap-2">
              <Text className="text-text-primary font-semibold">Subscription Tiers</Text>
              {subStats.availableTiers.map((tier: any) => (
                <Card key={tier.id} className="flex-row items-center justify-between">
                  <View>
                    <Text className="text-text-primary font-semibold">{tier.tier}</Text>
                    <Text className="text-text-tertiary text-xs">
                      {subStats.tierCounts?.[tier.tier] ?? 0} subscribers
                    </Text>
                  </View>
                  <Badge variant={tier.tier === 'VIP' ? 'warning' : 'primary'}>{tier.tier}</Badge>
                </Card>
              ))}
            </View>
          ) : null}

          {/* Actions */}
          <View className="flex-row gap-3">
            <Button onPress={handleShare} variant="secondary" size="sm">
              Share
            </Button>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
