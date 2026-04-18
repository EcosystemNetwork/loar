/**
 * Collections tab — grid of all NFTs owned by the user.
 *
 * Sources:
 *   - Episode NFTs via marketplace router
 *   - Character NFTs via nft router
 *   - Pulls ownership from on-chain indexer (future: direct query)
 *
 * For now, queries the server's NFT records linked to the user's address.
 */
import { useQuery } from '@tanstack/react-query';
import React, { useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NFTCard } from '../../src/components/portfolio/NFTCard';
import { EmptyState } from '../../src/components/ui/EmptyState';
import { LoadingSpinner } from '../../src/components/ui/LoadingSpinner';
import { useAuth } from '../../src/contexts/AuthContext';
import { trpc } from '../../src/lib/trpc';
import type { NFT } from '../../src/types';

type FilterTab = 'all' | 'episode' | 'character';

const FILTER_TABS: { key: FilterTab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'episode', label: 'Episodes' },
  { key: 'character', label: 'Characters' },
];

export default function CollectionsScreen() {
  const { address } = useAuth(); // used for ownerAddress field
  const [filter, setFilter] = useState<FilterTab>('all');

  // Query NFTs minted by the authenticated user
  const nftMintsQuery = useQuery(trpc.nft.getMyNFTs.queryOptions());

  const isLoading = nftMintsQuery.isLoading;
  const nftsData =
    nftMintsQuery.data && !Array.isArray(nftMintsQuery.data)
      ? nftMintsQuery.data
      : { createdEpisodes: [], createdCharacters: [], mintedEpisodes: [] };
  const flattened: any[] = [
    ...nftsData.createdEpisodes,
    ...nftsData.createdCharacters,
    ...nftsData.mintedEpisodes,
  ];
  const allNfts: NFT[] = flattened.map((m: any) => ({
    id: m.id ?? m.nftListingId ?? m.contentId,
    tokenId: m.tokenId ?? '0',
    contractAddress: m.contractAddress ?? '',
    kind: (m.mediaType?.includes('video') ? 'episode' : 'character') as 'episode' | 'character',
    name: m.title ?? 'Unnamed',
    description: m.description,
    imageUrl: m.thumbnailUrl ?? m.imageUrl,
    videoUrl: m.videoUrl,
    universeId: m.universeId,
    universeName: m.universeName,
    ownerAddress: address ?? '',
    mintedAt: m.mintedAt ?? m.createdAt,
    listingPrice: m.mintPrice,
    isListed: Boolean(m.active && m.mintPrice && m.mintPrice !== '0'),
  }));

  const filtered = filter === 'all' ? allNfts : allNfts.filter((n) => n.kind === filter);

  if (isLoading) return <LoadingSpinner message="Loading collection…" />;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['bottom']}>
      {/* Filter tabs */}
      <View className="flex-row gap-2 px-4 pt-4 pb-2">
        {FILTER_TABS.map((tab) => (
          <Pressable
            key={tab.key}
            onPress={() => setFilter(tab.key)}
            className={`rounded-full px-4 py-1.5 ${
              filter === tab.key ? 'bg-primary' : 'bg-zinc-900 border border-border'
            }`}
          >
            <Text
              className={`text-sm font-semibold ${
                filter === tab.key ? 'text-white' : 'text-text-secondary'
              }`}
            >
              {tab.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {filtered.length === 0 ? (
        <EmptyState
          icon="🖼"
          title="No collectibles yet"
          description="Episode and character NFTs you own will appear here."
        />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          numColumns={2}
          columnWrapperStyle={{ gap: 12, paddingHorizontal: 16 }}
          contentContainerStyle={{ paddingTop: 8, paddingBottom: 32, gap: 12 }}
          refreshControl={
            <RefreshControl
              refreshing={nftMintsQuery.isFetching}
              onRefresh={() => nftMintsQuery.refetch()}
              tintColor="#7c3aed"
            />
          }
          renderItem={({ item }) => <NFTCard nft={item} />}
        />
      )}
    </SafeAreaView>
  );
}
