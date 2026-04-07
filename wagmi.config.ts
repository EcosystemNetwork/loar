// wagmi.config.ts
import { defineConfig } from '@wagmi/cli';
import type { Abi } from 'viem';
import { etherscan, react, foundry } from '@wagmi/cli/plugins';
import { mainnet, sepolia, baseSepolia } from 'wagmi/chains';

import UniverseTokenDeployer from './apps/contracts/out/UniverseTokenDeployer.sol/UniverseTokenDeployer.json';
import UniverseManagerAbi from './apps/contracts/out/UniverseManager.sol/UniverseManager.json';
import LoarLpLockerMultiple from './apps/contracts/out/LoarLpLockerMultiple.sol/LoarLpLockerMultiple.json';
import Universe from './apps/contracts/out/Universe.sol/Universe.json';
import GovernanceERC20 from './apps/contracts/out/GovernanceERC20.sol/GovernanceERC20.json';
import UniverseGovernor from './apps/contracts/out/UniverseGovernor.sol/UniverseGovernor.json';
import LoarFeeLocker from './apps/contracts/out/LoarFeeLocker.sol/LoarFeeLocker.json';
import LoarHookStaticFee from './apps/contracts/out/LoarHookStaticFee.sol/LoarHookStaticFee.json';

// Revenue stream contracts (will be available after `forge build`)
// import EpisodeNFT from './apps/contracts/out/EpisodeNFT.sol/EpisodeNFT.json';
// import CharacterNFT from './apps/contracts/out/CharacterNFT.sol/CharacterNFT.json';
// import CanonMarketplace from './apps/contracts/out/CanonMarketplace.sol/CanonMarketplace.json';
// import CreditManager from './apps/contracts/out/CreditManager.sol/CreditManager.json';
// import SubscriptionManager from './apps/contracts/out/SubscriptionManager.sol/SubscriptionManager.json';
// import CollabManager from './apps/contracts/out/CollabManager.sol/CollabManager.json';
// import AdPlacement from './apps/contracts/out/AdPlacement.sol/AdPlacement.json';
// import LicensingRegistry from './apps/contracts/out/LicensingRegistry.sol/LicensingRegistry.json';
// import AnalyticsRegistry from './apps/contracts/out/AnalyticsRegistry.sol/AnalyticsRegistry.json';

export default defineConfig({
  out: 'packages/abis/src/generated.ts',
  contracts: [
    {
      name: 'UniverseTokenDeployer',
      abi: UniverseTokenDeployer.abi as Abi,
    },
    {
      name: 'UniverseManager',
      abi: UniverseManagerAbi.abi as Abi,
    },
    {
      name: 'LoarLpLockerMultiple',
      abi: LoarLpLockerMultiple.abi as Abi,
    },
    {
      name: 'Universe',
      abi: Universe.abi as Abi,
    },
    {
      name: 'GovernanceERC20',
      abi: GovernanceERC20.abi as Abi,
    },
    {
      name: 'UniverseGovernor',
      abi: UniverseGovernor.abi as Abi,
    },
    {
      name: 'LoarFeeLocker',
      abi: LoarFeeLocker.abi as Abi,
    },
    {
      name: 'LoarHookStaticFee',
      abi: LoarHookStaticFee.abi as Abi,
    },
    // Revenue stream contracts — uncomment after `forge build`
    // { name: 'EpisodeNFT', abi: EpisodeNFT.abi as Abi },
    // { name: 'CharacterNFT', abi: CharacterNFT.abi as Abi },
    // { name: 'CanonMarketplace', abi: CanonMarketplace.abi as Abi },
    // { name: 'CreditManager', abi: CreditManager.abi as Abi },
    // { name: 'SubscriptionManager', abi: SubscriptionManager.abi as Abi },
    // { name: 'CollabManager', abi: CollabManager.abi as Abi },
    // { name: 'AdPlacement', abi: AdPlacement.abi as Abi },
    // { name: 'LicensingRegistry', abi: LicensingRegistry.abi as Abi },
    // { name: 'AnalyticsRegistry', abi: AnalyticsRegistry.abi as Abi },
  ],
  plugins: [
    react({
      getHookName({ contractName, itemName, type }) {
        return `use${contractName}_${itemName}_${type}`;
      },
    }),
  ],
});
