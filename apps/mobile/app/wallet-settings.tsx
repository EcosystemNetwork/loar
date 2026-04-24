/**
 * Wallet settings screen — Circle-managed EOA details + session controls.
 *
 * With Circle DCW the wallet is server-managed (KMS). There is no
 * per-device "connection" to toggle — showing up on this screen with a
 * live JWT is, by definition, being connected. The reconnect flow from
 * the thirdweb era is gone; signing out and back in is the equivalent.
 */
import { useRouter } from 'expo-router';
import React from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AssetRow } from '../src/components/portfolio/AssetRow';
import { Badge } from '../src/components/ui/Badge';
import { Button } from '../src/components/ui/Button';
import { Card } from '../src/components/ui/Card';
import { SectionHeader } from '../src/components/ui/SectionHeader';
import { useAuth } from '../src/contexts/AuthContext';

export default function WalletSettingsScreen() {
  const router = useRouter();
  const { address, email, expiresAt, signOut } = useAuth();

  const handleDisconnect = () => {
    Alert.alert('Sign out', 'End this session and return to the login screen?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          await signOut();
          router.replace('/(auth)/login');
        },
      },
    ]);
  };

  const expiresLabel = expiresAt ? new Date(expiresAt).toLocaleString() : null;

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
      >
        {/* Wallet card */}
        <Card>
          <View className="gap-4">
            <View className="flex-row items-center justify-between">
              <Text className="text-text-primary font-bold">Wallet</Text>
              <Badge variant={address ? 'success' : 'error'}>
                {address ? 'Active' : 'Inactive'}
              </Badge>
            </View>

            {address ? (
              <View className="bg-zinc-900 rounded-xl p-3 gap-1">
                <Text className="text-text-tertiary text-xs">Address</Text>
                <Text className="text-text-secondary text-sm font-mono" numberOfLines={1}>
                  {address}
                </Text>
              </View>
            ) : null}

            {email ? (
              <View className="bg-zinc-900 rounded-xl p-3 gap-1">
                <Text className="text-text-tertiary text-xs">Signed in as</Text>
                <Text className="text-text-secondary text-sm" numberOfLines={1}>
                  {email}
                </Text>
              </View>
            ) : null}
          </View>
        </Card>

        {/* Session */}
        <View>
          <SectionHeader title="Session" />
          <View className="bg-card rounded-2xl border border-border px-4">
            <AssetRow
              icon="🔑"
              label="Session Token"
              subtitle={expiresLabel ? `Expires ${expiresLabel}` : 'Active'}
              badge={<Badge variant="success">Active</Badge>}
            />
          </View>
        </View>

        {/* Security note */}
        <View className="bg-zinc-900 rounded-2xl p-4 gap-2">
          <Text className="text-text-primary font-semibold text-sm">How this works</Text>
          <Text className="text-text-tertiary text-xs leading-relaxed">
            LOAR uses Circle Developer Controlled Wallets. Your signing keys are held in
            Circle&apos;s KMS and never touch this device. Contract writes are proxied through the
            LOAR server, which enforces an on-chain contract allowlist before signing. Sign out to
            revoke this session.
          </Text>
        </View>

        <Button onPress={handleDisconnect} variant="danger" fullWidth>
          Sign Out
        </Button>
      </ScrollView>
    </SafeAreaView>
  );
}
