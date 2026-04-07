import React from 'react';
import { Pressable, Text, View } from 'react-native';

interface AssetRowProps {
  icon: string;
  label: string;
  value?: string | number;
  subtitle?: string;
  onPress?: () => void;
  badge?: React.ReactNode;
}

export function AssetRow({ icon, label, value, subtitle, onPress, badge }: AssetRowProps) {
  const Container = onPress ? Pressable : View;

  return (
    <Container
      onPress={onPress}
      className="flex-row items-center gap-3 py-3 border-b border-border active:opacity-70"
    >
      <View className="w-10 h-10 rounded-xl bg-zinc-900 items-center justify-center">
        <Text className="text-xl">{icon}</Text>
      </View>
      <View className="flex-1">
        <Text className="text-text-primary font-medium text-sm">{label}</Text>
        {subtitle ? <Text className="text-text-tertiary text-xs mt-0.5">{subtitle}</Text> : null}
      </View>
      {value !== undefined ? (
        <Text className="text-text-secondary font-semibold text-sm">{value}</Text>
      ) : null}
      {badge ?? null}
      {onPress ? (
        <Text className="text-text-tertiary text-base">›</Text>
      ) : null}
    </Container>
  );
}
