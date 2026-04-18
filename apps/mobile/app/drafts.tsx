/**
 * Drafts screen — sandbox draft creations.
 *
 * Lists all drafts with thumbnail, title, tags, and status.
 * Actions:
 *   - Promote to universe
 *   - Delete draft
 */
import { useMutation, useQuery } from '@tanstack/react-query';
import React, { useState } from 'react';
import {
  ActionSheetIOS,
  Alert,
  FlatList,
  Image,
  Platform,
  Pressable,
  RefreshControl,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Badge } from '../src/components/ui/Badge';
import { EmptyState } from '../src/components/ui/EmptyState';
import { LoadingSpinner } from '../src/components/ui/LoadingSpinner';
import { trpc, queryClient } from '../src/lib/trpc';
import type { Draft } from '../src/types';

export default function DraftsScreen() {
  const draftsQuery = useQuery(trpc.sandbox.myDrafts.queryOptions());

  const deleteMutation = useMutation(
    trpc.sandbox.deleteDraft.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries(),
    })
  );

  const drafts = (draftsQuery.data ?? []) as Draft[];

  const handleDraftAction = (draft: Draft) => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['Cancel', 'Delete Draft'],
          cancelButtonIndex: 0,
          destructiveButtonIndex: 1,
          title: draft.title,
        },
        (idx) => {
          if (idx === 1) confirmDelete(draft);
        }
      );
    } else {
      Alert.alert(draft.title, 'What would you like to do?', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => confirmDelete(draft),
        },
      ]);
    }
  };

  const confirmDelete = (draft: Draft) => {
    Alert.alert('Delete Draft', `Delete "${draft.title}"? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => deleteMutation.mutate({ id: draft.id }),
      },
    ]);
  };

  if (draftsQuery.isLoading) return <LoadingSpinner message="Loading drafts…" />;

  if (drafts.length === 0) {
    return (
      <SafeAreaView className="flex-1 bg-background" edges={['bottom']}>
        <EmptyState
          icon="📝"
          title="No drafts yet"
          description="Creations you save in the sandbox will appear here. Use the web app to generate and save drafts."
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['bottom']}>
      <FlatList
        data={drafts}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 32 }}
        refreshControl={
          <RefreshControl
            refreshing={draftsQuery.isFetching}
            onRefresh={() => draftsQuery.refetch()}
            tintColor="#7c3aed"
          />
        }
        renderItem={({ item }) => (
          <Pressable
            onLongPress={() => handleDraftAction(item)}
            onPress={() => handleDraftAction(item)}
            className="bg-card rounded-2xl border border-border overflow-hidden active:opacity-80"
          >
            <View className="flex-row gap-3 p-3">
              {/* Thumbnail */}
              <View className="w-20 h-20 rounded-xl overflow-hidden bg-zinc-900 items-center justify-center flex-shrink-0">
                {item.imageUrl ? (
                  <Image
                    source={{ uri: item.imageUrl }}
                    className="w-full h-full"
                    resizeMode="cover"
                  />
                ) : (
                  <Text className="text-2xl">{item.videoUrl ? '🎬' : '🖼'}</Text>
                )}
              </View>

              {/* Content */}
              <View className="flex-1 gap-1.5">
                <Text className="text-text-primary font-semibold" numberOfLines={1}>
                  {item.title}
                </Text>
                <Text className="text-text-tertiary text-xs" numberOfLines={2}>
                  {item.prompt}
                </Text>
                <View className="flex-row items-center gap-2 flex-wrap mt-1">
                  <Badge variant={item.status === 'promoted' ? 'success' : 'default'}>
                    {item.status}
                  </Badge>
                  {item.model ? <Badge variant="muted">{item.model.slice(0, 12)}</Badge> : null}
                  {item.tags?.slice(0, 2).map((tag) => (
                    <Badge key={tag} variant="muted">
                      {tag}
                    </Badge>
                  ))}
                </View>
              </View>

              {/* Date */}
              <View className="items-end justify-start gap-1">
                {item.createdAt ? (
                  <Text className="text-text-tertiary text-xs">
                    {new Date(item.createdAt).toLocaleDateString('en', {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </Text>
                ) : null}
                <Text className="text-text-tertiary text-base">⋯</Text>
              </View>
            </View>
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}
