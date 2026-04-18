/**
 * Login screen — thirdweb in-app wallet connection + SIWE sign-in.
 *
 * thirdweb's `inAppWallet` supports Google / Apple / passkey / email login.
 * OAuth providers open via expo-web-browser and return through the
 * `loarvault://` deep link scheme configured in app.json.
 *
 * Flow:
 *  1. Tap "Continue with Google" → thirdweb opens the OAuth flow
 *  2. User authenticates and the wallet is created/resumed
 *  3. We get the wallet address
 *  4. We fetch a SIWE nonce from the server
 *  5. We ask the wallet to sign the SIWE message
 *  6. We send to /auth/verify → receive JWT
 *  7. JWT stored in expo-secure-store → redirect to portfolio
 */
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../../src/components/ui/Button';
import { useAuth } from '../../src/contexts/AuthContext';
import {
  connectWallet,
  getWalletChainId,
  signWithWallet,
  type ConnectStrategy,
} from '../../src/lib/thirdweb';

export default function LoginScreen() {
  const router = useRouter();
  const { signIn, isAuthenticated, isAuthenticating, error, clearError } = useAuth();
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectedAddress, setConnectedAddress] = useState<string | null>(null);

  // Redirect when authenticated
  useEffect(() => {
    if (isAuthenticated) {
      router.replace('/(tabs)');
    }
  }, [isAuthenticated, router]);

  useEffect(() => {
    if (error) {
      Alert.alert('Sign-in failed', error, [{ text: 'OK', onPress: clearError }]);
    }
  }, [error, clearError]);

  const handleConnect = async (strategy: ConnectStrategy) => {
    setIsConnecting(true);
    try {
      const address = await connectWallet(strategy);
      setConnectedAddress(address);

      const chainId = await getWalletChainId().catch(() => 84532);

      await signIn(address, (message) => signWithWallet(message), chainId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Connection failed';
      const isCancel =
        msg.toLowerCase().includes('cancel') ||
        msg.toLowerCase().includes('reject') ||
        msg.toLowerCase().includes('user denied');
      if (!isCancel) {
        Alert.alert('Connection failed', msg);
      }
      setConnectedAddress(null);
    } finally {
      setIsConnecting(false);
    }
  };

  const loading = isConnecting || isAuthenticating;

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
              {
                icon: '🌌',
                title: 'Owned Universes',
                desc: 'Track all your tokenized story universes',
              },
              {
                icon: '🎬',
                title: 'Collectibles & NFTs',
                desc: 'Episode and character collections in one place',
              },
              {
                icon: '💎',
                title: 'Credits & Earnings',
                desc: 'Monitor credits, royalties, and pending payouts',
              },
              {
                icon: '🔐',
                title: 'Secure & On-Chain',
                desc: 'Non-custodial — your keys, your assets',
              },
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

          <View className="flex-1" />

          {/* Connect buttons */}
          <View className="gap-3">
            {connectedAddress && !isAuthenticated ? (
              <View className="bg-zinc-900 rounded-xl p-3 items-center">
                <Text className="text-text-secondary text-xs">
                  Connected: {connectedAddress.slice(0, 6)}…{connectedAddress.slice(-4)}
                </Text>
                <Text className="text-text-tertiary text-xs mt-1">Waiting for SIWE signature…</Text>
              </View>
            ) : null}

            <Button onPress={() => handleConnect('google')} loading={loading} fullWidth size="lg">
              Continue with Google
            </Button>
            <Button
              onPress={() => handleConnect('apple')}
              loading={loading}
              fullWidth
              size="lg"
              variant="secondary"
            >
              Continue with Apple
            </Button>
            <Button
              onPress={() => handleConnect('passkey')}
              loading={loading}
              fullWidth
              size="lg"
              variant="secondary"
            >
              Continue with Passkey
            </Button>

            <Text className="text-text-tertiary text-xs text-center">
              Secured by thirdweb. Non-custodial — your keys stay in a wallet only you can unlock.
            </Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
