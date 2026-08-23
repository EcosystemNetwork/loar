/**
 * Testnet Contract Addresses — Sepolia Only
 */
import type { SupportedChainId } from './chains';

export const TIMELINE_ADDRESSES: Partial<Record<SupportedChainId, `0x${string}`>> = {
  11155111: '0xeC927f51FE3B4a27784Cb2cAEB60240287385274',
};

export type { SupportedChainId };
