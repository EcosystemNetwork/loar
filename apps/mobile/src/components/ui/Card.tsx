import React from 'react';
import { Pressable, View, type ViewProps } from 'react-native';

interface CardProps extends ViewProps {
  children: React.ReactNode;
  onPress?: () => void;
  className?: string;
}

export function Card({ children, onPress, className = '', ...props }: CardProps) {
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        className={`bg-card rounded-2xl border border-border p-4 active:opacity-80 ${className}`}
        {...(props as object)}
      >
        {children}
      </Pressable>
    );
  }

  return (
    <View className={`bg-card rounded-2xl border border-border p-4 ${className}`} {...props}>
      {children}
    </View>
  );
}
