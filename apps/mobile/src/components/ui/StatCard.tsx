import React from 'react';
import { Text, View } from 'react-native';

interface StatCardProps {
  label: string;
  value: string | number;
  subtitle?: string;
  accent?: string;
}

export function StatCard({ label, value, subtitle, accent = 'text-text-primary' }: StatCardProps) {
  return (
    <View className="bg-card rounded-2xl border border-border p-4 flex-1">
      <Text className="text-text-tertiary text-xs font-medium mb-1">{label}</Text>
      <Text className={`text-2xl font-bold ${accent}`}>{value}</Text>
      {subtitle ? <Text className="text-text-tertiary text-xs mt-1">{subtitle}</Text> : null}
    </View>
  );
}
