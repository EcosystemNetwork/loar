/**
 * Contract Address Registry — Sepolia Only
 *
 * Multi-chain addresses (Base, Solana, SUI) preserved on feature/multi-chain branch.
 */

import type { SupportedEvmChainId } from './chains';

export interface EvmAddresses {
  universeManager: `0x${string}`;
  loarToken: `0x${string}`;
  paymentRouter: `0x${string}`;
  creditManager: `0x${string}`;
  rightsRegistry: `0x${string}`;
  revenueModuleFactory: `0x${string}`;
  loarHook: `0x${string}`;
  lpLocker: `0x${string}`;
  feeLocker: `0x${string}`;
}

const ZERO_ADDR = '0x0000000000000000000000000000000000000000' as `0x${string}`;

export const EVM_ADDRESSES: Record<SupportedEvmChainId, EvmAddresses> = {
  11155111: {
    universeManager: '0x7af142BbD14CaEECdA68f948F467Da0257f6B114',
    loarToken: ZERO_ADDR,
    paymentRouter: ZERO_ADDR,
    creditManager: ZERO_ADDR,
    rightsRegistry: ZERO_ADDR,
    revenueModuleFactory: ZERO_ADDR,
    loarHook: '0xa66407B5a48C5CbFF4055Ca50f6189575CC2A8cC',
    lpLocker: '0x3E66D6feAEeb68b43E76CF4152154B4F30553ca6',
    feeLocker: '0xEB2B470D2A8dD2192e33e94Db4c7Dd9fb937f38f',
  },
};

export function getEvmAddresses(chainId: number): EvmAddresses | null {
  return EVM_ADDRESSES[chainId as SupportedEvmChainId] ?? null;
}
