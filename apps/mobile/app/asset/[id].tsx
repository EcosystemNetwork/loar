/**
 * Asset detail screen — full view of a single NFT or collectible.
 *
 * Shows:
 *   - Media (video or image)
 *   - Metadata (name, description, universe, type)
 *   - Ownership info
 *   - Monetization rights & royalties
 *   - Actions: list, transfer, use in story, share
 */
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Alert, Image, ScrollView, Share, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Badge } from '../../src/components/ui/Badge';
import { Button } from '../../src/components/ui/Button';
import { LoadingSpinner } from '../../src/components/ui/LoadingSpinner';
import { trpc } from '../../src/lib/trpc';

export default function AssetDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  // Fetch the NFT record (content item)
  const contentQuery = useQuery(
    trpc.content.get.queryOptions({ id })
  );

  const content = contentQuery.data;

  const handleShare = async () => {
    try {
      await Share.share({
        message: `Check out "${content?.title ?? 'this asset'}" on LOAR`,
        url: `https://loartech.xyz/asset/${id}`,
      });
    } catch {
      // user cancelled
    }
  };

  const handleList = () => {
    Alert.alert('List for Sale', 'Listing is managed from the web app marketplace.', [
      { text: 'OK' },
    ]);
  };

  const handleTransfer = () => {
    Alert.alert(
      'Transfer',
      'Enter the destination wallet address to transfer this asset.',
      [{ text: 'Cancel', style: 'cancel' }, { text: 'Continue (Web)', onPress: () => {} }]
    );
  };

  if (contentQuery.isLoading) return <LoadingSpinner message="Loading asset…" />;

  if (!content) {
    return (
      <SafeAreaView className="flex-1 bg-background items-center justify-center gap-4">
        <Text className="text-3xl">😕</Text>
        <Text className="text-text-secondary">Asset not found</Text>
        <Button onPress={() => router.back()} variant="secondary" size="sm">
          Go Back
        </Button>
      </SafeAreaView>
    );
  }

  const mediaUrl = content.mediaUrl ?? content.thumbnailUrl;
  const kind = content.mediaType?.includes('video') ? 'video' : 'image';

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['bottom']}>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 32 }}
      >
        {/* Media */}
        {mediaUrl ? (
          <Image
            source={{ uri: mediaUrl }}
            className="w-full"
            style={{ aspectRatio: 16 / 9 }}
            resizeMode="cover"
          />
        ) : (
          <View
            className="w-full bg-zinc-900 items-center justify-center"
            style={{ aspectRatio: 16 / 9 }}
          >
            <Text className="text-6xl">{kind === 'video' ? '🎬' : '🖼'}</Text>
          </View>
        )}

        <View className="px-4 pt-5 gap-5">
          {/* Title & badges */}
          <View className="gap-2">
            <Text className="text-text-primary text-2xl font-bold">{content.title}</Text>
            <View className="flex-row gap-2 flex-wrap">
              {content.mediaType ? (
                <Badge variant="primary">{content.mediaType}</Badge>
              ) : null}
              {content.classification ? (
                <Badge variant={content.classification === 'original' ? 'success' : 'default'}>
                  {content.classification}
                </Badge>
              ) : null}
              {content.visibility ? (
                <Badge variant={content.visibility === 'public' ? 'muted' : 'warning'}>
                  {content.visibility}
                </Badge>
              ) : null}
            </View>
          </View>

          {/* Description */}
          {content.description ? (
            <View className="gap-1">
              <Text className="text-text-secondary text-sm font-semibold">Description</Text>
              <Text className="text-text-secondary text-sm leading-relaxed">
                {content.description}
              </Text>
            </View>
          ) : null}

          {/* Metadata */}
          <View className="bg-card rounded-2xl border border-border p-4 gap-3">
            <Text className="text-text-primary font-semibold">Details</Text>
            {[
              content.universeId && { label: 'Universe', value: content.universeId },
              content.creatorUid && { label: 'Creator', value: content.creatorUid },
              content.createdAt && {
                label: 'Created',
                value: new Date(
                  typeof content.createdAt === 'string' ? content.createdAt : content.createdAt
                ).toLocaleDateString(),
              },
              { label: 'Views', value: String(content.views ?? 0) },
              { label: 'Likes', value: String(content.likes ?? 0) },
            ]
              .filter(Boolean)
              .map((item: any) => (
                <View key={item.label} className="flex-row justify-between">
                  <Text className="text-text-tertiary text-sm">{item.label}</Text>
                  <Text className="text-text-secondary text-sm font-medium" numberOfLines={1}>
                    {item.value}
                  </Text>
                </View>
              ))}
          </View>

          {/* IP Declaration */}
          {content.ipDeclaration ? (
            <View className="bg-card rounded-2xl border border-border p-4 gap-2">
              <Text className="text-text-primary font-semibold">Rights</Text>
              <Text className="text-text-tertiary text-xs leading-relaxed">
                Original work:{' '}
                <Text className="text-text-secondary">
                  {content.ipDeclaration.isOriginal ? 'Yes' : 'No'}
                </Text>
                {'  '}
                License:{' '}
                <Text className="text-text-secondary">
                  {content.ipDeclaration.license ?? 'all-rights-reserved'}
                </Text>
              </Text>
            </View>
          ) : null}

          {/* Actions */}
          <View className="gap-3">
            <Text className="text-text-primary font-semibold">Actions</Text>
            <View className="flex-row gap-3">
              <Button onPress={handleShare} variant="secondary" size="sm">
                Share
              </Button>
              <Button onPress={handleList} variant="secondary" size="sm">
                List for Sale
              </Button>
              <Button onPress={handleTransfer} variant="secondary" size="sm">
                Transfer
              </Button>
            </View>
            {content.universeId ? (
              <Button
                onPress={() => router.push(`/universe/${content.universeId}`)}
                variant="ghost"
                size="sm"
              >
                Open Universe →
              </Button>
            ) : null}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
