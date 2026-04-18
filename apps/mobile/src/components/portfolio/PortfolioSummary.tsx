import React from 'react';
import { View } from 'react-native';
import type { PortfolioSummary as Summary } from '../../types';
import { StatCard } from '../ui/StatCard';

interface PortfolioSummaryProps {
  summary: Summary;
}

export function PortfolioSummaryRow({ summary }: PortfolioSummaryProps) {
  return (
    <View className="gap-3">
      <View className="flex-row gap-3">
        <StatCard
          label="Credits"
          value={summary.creditsBalance.toLocaleString()}
          accent="text-primary-light"
        />
        <StatCard label="Collectibles" value={summary.totalCollectibles} accent="text-accent" />
      </View>
      <View className="flex-row gap-3">
        <StatCard
          label="Subscriptions"
          value={summary.activeSubscriptions}
          subtitle="active"
          accent="text-success"
        />
        <StatCard
          label="Pending Earnings"
          value={`$${summary.pendingEarnings.toFixed(2)}`}
          accent="text-warning"
        />
      </View>
    </View>
  );
}
