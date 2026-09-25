/**
 * Token detail (read-only). Trading happens on web — mobile has no EVM stack —
 * so the primary action hands off to loar.fun/tokens/:address.
 */
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import React from 'react';
import { Linking, RefreshControl, ScrollView, Share, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { TokenAvatar, type LaunchpadToken } from '../../src/components/launchpad/TokenRow';
import { Badge } from '../../src/components/ui/Badge';
import { Button } from '../../src/components/ui/Button';
import { EmptyState } from '../../src/components/ui/EmptyState';
import { LoadingSpinner } from '../../src/components/ui/LoadingSpinner';
import { StatCard } from '../../src/components/ui/StatCard';
import {
  formatCompactEth,
  formatPrice,
  STAGE_LABEL,
  STAGE_VARIANT,
  webTokenUrl,
} from '../../src/lib/launchpad-format';
import { trpc } from '../../src/lib/trpc';

const SOCIAL_LABEL = { website: 'Website', twitter: 'X', telegram: 'Telegram' } as const;

export default function TokenDetailScreen() {
  const { address } = useLocalSearchParams<{ address: string }>();
  const query = useQuery(
    trpc.launchpad.get.queryOptions({ address: address ?? '' }, { enabled: !!address })
  );
  const token = query.data as LaunchpadToken | undefined;

  if (query.isLoading) return <LoadingSpinner message="Loading token…" />;
  if (!token) {
    return (
      <SafeAreaView className="flex-1 bg-background" edges={['bottom']}>
        <EmptyState
          icon="🔎"
          title="Token not found"
          description="It may still be indexing, or the address is wrong. Pull down on the launchpad to refresh."
        />
      </SafeAreaView>
    );
  }

  const socials = (Object.keys(SOCIAL_LABEL) as (keyof typeof SOCIAL_LABEL)[]).filter(
    (k) => token.socials[k]
  );

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['bottom']}>
      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 32 }}
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching}
            onRefresh={() => void query.refetch()}
            tintColor="#7c3aed"
          />
        }
      >
        <View className="flex-row items-center gap-3">
          <TokenAvatar token={token} size={64} />
          <View className="flex-1 gap-1">
            <Text className="text-text-primary text-xl font-bold" numberOfLines={2}>
              {token.name}
            </Text>
            <View className="flex-row items-center gap-2">
              <Text className="text-text-secondary">${token.symbol}</Text>
              <Badge variant={STAGE_VARIANT[token.stage]}>{STAGE_LABEL[token.stage]}</Badge>
              {token.isKing && <Badge variant="warning">👑 King</Badge>}
            </View>
          </View>
        </View>

        <View className="flex-row gap-3">
          <StatCard label="Price (ETH)" value={formatPrice(token.price)} />
          <StatCard label="Market cap" value={formatCompactEth(token.marketCap)} />
        </View>
        <View className="flex-row gap-3">
          <StatCard label="Holders" value={token.holderCount} />
          <StatCard
            label={token.stage === 'graduated' ? 'Status' : 'To Uniswap'}
            value={token.stage === 'graduated' ? 'Live' : `${token.graduationPct.toFixed(0)}%`}
          />
        </View>

        {token.description ? (
          <Text className="text-text-secondary text-sm leading-relaxed">{token.description}</Text>
        ) : null}

        {socials.length > 0 && (
          <View className="flex-row flex-wrap gap-2">
            {socials.map((k) => (
              <Button
                key={k}
                variant="secondary"
                size="sm"
                onPress={() => void Linking.openURL(token.socials[k] as string)}
              >
                {SOCIAL_LABEL[k]}
              </Button>
            ))}
          </View>
        )}

        <Button onPress={() => void Linking.openURL(webTokenUrl(token.id))}>
          Trade on loar.fun
        </Button>
        <Button
          variant="secondary"
          onPress={() =>
            void Share.share({
              message: `$${token.symbol} on LOAR`,
              url: webTokenUrl(token.id),
            })
          }
        >
          Share
        </Button>
        <Text className="text-text-tertiary text-xs text-center">
          Trading opens in your browser — the LOAR app is read-only for launchpad tokens.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
