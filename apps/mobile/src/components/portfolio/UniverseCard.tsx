import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import type { Universe } from '../../types';
import { useIpfsUrl } from '../../lib/ipfs-url';

interface UniverseCardProps {
  universe: Universe;
}

export function UniverseCard({ universe }: UniverseCardProps) {
  const router = useRouter();
  const imageUri = useIpfsUrl(universe.imageUrl);
  const [imageFailed, setImageFailed] = useState(false);

  const shortAddress = universe.address
    ? `${universe.address.slice(0, 6)}…${universe.address.slice(-4)}`
    : '';

  // Missing content — no image at all, or every gateway attempt failed to
  // load — hide the card entirely instead of showing a broken-image tile.
  if (!universe.imageUrl || imageFailed) return null;

  return (
    <Pressable
      onPress={() => router.push(`/universe/${universe.id}`)}
      className="bg-card rounded-2xl border border-border overflow-hidden active:opacity-80"
      style={{ width: 160 }}
    >
      <Image
        source={{ uri: imageUri }}
        className="w-full h-24"
        resizeMode="cover"
        onError={() => setImageFailed(true)}
      />
      <View className="p-3 gap-1">
        <Text className="text-text-primary font-semibold text-sm" numberOfLines={1}>
          {universe.name || universe.description?.slice(0, 30) || 'Universe'}
        </Text>
        <Text className="text-text-tertiary text-xs">{shortAddress}</Text>
      </View>
    </Pressable>
  );
}
