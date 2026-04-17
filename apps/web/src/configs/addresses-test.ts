/**
 * Testnet Contract Addresses — Sepolia Only
 */
import type { SupportedChainId } from './chains';

export const TIMELINE_ADDRESSES: Partial<Record<SupportedChainId, `0x${string}`>> = {
  11155111: '0xeC927f51FE3B4a27784Cb2cAEB60240287385274',
};

export const UNIVERSEGOVERNANCE_ADDRESSES: Partial<Record<SupportedChainId, `0x${string}`>> = {
  11155111: '0xa7005d4c28328facf8a064d34d5f236a464e55c1',
};

export const ERC20GOVERNANCE_ADDRESSES: Partial<Record<SupportedChainId, `0x${string}`>> = {
  11155111: '0x2b84355ced33f0877a339bf0bbafac1bc4c3e8d5',
};

export type { SupportedChainId };
