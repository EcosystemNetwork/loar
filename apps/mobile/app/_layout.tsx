/**
 * Root layout — wraps all screens with:
 *  - AppKitProvider (Reown WalletConnect)
 *  - QueryClientProvider (React Query)
 *  - AuthProvider (SIWE session state)
 *  - Expo Router Stack
 */
import { AppKitProvider } from '@reown/appkit-react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import '../src/global.css';
import { AuthProvider } from '../src/contexts/AuthContext';
import { appKitConfig, initAppKit } from '../src/lib/appkit';
import { queryClient } from '../src/lib/trpc';

SplashScreen.preventAutoHideAsync();

// Initialize AppKit once at module load
initAppKit();

export default function RootLayout() {
  useEffect(() => {
    SplashScreen.hideAsync();
  }, []);

  return (
    <GestureHandlerRootView className="flex-1 bg-background">
      <AppKitProvider config={appKitConfig}>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <Stack
              screenOptions={{
                headerStyle: { backgroundColor: '#000000' },
                headerTintColor: '#ffffff',
                headerTitleStyle: { fontWeight: '700', color: '#ffffff' },
                contentStyle: { backgroundColor: '#000000' },
                headerShadowVisible: false,
              }}
            >
              <Stack.Screen name="(auth)/login" options={{ headerShown: false }} />
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen
                name="asset/[id]"
                options={{ title: 'Asset', presentation: 'card' }}
              />
              <Stack.Screen
                name="universe/[id]"
                options={{ title: 'Universe', presentation: 'card' }}
              />
              <Stack.Screen
                name="subscriptions"
                options={{ title: 'Subscriptions', presentation: 'card' }}
              />
              <Stack.Screen
                name="credits"
                options={{ title: 'Credits', presentation: 'card' }}
              />
              <Stack.Screen
                name="drafts"
                options={{ title: 'Drafts', presentation: 'card' }}
              />
              <Stack.Screen
                name="wallet-settings"
                options={{ title: 'Wallet', presentation: 'card' }}
              />
            </Stack>
          </AuthProvider>
        </QueryClientProvider>
      </AppKitProvider>
    </GestureHandlerRootView>
  );
}
