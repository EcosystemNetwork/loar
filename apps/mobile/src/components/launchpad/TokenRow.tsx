import React from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import type { LaunchpadRow } from '@loar/shared/trpc';
import {
  formatCompactEth,
  formatPrice,
  STAGE_LABEL,
  STAGE_VARIANT,
} from '../../lib/launchpad-format';
import { Badge } from '../ui/Badge';

export type LaunchpadToken = LaunchpadRow;

export function TokenAvatar({ token, size = 40 }: { token: LaunchpadToken; size?: number }) {
  const style = { width: size, height: size, borderRadius: size / 4 };
  return token.imageUrl ? (
    <Image source={{ uri: token.imageUrl }} style={style} />
  ) : (
    <View style={style} className="bg-purple-900/40 items-center justify-center">
      <Text className="text-primary-light text-xs font-bold">{token.symbol.slice(0, 3)}</Text>
    </View>
  );
}

export function TokenRow({ token, onPress }: { token: LaunchpadToken; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${token.name}, ${STAGE_LABEL[token.stage]}`}
      className="flex-row items-center gap-3 py-3 border-b border-border active:opacity-70"
    >
      <TokenAvatar token={token} />
      <View className="flex-1">
        <View className="flex-row items-center gap-2">
          <Text className="text-text-primary font-semibold" numberOfLines={1}>
            ${token.symbol}
          </Text>
          <Badge variant={STAGE_VARIANT[token.stage]}>{STAGE_LABEL[token.stage]}</Badge>
        </View>
        <Text className="text-text-tertiary text-xs" numberOfLines={1}>
          {token.name} · {token.holderCount} holders
        </Text>
      </View>
      <View className="items-end">
        <Text className="text-text-primary text-sm font-mono">
          {formatCompactEth(token.marketCap)}
        </Text>
        <Text className="text-text-tertiary text-xs font-mono">{formatPrice(token.price)}</Text>
      </View>
    </Pressable>
  );
}

export function KingOfTheHillCard({
  token,
  onPress,
}: {
  token: LaunchpadToken;
  onPress: () => void;
}) {
  const pct = Math.max(0, Math.min(100, token.graduationPct));
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`King of the Hill: ${token.name}`}
      className="rounded-2xl border border-amber-500/40 bg-amber-950/20 p-4 flex-row items-center gap-3 active:opacity-80"
    >
      <TokenAvatar token={token} size={52} />
      <View className="flex-1 gap-1">
        <Text className="text-amber-400 text-[10px] font-bold uppercase tracking-wider">
          👑 King of the Hill
        </Text>
        <Text className="text-text-primary font-semibold" numberOfLines={1}>
          {token.name} <Text className="text-text-tertiary font-normal">${token.symbol}</Text>
        </Text>
        <View className="flex-row items-center gap-2">
          <View className="flex-1 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
            <View className="h-full rounded-full bg-amber-500" style={{ width: `${pct}%` }} />
          </View>
          <Text className="text-text-tertiary text-[10px]">{pct.toFixed(0)}% to Uniswap</Text>
        </View>
      </View>
    </Pressable>
  );
}
