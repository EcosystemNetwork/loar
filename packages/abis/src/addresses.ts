/**
 * Deployed Contract Addresses
 *
 * Auto-generated from Foundry broadcast output. Keyed by chain ID (Sepolia: 11155111).
 * Update by running `forge build && npx wagmi generate` after contract redeployment.
 */

export const UniverseManager = {
  '11155111': '0x7af142BbD14CaEECdA68f948F467Da0257f6B114',
} as const;

export type UniverseManagerChainId = keyof typeof UniverseManager;

export const UniverseTokenDeployer = {
  '11155111': '0xE34DAB193105F3d7ec6EE4E6172cbE6213108d8B',
} as const;

export type UniverseTokenDeployerChainId = keyof typeof UniverseTokenDeployer;

export const LoarFeeLocker = {
  '11155111': '0xEB2B470D2A8dD2192e33e94Db4c7Dd9fb937f38f',
} as const;

export type LoarFeeLockerChainId = keyof typeof LoarFeeLocker;

export const LoarLpLockerMultiple = {
  '11155111': '0x3E66D6feAEeb68b43E76CF4152154B4F30553ca6',
} as const;

export type LoarLpLockerMultipleChainId = keyof typeof LoarLpLockerMultiple;

export const LoarHookStaticFee = {
  '11155111': '0xa66407B5a48C5CbFF4055Ca50f6189575CC2A8cC',
} as const;

export type LoarHookStaticFeeChainId = keyof typeof LoarHookStaticFee;
