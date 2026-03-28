/**
 * Login screen — wallet connection + SIWE sign-in.
 *
 * Uses Reown AppKit for WalletConnect. The AppKit provider opens a modal
 * showing available wallets (MetaMask, Trust, Coinbase Wallet, etc.).
 *
 * Once the user connects and signs the SIWE message, they are redirected
 * to the portfolio home.
 */
import { useAppKit, useAppKitAccount, useAppKitProvider } from '@reown/appkit-react-native';
import { useRouter } from 'expo-router';
import React, { useEffect } from 'react';
import { Alert, Image, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../../src/components/ui/Button';
import { useAuth } from '../../src/contexts/AuthContext';

export default function LoginScreen() {
  const router = useRouter();
  const { open } = useAppKit();
  const { address, isConnected } = useAppKitAccount();
  const { walletProvider } = useAppKitProvider('eip155');
  const { signIn, isAuthenticated, isAuthenticating, error, clearError } = useAuth();

  // Redirect when authenticated
  useEffect(() => {
    if (isAuthenticated) {
      router.replace('/(tabs)');
    }
  }, [isAuthenticated, router]);

  // Once wallet is connected, trigger SIWE sign-in
  useEffect(() => {
    if (isConnected && address && walletProvider && !isAuthenticated && !isAuthenticating) {
      const signMessage = async (message: string): Promise<string> => {
        // EIP-1193 personal_sign
        const sig = await (walletProvider as { request: (args: { method: string; params: [string, string] }) => Promise<string> }).request({
          method: 'personal_sign',
          params: [message, address],
        });
        return sig;
      };

      signIn(address, signMessage);
    }
  }, [isConnected, address, walletProvider, isAuthenticated, isAuthenticating, signIn]);

  useEffect(() => {
    if (error) {
      Alert.alert('Sign-in failed', error, [{ text: 'OK', onPress: clearError }]);
    }
  }, [error, clearError]);

  return (
    <SafeAreaView className="flex-1 bg-background">
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="flex-1 px-6 pt-16 pb-8 gap-8">
          {/* Logo / branding */}
          <View className="items-center gap-4 pt-8">
            <View className="w-20 h-20 rounded-2xl bg-primary items-center justify-center">
              <Text className="text-4xl">⬡</Text>
            </View>
            <View className="items-center gap-2">
              <Text className="text-text-primary text-3xl font-bold">LOAR Vault</Text>
              <Text className="text-text-secondary text-base text-center">
                Your decentralized portfolio for universes, collectibles, and earnings
              </Text>
            </View>
          </View>

          {/* Features */}
          <View className="gap-4">
            {[
              { icon: '🌌', title: 'Owned Universes', desc: 'Track all your tokenized story universes' },
              { icon: '🎬', title: 'Collectibles & NFTs', desc: 'Episode and character collections in one place' },
              { icon: '💎', title: 'Credits & Earnings', desc: 'Monitor credits, royalties, and pending payouts' },
              { icon: '🔐', title: 'Secure & On-Chain', desc: 'Non-custodial — your keys, your assets' },
            ].map((f) => (
              <View key={f.title} className="flex-row items-start gap-3">
                <View className="w-10 h-10 rounded-xl bg-zinc-900 items-center justify-center mt-0.5">
                  <Text className="text-xl">{f.icon}</Text>
                </View>
                <View className="flex-1">
                  <Text className="text-text-primary font-semibold text-sm">{f.title}</Text>
                  <Text className="text-text-tertiary text-xs mt-0.5">{f.desc}</Text>
                </View>
              </View>
            ))}
          </View>

          {/* Spacer */}
          <View className="flex-1" />

          {/* Connect button */}
          <View className="gap-3">
            {isConnected && !isAuthenticated ? (
              <View className="bg-zinc-900 rounded-xl p-3 items-center">
                <Text className="text-text-secondary text-xs">
                  Connected: {address?.slice(0, 6)}…{address?.slice(-4)}
                </Text>
                <Text className="text-text-tertiary text-xs mt-1">
                  Waiting for SIWE signature…
                </Text>
              </View>
            ) : null}

            <Button
              onPress={() => open()}
              loading={isAuthenticating}
              fullWidth
              size="lg"
            >
              {isConnected ? 'Sign In' : 'Connect Wallet'}
            </Button>

            <Text className="text-text-tertiary text-xs text-center">
              Supports MetaMask, Coinbase Wallet, Trust, Rainbow, and 300+ wallets
            </Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
