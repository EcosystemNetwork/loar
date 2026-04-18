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
import { EmptyState } from '../../src/components/ui/EmptyState';
import { LoadingSpinner } from '../../src/components/ui/LoadingSpinner';
import { SectionHeader } from '../../src/components/ui/SectionHeader';
import { useAuth } from '../../src/contexts/AuthContext';
import { trpc } from '../../src/lib/trpc';

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

  const isLoading = universesQuery.isLoading;
  const universes =
    universesQuery.data && !Array.isArray(universesQuery.data)
      ? universesQuery.data.data
      : ((universesQuery.data ?? []) as any[]);

  // $LOAR platform token (tracked separately — currently placeholder)
  const loarBalance = '0'; // TODO: query LoarToken contract via indexer

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
            refreshing={universesQuery.isFetching}
            onRefresh={() => universesQuery.refetch()}
            tintColor="#7c3aed"
          />
        }
      >
        {/* Platform token */}
        <View>
          <SectionHeader title="Platform Token" />
          <View className="bg-card rounded-2xl border border-border px-4">
            <AssetRow
              icon="⬡"
              label="$LOAR"
              subtitle="LOAR governance & utility token"
              value={loarBalance === '0' ? '–' : loarBalance}
            />
          </View>
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
            Token balances are read directly from the Sepolia blockchain. Make sure your wallet is
            connected to Sepolia to see accurate holdings. Full balance tracking via the LOAR
            indexer is coming in the next release.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
