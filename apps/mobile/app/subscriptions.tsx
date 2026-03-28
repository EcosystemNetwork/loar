/**
 * Subscriptions screen — manage all active universe subscriptions.
 *
 * For each subscription:
 *   - Universe name & image
 *   - Tier badge
 *   - Expiry date
 *   - Auto-renew toggle
 *   - Cancel / renew actions
 */
import { useMutation, useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import React from 'react';
import { Alert, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Badge } from '../src/components/ui/Badge';
import { Button } from '../src/components/ui/Button';
import { EmptyState } from '../src/components/ui/EmptyState';
import { LoadingSpinner } from '../src/components/ui/LoadingSpinner';
import { SectionHeader } from '../src/components/ui/SectionHeader';
import { trpc, queryClient } from '../src/lib/trpc';

const TIER_VARIANTS: Record<string, 'default' | 'primary' | 'success' | 'warning'> = {
  FREE: 'default',
  BASIC: 'primary',
  PREMIUM: 'success',
  VIP: 'warning',
};

export default function SubscriptionsScreen() {
  const router = useRouter();

  const subsQuery = useQuery(trpc.subscriptions.mySubscriptions.queryOptions());

  const cancelMutation = useMutation(
    trpc.subscriptions.cancel.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries(),
    })
  );

  const subs = subsQuery.data ?? [];
  const active = subs.filter((s) => s.active);
  const expired = subs.filter((s) => !s.active);

  const handleCancel = (sub: (typeof subs)[number]) => {
    Alert.alert(
      'Cancel Subscription',
      `Stop auto-renewal for ${sub.universeId}? You keep access until ${sub.expiresAt ? new Date(sub.expiresAt).toLocaleDateString() : 'expiry'}.`,
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Cancel Renewal',
          style: 'destructive',
          onPress: () => cancelMutation.mutate({ universeId: sub.universeId }),
        },
      ]
    );
  };

  if (subsQuery.isLoading) return <LoadingSpinner message="Loading subscriptions…" />;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['bottom']}>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 32, gap: 24 }}
        refreshControl={
          <RefreshControl
            refreshing={subsQuery.isFetching}
            onRefresh={() => subsQuery.refetch()}
            tintColor="#7c3aed"
          />
        }
      >
        {subs.length === 0 ? (
          <EmptyState
            icon="🔁"
            title="No subscriptions"
            description="Subscribe to universe tiers to get early access, voting boosts, and exclusive content."
          />
        ) : (
          <>
            {/* Active */}
            {active.length > 0 ? (
              <View className="gap-3">
                <SectionHeader title="Active" count={active.length} />
                {active.map((sub) => (
                  <View key={sub.id} className="bg-card rounded-2xl border border-border p-4 gap-3">
                    <View className="flex-row items-start justify-between">
                      <View className="flex-1 gap-1">
                        <Text className="text-text-primary font-semibold" numberOfLines={1}>
                          {sub.universeId}
                        </Text>
                        <Text className="text-text-tertiary text-xs">
                          Expires{' '}
                          {sub.expiresAt
                            ? new Date(sub.expiresAt).toLocaleDateString()
                            : 'unknown'}
                        </Text>
                        {sub.autoRenew ? (
                          <Text className="text-success text-xs">Auto-renew on</Text>
                        ) : (
                          <Text className="text-warning text-xs">Renewal off — expires at period end</Text>
                        )}
                      </View>
                      <Badge variant={TIER_VARIANTS[sub.tier] ?? 'default'}>{sub.tier}</Badge>
                    </View>
                    <View className="flex-row gap-2">
                      <Button
                        onPress={() => router.push(`/universe/${sub.universeId}`)}
                        variant="secondary"
                        size="sm"
                      >
                        Open Universe
                      </Button>
                      {sub.autoRenew ? (
                        <Button
                          onPress={() => handleCancel(sub)}
                          variant="ghost"
                          size="sm"
                          loading={cancelMutation.isPending}
                        >
                          Cancel Renewal
                        </Button>
                      ) : null}
                    </View>
                  </View>
                ))}
              </View>
            ) : null}

            {/* Expired */}
            {expired.length > 0 ? (
              <View className="gap-3">
                <SectionHeader title="Expired" count={expired.length} />
                {expired.map((sub) => (
                  <View
                    key={sub.id}
                    className="bg-card rounded-2xl border border-border p-4 gap-2 opacity-50"
                  >
                    <View className="flex-row items-center justify-between">
                      <Text className="text-text-secondary font-medium flex-1" numberOfLines={1}>
                        {sub.universeId}
                      </Text>
                      <Badge variant="muted">{sub.tier}</Badge>
                    </View>
                    <Text className="text-text-tertiary text-xs">
                      Expired{' '}
                      {sub.expiresAt
                        ? new Date(sub.expiresAt).toLocaleDateString()
                        : 'unknown'}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
