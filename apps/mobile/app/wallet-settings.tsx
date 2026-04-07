/**
 * Wallet settings screen — CDP wallet session management.
 */
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AssetRow } from '../src/components/portfolio/AssetRow';
import { Badge } from '../src/components/ui/Badge';
import { Button } from '../src/components/ui/Button';
import { Card } from '../src/components/ui/Card';
import { SectionHeader } from '../src/components/ui/SectionHeader';
import { useAuth } from '../src/contexts/AuthContext';
import { connectCDPWallet, disconnectCDP, getCDPChainId } from '../src/lib/cdp';

export default function WalletSettingsScreen() {
  const router = useRouter();
  const { address, signOut } = useAuth();
  const [chainId, setChainId] = useState<number | null>(null);

  useEffect(() => {
    getCDPChainId()
      .then(setChainId)
      .catch(() => setChainId(null));
  }, []);

  const networkName =
    chainId === 11155111 ? 'Sepolia Testnet' : chainId === 1 ? 'Ethereum Mainnet' : chainId ? `Chain ${chainId}` : 'Unknown';
  const networkOk = chainId === 11155111;

  const handleDisconnect = () => {
    Alert.alert('Disconnect', 'Disconnect your wallet and sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Disconnect',
        style: 'destructive',
        onPress: async () => {
          await disconnectCDP().catch(() => {});
          await signOut();
          router.replace('/(auth)/login');
        },
      },
    ]);
  };

  const handleReconnect = async () => {
    try {
      await connectCDPWallet();
      const id = await getCDPChainId();
      setChainId(id);
    } catch {
      // user cancelled
    }
  };

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
              <Badge variant={address ? 'success' : 'error'}>
                {address ? 'Connected' : 'Disconnected'}
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
              <Badge variant={networkOk ? 'success' : 'warning'}>{networkName}</Badge>
            </View>

            {!networkOk && chainId !== null ? (
              <Text className="text-warning text-xs">
                LOAR runs on Sepolia testnet. Switch your wallet to Sepolia (chain ID 11155111).
              </Text>
            ) : null}
          </View>
        </Card>

        {/* Session */}
        <View>
          <SectionHeader title="Session" />
          <View className="bg-card rounded-2xl border border-border px-4">
            <AssetRow
              icon="🔑"
              label="SIWE Session"
              subtitle={
                address
                  ? `Active — ${address.slice(0, 6)}…${address.slice(-4)}`
                  : 'No active session'
              }
              badge={
                <Badge variant={address ? 'success' : 'muted'}>
                  {address ? 'Active' : 'None'}
                </Badge>
              }
            />
          </View>
        </View>

        {/* Wallet actions */}
        <View>
          <SectionHeader title="Wallet" />
          <View className="bg-card rounded-2xl border border-border px-4">
            <AssetRow
              icon="🔄"
              label="Reconnect"
              subtitle="Re-open Coinbase Wallet to reconnect"
              onPress={handleReconnect}
            />
          </View>
        </View>

        {/* Security note */}
        <View className="bg-zinc-900 rounded-2xl p-4 gap-2">
          <Text className="text-text-primary font-semibold text-sm">Security</Text>
          <Text className="text-text-tertiary text-xs leading-relaxed">
            LOAR Vault is non-custodial. Your keys are managed by Coinbase Smart Wallet
            (Google, Apple, passkeys, or email). We only store a SIWE session JWT, which
            can be revoked at any time by disconnecting.
          </Text>
        </View>

        <Button onPress={handleDisconnect} variant="danger" fullWidth>
          Disconnect Wallet
        </Button>
      </ScrollView>
    </SafeAreaView>
  );
}
