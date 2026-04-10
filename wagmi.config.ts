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

// Revenue stream contracts
import PaymentRouter from './apps/contracts/out/PaymentRouter.sol/PaymentRouter.json';
import EpisodeNFT from './apps/contracts/out/EpisodeNFT.sol/EpisodeNFT.json';
import CharacterNFT from './apps/contracts/out/CharacterNFT.sol/CharacterNFT.json';
import CreditManager from './apps/contracts/out/CreditManager.sol/CreditManager.json';
import LoarBurner from './apps/contracts/out/LoarBurner.sol/LoarBurner.json';
import StoryBounties from './apps/contracts/out/StoryBounties.sol/StoryBounties.json';
import LaunchpadStaking from './apps/contracts/out/LaunchpadStaking.sol/LaunchpadStaking.json';
import RemixFees from './apps/contracts/out/RemixFees.sol/RemixFees.json';
import SlopMarket from './apps/contracts/out/SlopMarket.sol/SlopMarket.json';
import SubscriptionManager from './apps/contracts/out/SubscriptionManager.sol/SubscriptionManager.json';
import LoarToken from './apps/contracts/out/LoarToken.sol/LoarToken.json';

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
    // Revenue + Token Economy contracts
    { name: 'PaymentRouter', abi: PaymentRouter.abi as Abi },
    { name: 'EpisodeNFT', abi: EpisodeNFT.abi as Abi },
    { name: 'CharacterNFT', abi: CharacterNFT.abi as Abi },
    { name: 'CreditManager', abi: CreditManager.abi as Abi },
    { name: 'LoarBurner', abi: LoarBurner.abi as Abi },
    { name: 'StoryBounties', abi: StoryBounties.abi as Abi },
    { name: 'LaunchpadStaking', abi: LaunchpadStaking.abi as Abi },
    { name: 'RemixFees', abi: RemixFees.abi as Abi },
    { name: 'SlopMarket', abi: SlopMarket.abi as Abi },
    { name: 'SubscriptionManager', abi: SubscriptionManager.abi as Abi },
    { name: 'LoarToken', abi: LoarToken.abi as Abi },
  ],
  plugins: [
    react({
      getHookName({ contractName, itemName, type }) {
        return `use${contractName}_${itemName}_${type}`;
      },
    }),
  ],
});
