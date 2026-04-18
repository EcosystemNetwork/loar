/**
 * Profile tab — user profile, stats, and quick settings.
 */
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import React from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AssetRow } from '../../src/components/portfolio/AssetRow';
import { Button } from '../../src/components/ui/Button';
import { LoadingSpinner } from '../../src/components/ui/LoadingSpinner';
import { SectionHeader } from '../../src/components/ui/SectionHeader';
import { useAuth } from '../../src/contexts/AuthContext';
import { trpc } from '../../src/lib/trpc';

export default function ProfileScreen() {
  const router = useRouter();
  const { address, signOut } = useAuth();

  const profileQuery = useQuery(trpc.profiles.me.queryOptions());

  const universesQuery = useQuery(
    trpc.universes.getByCreator.queryOptions(
      { creator: address ?? '' },
      { enabled: Boolean(address) }
    )
  );

  const profile = profileQuery.data;
  const universes = universesQuery.data ?? [];

  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure you want to disconnect your wallet?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: signOut,
      },
    ]);
  };

  if (profileQuery.isLoading) return <LoadingSpinner />;

  const displayName =
    profile?.username ||
    profile?.displayName ||
    (address ? `${address.slice(0, 6)}…${address.slice(-4)}` : 'Anonymous');

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['bottom']}>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 24,
          paddingBottom: 32,
          gap: 24,
        }}
      >
        {/* Avatar and name */}
        <View className="items-center gap-3">
          <View className="w-20 h-20 rounded-full bg-primary/20 border-2 border-primary items-center justify-center">
            <Text className="text-3xl">{profile?.avatarUrl ? '🖼' : '👤'}</Text>
          </View>
          <View className="items-center gap-1">
            <Text className="text-text-primary text-xl font-bold">{displayName}</Text>
            {address ? (
              <View className="bg-zinc-900 rounded-full px-3 py-1">
                <Text className="text-text-tertiary text-xs font-mono">
                  {address.slice(0, 10)}…{address.slice(-6)}
                </Text>
              </View>
            ) : null}
            {profile?.bio ? (
              <Text className="text-text-secondary text-sm text-center mt-1 px-4">
                {profile.bio}
              </Text>
            ) : null}
          </View>
        </View>

        {/* Stats row */}
        <View className="flex-row justify-around bg-card rounded-2xl border border-border p-4">
          <View className="items-center gap-1">
            <Text className="text-text-primary text-xl font-bold">{universes.length}</Text>
            <Text className="text-text-tertiary text-xs">Universes</Text>
          </View>
          <View className="w-px bg-border" />
          <View className="items-center gap-1">
            <Text className="text-text-primary text-xl font-bold">
              {profile?.contentCount ?? 0}
            </Text>
            <Text className="text-text-tertiary text-xs">Works</Text>
          </View>
          <View className="w-px bg-border" />
          <View className="items-center gap-1">
            <Text className="text-text-primary text-xl font-bold">
              {profile?.followerCount ?? 0}
            </Text>
            <Text className="text-text-tertiary text-xs">Followers</Text>
          </View>
        </View>

        {/* Account */}
        <View>
          <SectionHeader title="Account" />
          <View className="bg-card rounded-2xl border border-border px-4">
            <AssetRow
              icon="👛"
              label="Wallet Settings"
              subtitle="Connected wallet & network"
              onPress={() => router.push('/wallet-settings')}
            />
            <AssetRow
              icon="⚡"
              label="Credits"
              subtitle="Buy and manage generation credits"
              onPress={() => router.push('/credits')}
            />
            <AssetRow
              icon="🔁"
              label="Subscriptions"
              subtitle="Manage your subscriptions"
              onPress={() => router.push('/subscriptions')}
            />
          </View>
        </View>

        {/* Content */}
        <View>
          <SectionHeader title="Content" />
          <View className="bg-card rounded-2xl border border-border px-4">
            <AssetRow
              icon="📝"
              label="Drafts"
              subtitle="Unpublished creations"
              onPress={() => router.push('/drafts')}
            />
          </View>
        </View>

        {/* Sign out */}
        <Button onPress={handleSignOut} variant="danger" fullWidth>
          Disconnect Wallet
        </Button>
      </ScrollView>
    </SafeAreaView>
  );
}
