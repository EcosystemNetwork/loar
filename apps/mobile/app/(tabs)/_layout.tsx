/**
 * Bottom tab navigator.
 *
 * Watch is public — anyone can open the app and start watching. The wallet
 * tabs need a session: signed out, they are hidden and `redirect` bounces any
 * deep link to them back to Watch (which shows a "Sign in" pill).
 */
import { Tabs } from 'expo-router';
import React from 'react';
import { Text } from 'react-native';
import { useAuth } from '../../src/contexts/AuthContext';
import { LoadingSpinner } from '../../src/components/ui/LoadingSpinner';

function TabIcon({ emoji, focused }: { emoji: string; focused: boolean }) {
  return <Text style={{ fontSize: 22, opacity: focused ? 1 : 0.5 }}>{emoji}</Text>;
}

export default function TabsLayout() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) return <LoadingSpinner />;
  const walletOnly = !isAuthenticated;

  return (
    <Tabs
      screenOptions={{
        tabBarStyle: {
          backgroundColor: '#000000',
          borderTopColor: '#222222',
          borderTopWidth: 1,
          paddingBottom: 4,
          height: 60,
        },
        tabBarActiveTintColor: '#f2823b',
        tabBarInactiveTintColor: '#6b7280',
        tabBarLabelStyle: { fontSize: 10, fontWeight: '600' },
        headerStyle: { backgroundColor: '#000000' },
        headerTintColor: '#ffffff',
        headerTitleStyle: { fontWeight: '700' },
        headerShadowVisible: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Watch',
          tabBarIcon: ({ focused }) => <TabIcon emoji="▶" focused={focused} />,
          headerShown: false,
        }}
      />
      <Tabs.Screen
        name="portfolio"
        redirect={walletOnly}
        options={{
          title: 'Portfolio',
          tabBarIcon: ({ focused }) => <TabIcon emoji="⬡" focused={focused} />,
          headerTitle: 'Portfolio',
        }}
      />
      <Tabs.Screen
        name="collections"
        redirect={walletOnly}
        options={{
          title: 'Collection',
          tabBarIcon: ({ focused }) => <TabIcon emoji="🖼" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="tokens"
        redirect={walletOnly}
        options={{
          title: 'Tokens',
          tabBarIcon: ({ focused }) => <TabIcon emoji="💎" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="earnings"
        redirect={walletOnly}
        options={{
          title: 'Earnings',
          tabBarIcon: ({ focused }) => <TabIcon emoji="💰" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        redirect={walletOnly}
        options={{
          title: 'Profile',
          tabBarIcon: ({ focused }) => <TabIcon emoji="👤" focused={focused} />,
        }}
      />
    </Tabs>
  );
}
