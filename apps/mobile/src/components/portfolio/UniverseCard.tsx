import { useRouter } from 'expo-router';
import React from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import type { Universe } from '../../types';
import { resolveIpfsUrl } from '../../lib/ipfs-url';

interface UniverseCardProps {
  universe: Universe;
}

export function UniverseCard({ universe }: UniverseCardProps) {
  const router = useRouter();

  const shortAddress = universe.address
    ? `${universe.address.slice(0, 6)}…${universe.address.slice(-4)}`
    : '';

  return (
    <Pressable
      onPress={() => router.push(`/universe/${universe.id}`)}
      className="bg-card rounded-2xl border border-border overflow-hidden active:opacity-80"
      style={{ width: 160 }}
    >
      {universe.imageUrl ? (
        <Image
          source={{ uri: resolveIpfsUrl(universe.imageUrl) }}
          className="w-full h-24"
          resizeMode="cover"
        />
      ) : (
        <View className="w-full h-24 bg-zinc-900 items-center justify-center">
          <Text className="text-3xl">🌌</Text>
        </View>
      )}
      <View className="p-3 gap-1">
        <Text className="text-text-primary font-semibold text-sm" numberOfLines={1}>
          {universe.name || universe.description?.slice(0, 30) || 'Universe'}
        </Text>
        <Text className="text-text-tertiary text-xs">{shortAddress}</Text>
      </View>
    </Pressable>
  );
}
