/**
 * Smart Polling Utilities
 *
 * Prevents the "thundering herd" problem at scale by:
 * 1. Pausing polling when the tab is not visible (Page Visibility API)
 * 2. Adding jitter to intervals so 10K clients don't all hit at the same instant
 * 3. Providing longer intervals for non-critical data
 *
 * Usage:
 *   import { useVisibilityAwareInterval, jitteredInterval } from './useSmartPolling';
 *
 *   // In a useQuery config:
 *   refetchInterval: useVisibilityAwareInterval(10_000)
 *
 *   // Or just add jitter:
 *   refetchInterval: jitteredInterval(10_000)
 */

import { useState, useEffect, useCallback } from 'react';

/**
 * Returns `false` when the tab is hidden, or the jittered interval when visible.
 * Prevents background tabs from polling the server.
 */
export function useVisibilityAwareInterval(baseMs: number): number | false {
  const [visible, setVisible] = useState(!document.hidden);

  useEffect(() => {
    const handler = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, []);

  if (!visible) return false;

  // Add ±15% jitter to prevent thundering herd
  return jitteredInterval(baseMs);
}

/**
 * Add random jitter to a polling interval.
 * Spreads 10K clients over ±15% of the base interval instead of all hitting at once.
 *
 * Example: jitteredInterval(10_000) → returns 8500-11500ms
 */
export function jitteredInterval(baseMs: number): number {
  const jitter = baseMs * 0.15;
  return Math.round(baseMs + (Math.random() * 2 - 1) * jitter);
}

/**
 * Hook version of visibility check for conditional refetching.
 */
export function useIsTabVisible(): boolean {
  const [visible, setVisible] = useState(!document.hidden);

  useEffect(() => {
    const handler = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, []);

  return visible;
}

/**
 * Recommended polling intervals by data criticality.
 * Use these instead of hardcoded numbers across the app.
 */
export const POLL_INTERVALS = {
  /** Real-time financial data (bonding curve price, swap state) */
  REALTIME: 10_000,
  /** Active user data (upload progress, generation status) */
  ACTIVE: 5_000,
  /** Moderate freshness (token balances, credit balance) */
  MODERATE: 30_000,
  /** Background data (notifications, analytics, staking) */
  BACKGROUND: 60_000,
  /** Rarely changing data (admin analytics, model list) */
  SLOW: 120_000,
} as const;
