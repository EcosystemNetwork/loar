// Auto-generated from deployment manifests — do not edit directly.
// To update: pnpm sync:addresses

export const UniverseManager = {
  '11155111': '0x66F289658Ce5fD0Bb1022251eA4604F6b0C4d7Ce',
  '84532': '0xecfce8431CD0E1830D4252F1970345c2BA3a2E6e',
} as const;

export type UniverseManagerChainId = keyof typeof UniverseManager;

export const UniverseTokenDeployer = {
  '11155111': '0x3341674801438162e2EFFFcF3Fa68664763641c8', // V2 with vesting
  '84532': '0xBbF0A2311bee8347479eAee07c64cB237E8AE429',
} as const;

export type UniverseTokenDeployerChainId = keyof typeof UniverseTokenDeployer;

export const LoarFeeLocker = {
  '11155111': '0x1E10b62bd2817d0C2414909027E1E63653fcCd8e',
  '84532': '0xf076bc9dFFe89c7B345b0E9Ad120BCF7696d3e91',
} as const;

export type LoarFeeLockerChainId = keyof typeof LoarFeeLocker;

export const LoarLpLockerMultiple = {
  '11155111': '0xc00225D9463C15280748dC2E21D8D8625982Ad54',
  '84532': '0x6FB4b73B1e980217010d20B7DA065b06EA7802B6',
} as const;

export type LoarLpLockerMultipleChainId = keyof typeof LoarLpLockerMultiple;

export const LoarHookStaticFee = {
  '11155111': '0x9A53B31b8B4F76Bb617D6B9aAd62731f8033A8Cc',
  '84532': '0xAC0C66fc1A9daE256ba91797D5B3E4fe4938a8Cc',
} as const;

export type LoarHookStaticFeeChainId = keyof typeof LoarHookStaticFee;

export const LoarSwapRouter = {
  '11155111': '0x7E156f3Ddd56539aB941DeEfEd1342ae5C9C09a5',
  '84532': '0x69c2aA66B3bB3e5f6658Dc2a77022558e7022398',
} as const;

export type LoarSwapRouterChainId = keyof typeof LoarSwapRouter;

export const TokenVesting = {
  '11155111': '0x5d74D9e42a52D04DEC9F895F2c9D2e14b1DdCD64',
  '84532': '0x36E25222f7E5C6f4dC8f918B68C61da83330C97F',
} as const;

export type TokenVestingChainId = keyof typeof TokenVesting;
