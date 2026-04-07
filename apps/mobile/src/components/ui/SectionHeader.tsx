import React from 'react';
import { Pressable, Text, View } from 'react-native';

interface SectionHeaderProps {
  title: string;
  count?: number;
  onSeeAll?: () => void;
}

export function SectionHeader({ title, count, onSeeAll }: SectionHeaderProps) {
  return (
    <View className="flex-row items-center justify-between mb-3">
      <View className="flex-row items-center gap-2">
        <Text className="text-text-primary text-base font-bold">{title}</Text>
        {count !== undefined ? (
          <View className="bg-zinc-800 rounded-full w-5 h-5 items-center justify-center">
            <Text className="text-text-tertiary text-xs">{count}</Text>
          </View>
        ) : null}
      </View>
      {onSeeAll ? (
        <Pressable onPress={onSeeAll}>
          <Text className="text-primary text-sm font-medium">See all</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
