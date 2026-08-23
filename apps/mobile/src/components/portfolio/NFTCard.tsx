import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import type { NFT } from '../../types';
import { Badge } from '../ui/Badge';
import { useIpfsUrl } from '../../lib/ipfs-url';

interface NFTCardProps {
  nft: NFT;
}

export function NFTCard({ nft }: NFTCardProps) {
  const router = useRouter();
  const imageUri = useIpfsUrl(nft.imageUrl);
  const [imageFailed, setImageFailed] = useState(false);

  // Missing content — no image at all, or every gateway attempt failed to
  // load — hide the card entirely instead of showing a broken-image tile.
  if (!nft.imageUrl || imageFailed) return null;

  return (
    <Pressable
      onPress={() => router.push(`/asset/${nft.id}`)}
      className="bg-card rounded-2xl border border-border overflow-hidden active:opacity-80"
      style={{ width: 160 }}
    >
      <Image
        source={{ uri: imageUri }}
        className="w-full h-40"
        resizeMode="cover"
        onError={() => setImageFailed(true)}
      />
      <View className="p-3 gap-1.5">
        <Text className="text-text-primary font-semibold text-sm" numberOfLines={1}>
          {nft.name}
        </Text>
        {nft.universeName ? (
          <Text className="text-text-tertiary text-xs" numberOfLines={1}>
            {nft.universeName}
          </Text>
        ) : null}
        <View className="flex-row items-center gap-2 mt-0.5">
          <Badge variant={nft.kind === 'episode' ? 'primary' : 'success'}>
            {nft.kind === 'episode' ? 'Episode' : 'Character'}
          </Badge>
          {nft.isListed ? <Badge variant="warning">Listed</Badge> : null}
        </View>
      </View>
    </Pressable>
  );
}
