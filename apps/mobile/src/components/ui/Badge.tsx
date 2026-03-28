import React from 'react';
import { Text, View } from 'react-native';

type BadgeVariant = 'default' | 'primary' | 'success' | 'warning' | 'error' | 'muted';

const styles: Record<BadgeVariant, { container: string; text: string }> = {
  default: { container: 'bg-zinc-800', text: 'text-text-secondary' },
  primary: { container: 'bg-purple-900/50', text: 'text-primary-light' },
  success: { container: 'bg-emerald-900/50', text: 'text-emerald-400' },
  warning: { container: 'bg-amber-900/50', text: 'text-amber-400' },
  error: { container: 'bg-red-900/50', text: 'text-red-400' },
  muted: { container: 'bg-zinc-900', text: 'text-muted' },
};

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
}

export function Badge({ children, variant = 'default' }: BadgeProps) {
  const s = styles[variant];
  return (
    <View className={`rounded-full px-2 py-0.5 ${s.container}`}>
      <Text className={`text-xs font-medium ${s.text}`}>{children}</Text>
    </View>
  );
}
