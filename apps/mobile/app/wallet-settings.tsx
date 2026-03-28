/**
 * Wallet settings screen.
 *
 * Shows:
 *  - Connected wallet address
 *  - Network (Sepolia)
 *  - WalletConnect session info
 *  - Switch network option
 *  - Disconnect
 */
import { useAppKit, useAppKitAccount, useAppKitNetwork } from '@reown/appkit-react-native';
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
  const { address: siweAddress, signOut } = useAuth();
  const { address: wcAddress, isConnected } = useAppKitAccount();
  const { chainId } = useAppKitNetwork();
  const { open } = useAppKit();

  const address = wcAddress ?? siweAddress;

  const handleDisconnect = () => {
    Alert.alert('Disconnect', 'Disconnect your wallet and sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Disconnect',
        style: 'destructive',
        onPress: async () => {
          await signOut();
          router.replace('/(auth)/login');
        },
      },
    ]);
  };

  const networkName = chainId === 11155111 ? 'Sepolia Testnet' : `Chain ${chainId ?? 'Unknown'}`;
  const networkStatus = chainId === 11155111 ? 'success' : 'warning';

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['bottom']}>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 32, gap: 24 }}
      >
        {/* Wallet card */}
        <Card>
          <View className="gap-4">
            <View className="flex-row items-center justify-between">
              <Text className="text-text-primary font-bold">Connected Wallet</Text>
              <Badge variant={isConnected ? 'success' : 'error'}>
                {isConnected ? 'Connected' : 'Disconnected'}
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

            <View className="flex-row items-center justify-between">
              <Text className="text-text-secondary text-sm">Network</Text>
              <Badge variant={networkStatus as 'success' | 'warning'}>{networkName}</Badge>
            </View>
          </View>
        </Card>

        {/* Session */}
        <View>
          <SectionHeader title="Session" />
          <View className="bg-card rounded-2xl border border-border px-4">
            <AssetRow
              icon="🔑"
              label="SIWE Session"
              subtitle={siweAddress ? `Active for ${siweAddress.slice(0, 6)}…${siweAddress.slice(-4)}` : 'No session'}
              badge={<Badge variant={siweAddress ? 'success' : 'muted'}>{siweAddress ? 'Active' : 'None'}</Badge>}
            />
            {chainId !== 11155111 ? (
              <AssetRow
                icon="⚠️"
                label="Switch to Sepolia"
                subtitle="LOAR runs on Sepolia testnet"
                onPress={() => open({ view: 'Networks' })}
              />
            ) : null}
          </View>
        </View>

        {/* Change wallet */}
        <View>
          <SectionHeader title="Wallet" />
          <View className="bg-card rounded-2xl border border-border px-4">
            <AssetRow
              icon="🔄"
              label="Switch Wallet"
              subtitle="Connect a different wallet"
              onPress={() => open()}
            />
          </View>
        </View>

        {/* Security note */}
        <View className="bg-zinc-900 rounded-2xl p-4 gap-2">
          <Text className="text-text-primary font-semibold text-sm">Security</Text>
          <Text className="text-text-tertiary text-xs leading-relaxed">
            LOAR Vault is non-custodial. Your private keys never leave your wallet. We only
            store a session JWT tied to your SIWE signature, which expires and can be revoked
            at any time by disconnecting.
          </Text>
        </View>

        {/* Disconnect */}
        <Button onPress={handleDisconnect} variant="danger" fullWidth>
          Disconnect Wallet
        </Button>
      </ScrollView>
    </SafeAreaView>
  );
}
