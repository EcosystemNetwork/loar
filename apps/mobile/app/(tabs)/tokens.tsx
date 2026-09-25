/**
 * Tokens tab — universe governance token holdings + $LOAR platform token.
 *
 * For each universe the user owns or has invested in, displays:
 *   - Token name & symbol
 *   - Balance (raw on-chain, formatted)
 *   - Universe name / image
 *   - Quick link to governance
 */
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import React from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AssetRow } from '../../src/components/portfolio/AssetRow';
import {
  KingOfTheHillCard,
  TokenRow,
  type LaunchpadToken,
} from '../../src/components/launchpad/TokenRow';
import { EmptyState } from '../../src/components/ui/EmptyState';
import { LoadingSpinner } from '../../src/components/ui/LoadingSpinner';
import { SectionHeader } from '../../src/components/ui/SectionHeader';
import { useAuth } from '../../src/contexts/AuthContext';
import { trpc, type RouterOutputs } from '../../src/lib/trpc';

type Onchain = RouterOutputs['revenue']['getOnchainBalances'];

export default function TokensScreen() {
  const router = useRouter();
  const { address } = useAuth();

  // Universes I created → know their token addresses
  const universesQuery = useQuery(
    trpc.universes.getByCreator.queryOptions(
      { creator: address ?? '' },
      { enabled: Boolean(address) }
    )
  );

  // Public launchpad feed — top tokens by market cap, plus the King of the Hill.
  const launchpadQuery = useQuery(trpc.launchpad.list.queryOptions({ limit: 10 }));
  // Annotated explicitly: the inferred AppRouter output degrades to `any` under mobile's tsc.
  const launchpad = launchpadQuery.data as
    | { tokens: LaunchpadToken[]; king: LaunchpadToken | null }
    | undefined;

  const isLoading = universesQuery.isLoading;
  const universes =
    universesQuery.data && !Array.isArray(universesQuery.data)
      ? universesQuery.data.data
      : ((universesQuery.data ?? []) as any[]);

  // $LOAR platform token — read live from the LoarToken contract (server-side, via
  // `revenue.getOnchainBalances`; mobile has no EVM stack of its own).
  const onchainQuery = useQuery(trpc.revenue.getOnchainBalances.queryOptions());
  const onchain = onchainQuery.data as Onchain | undefined;
  const loarBalance = onchainQuery.isLoading ? '…' : onchain?.supported ? onchain.loarBalance : '–';
  const loarSubtitle = onchainQuery.isError
    ? 'Balance unavailable — pull to retry'
    : onchain && !onchain.supported
      ? 'Connect an EVM wallet to see your balance'
      : 'LOAR governance & utility token';

  if (isLoading) return <LoadingSpinner message="Loading tokens…" />;

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
            refreshing={
              universesQuery.isFetching || onchainQuery.isRefetching || launchpadQuery.isRefetching
            }
            onRefresh={() => {
              void universesQuery.refetch();
              void onchainQuery.refetch();
              void launchpadQuery.refetch();
            }}
            tintColor="#7c3aed"
          />
        }
      >
        {/* Platform token */}
        <View>
          <SectionHeader title="Platform Token" />
          <View className="bg-card rounded-2xl border border-border px-4">
            <AssetRow icon="⬡" label="$LOAR" subtitle={loarSubtitle} value={loarBalance} />
          </View>
        </View>

        {/* Launchpad — discover tokens (read-only; trading opens on web) */}
        <View className="gap-3">
          <SectionHeader title="Launchpad" count={launchpad?.tokens.length} />
          {launchpad?.king && (
            <KingOfTheHillCard
              token={launchpad.king}
              onPress={() => router.push(`/token/${launchpad.king!.id}`)}
            />
          )}
          {launchpadQuery.isLoading ? (
            <Text className="text-text-tertiary text-sm">Loading launchpad…</Text>
          ) : launchpadQuery.isError ? (
            <EmptyState
              icon="📡"
              title="Launchpad unavailable"
              description="Couldn't reach the indexer. Pull down to retry."
            />
          ) : (launchpad?.tokens.length ?? 0) === 0 ? (
            <EmptyState
              icon="🚀"
              title="No tokens yet"
              description="Launched tokens will show up here."
            />
          ) : (
            <View className="bg-card rounded-2xl border border-border px-4">
              {launchpad!.tokens.map((t) => (
                <TokenRow key={t.id} token={t} onPress={() => router.push(`/token/${t.id}`)} />
              ))}
            </View>
          )}
        </View>

        {/* Universe tokens */}
        <View>
          <SectionHeader title="Universe Tokens" count={universes.length} />
          {universes.length === 0 ? (
            <EmptyState
              icon="💎"
              title="No universe tokens"
              description="Governance tokens from your universes will appear here."
            />
          ) : (
            <View className="bg-card rounded-2xl border border-border px-4">
              {universes.map((u: any) => (
                <AssetRow
                  key={u.id}
                  icon="🌌"
                  label={u.name ?? u.description?.slice(0, 24) ?? 'Universe'}
                  subtitle={
                    u.tokenAddress
                      ? `${u.tokenAddress.slice(0, 6)}…${u.tokenAddress.slice(-4)}`
                      : 'Token not deployed'
                  }
                  onPress={() => router.push(`/universe/${u.id}`)}
                />
              ))}
            </View>
          )}
        </View>

        {/* Info box */}
        <View className="bg-zinc-900 rounded-2xl p-4 gap-2">
          <Text className="text-text-primary font-semibold text-sm">On-Chain Token Balances</Text>
          <Text className="text-text-tertiary text-xs leading-relaxed">
            Your $LOAR balance is read directly from the Sepolia blockchain. Per-universe token
            balances aren't shown yet — each universe below lists its token contract.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
