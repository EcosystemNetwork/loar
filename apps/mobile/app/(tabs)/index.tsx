/**
 * Watch — the app's front door.
 *
 * A full-screen vertical feed of canon episodes across every public universe
 * (`episodes.feed`, a public procedure — no sign-in needed). One episode per
 * page; the visible one autoplays on loop, its neighbours are pre-mounted so
 * a swipe starts instantly, everything else is just a poster.
 *
 * Signed-out viewers get a "Sign in" pill; the wallet tabs (Portfolio,
 * Collection, Tokens, Earnings) only appear after sign-in.
 */
import { useQuery } from '@tanstack/react-query';
import { useFocusEffect, useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  Share,
  Text,
  View,
  type LayoutChangeEvent,
  type ViewToken,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EmptyState } from '../../src/components/ui/EmptyState';
import { LoadingSpinner } from '../../src/components/ui/LoadingSpinner';
import { useAuth } from '../../src/contexts/AuthContext';
import { useIpfsUrl } from '../../src/lib/ipfs-url';
import { trpc, type RouterOutputs } from '../../src/lib/trpc';

type FeedEpisode = RouterOutputs['episodes']['feed'][number];

const WEB_URL = (process.env.EXPO_PUBLIC_WEB_URL || 'https://loar.fun').replace(/\/$/, '');

/** Link that unfurls with a preview card (server `/share/universe/:id`). */
function universeShareUrl(universeId: string): string {
  return `${WEB_URL}/share/universe/${encodeURIComponent(universeId)}`;
}

function playableUrl(ep: FeedEpisode): string | null {
  return ep.exportUrl || ep.videoUrl || null;
}

export default function WatchScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isAuthenticated } = useAuth();
  const [pageHeight, setPageHeight] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [muted, setMuted] = useState(false);
  const [focused, setFocused] = useState(true);

  const feedQuery = useQuery(trpc.episodes.feed.queryOptions({ limit: 30, perUniverseCap: 3 }));
  const episodes = ((feedQuery.data ?? []) as FeedEpisode[]).filter((e) => !!playableUrl(e));

  // Pause when the user leaves the tab (Portfolio, a pushed screen, …).
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, [])
  );

  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const first = viewableItems.find((v) => v.isViewable);
    if (first?.index != null) setActiveIndex(first.index);
  }).current;

  const onLayout = (e: LayoutChangeEvent) => {
    const h = Math.round(e.nativeEvent.layout.height);
    if (h > 0 && h !== pageHeight) setPageHeight(h);
  };

  if (feedQuery.isLoading) return <LoadingSpinner message="Loading episodes…" />;

  if (episodes.length === 0) {
    return (
      <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
        <EmptyState
          icon="🎬"
          title={feedQuery.isError ? 'Could not load the feed' : 'No episodes yet'}
          description={
            feedQuery.isError
              ? 'Check your connection and try again.'
              : 'New episodes from LOAR universes will show up here.'
          }
          actionLabel="Retry"
          onAction={() => void feedQuery.refetch()}
        />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-black" onLayout={onLayout}>
      {pageHeight > 0 && (
        <FlatList
          data={episodes}
          keyExtractor={(e) => e.id}
          pagingEnabled
          showsVerticalScrollIndicator={false}
          decelerationRate="fast"
          snapToInterval={pageHeight}
          getItemLayout={(_, index) => ({ length: pageHeight, offset: pageHeight * index, index })}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={{ itemVisiblePercentThreshold: 80 }}
          windowSize={3}
          initialNumToRender={2}
          maxToRenderPerBatch={2}
          removeClippedSubviews
          refreshControl={
            <RefreshControl
              refreshing={feedQuery.isRefetching}
              onRefresh={() => void feedQuery.refetch()}
              tintColor="#f2823b"
            />
          }
          renderItem={({ item, index }) => (
            <FeedPage
              episode={item}
              height={pageHeight}
              // Mount players only for the visible page and its neighbours.
              mountPlayer={Math.abs(index - activeIndex) <= 1}
              playing={focused && index === activeIndex}
              muted={muted}
              onToggleMute={() => setMuted((m) => !m)}
              onOpenUniverse={() =>
                router.push({ pathname: '/universe/[id]', params: { id: item.universe.id } })
              }
            />
          )}
        />
      )}

      {!isAuthenticated && (
        <Pressable
          onPress={() => router.push('/(auth)/login')}
          className="absolute right-4 rounded-full bg-primary px-4 py-2"
          style={{ top: insets.top + 8 }}
          accessibilityRole="button"
        >
          <Text className="text-black font-semibold text-sm">Sign in</Text>
        </Pressable>
      )}
    </View>
  );
}

function FeedPage({
  episode,
  height,
  mountPlayer,
  playing,
  muted,
  onToggleMute,
  onOpenUniverse,
}: {
  episode: FeedEpisode;
  height: number;
  mountPlayer: boolean;
  playing: boolean;
  muted: boolean;
  onToggleMute: () => void;
  onOpenUniverse: () => void;
}) {
  const poster = useIpfsUrl(episode.thumbnailUrl || episode.universe.imageURL || null);

  const handleShare = async () => {
    try {
      await Share.share({
        message: `${episode.title} — ${episode.universe.name} on LOAR ${universeShareUrl(episode.universe.id)}`,
        url: universeShareUrl(episode.universe.id),
      });
    } catch {
      /* dismissed */
    }
  };

  return (
    <View style={{ height }} className="bg-black">
      {poster ? (
        <Image
          source={{ uri: poster }}
          className="absolute inset-0"
          style={{ width: '100%', height: '100%' }}
          resizeMode="cover"
          blurRadius={mountPlayer ? 0 : 2}
        />
      ) : null}

      {mountPlayer && <EpisodeVideo url={playableUrl(episode)!} playing={playing} muted={muted} />}

      {/* Tap anywhere to mute / unmute, like every short-video app. */}
      <Pressable
        className="absolute inset-0"
        onPress={onToggleMute}
        accessibilityLabel={muted ? 'Unmute' : 'Mute'}
      />

      <View className="absolute left-0 right-0 bottom-0 px-4 pb-6 pt-16 bg-black/50">
        <Pressable onPress={onOpenUniverse} accessibilityRole="link">
          <Text className="text-primary-light text-sm font-semibold" numberOfLines={1}>
            {episode.universe.name || 'LOAR universe'} ›
          </Text>
        </Pressable>
        <Text className="text-text-primary text-xl font-bold mt-1" numberOfLines={2}>
          {episode.title}
        </Text>
        {episode.description ? (
          <Text className="text-text-secondary text-sm mt-1" numberOfLines={2}>
            {episode.description}
          </Text>
        ) : null}
        <View className="flex-row gap-3 mt-4">
          <Pressable
            onPress={onOpenUniverse}
            className="rounded-full bg-primary px-4 py-2"
            accessibilityRole="button"
          >
            <Text className="text-black font-semibold text-sm">View universe</Text>
          </Pressable>
          <Pressable
            onPress={handleShare}
            className="rounded-full bg-white/15 px-4 py-2"
            accessibilityRole="button"
          >
            <Text className="text-white font-semibold text-sm">Share</Text>
          </Pressable>
          <Pressable
            onPress={onToggleMute}
            className="rounded-full bg-white/15 px-4 py-2"
            accessibilityRole="button"
          >
            <Text className="text-white font-semibold text-sm">{muted ? '🔇' : '🔊'}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function EpisodeVideo({ url, playing, muted }: { url: string; playing: boolean; muted: boolean }) {
  // Token-gated gateway URLs are upgraded to a server-signed URL (SEC-4).
  const src = useIpfsUrl(url);
  const player = useVideoPlayer(src, (p) => {
    p.loop = true;
  });

  useEffect(() => {
    player.muted = muted;
  }, [player, muted]);

  useEffect(() => {
    if (playing) player.play();
    else player.pause();
  }, [player, playing, src]);

  return (
    <VideoView
      player={player}
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      contentFit="cover"
      nativeControls={false}
      allowsFullscreen={false}
      allowsPictureInPicture={false}
    />
  );
}
