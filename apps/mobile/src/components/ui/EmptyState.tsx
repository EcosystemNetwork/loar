import React from 'react';
import { Text, View } from 'react-native';
import { Button } from './Button';

interface EmptyStateProps {
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  icon?: string;
}

export function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
  icon = '📭',
}: EmptyStateProps) {
  return (
    <View className="flex-1 items-center justify-center gap-4 px-8 py-16">
      <Text className="text-4xl">{icon}</Text>
      <Text className="text-text-primary text-lg font-semibold text-center">{title}</Text>
      {description ? (
        <Text className="text-text-secondary text-sm text-center">{description}</Text>
      ) : null}
      {actionLabel && onAction ? (
        <Button onPress={onAction} variant="secondary" size="sm">
          {actionLabel}
        </Button>
      ) : null}
    </View>
  );
}
