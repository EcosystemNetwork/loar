// wagmi.config.ts
import { defineConfig } from '@wagmi/cli';
import type { Abi } from 'viem';
import { etherscan, react, foundry } from '@wagmi/cli/plugins';
import { mainnet, sepolia, baseSepolia } from 'wagmi/chains';

import UniverseTokenDeployer from './apps/contracts/out/UniverseTokenDeployerV3.sol/UniverseTokenDeployerV3.json';
import UniverseManagerAbi from './apps/contracts/out/UniverseManager.sol/UniverseManager.json';
import LoarLpLockerMultiple from './apps/contracts/out/LoarLpLockerMultiple.sol/LoarLpLockerMultiple.json';
import Universe from './apps/contracts/out/Universe.sol/Universe.json';
import GovernanceERC20 from './apps/contracts/out/GovernanceTokenFactory.sol/GovernanceERC20.json';
import UniverseGovernor from './apps/contracts/out/UniverseGovernor.sol/UniverseGovernor.json';
import LoarFeeLocker from './apps/contracts/out/LoarFeeLocker.sol/LoarFeeLocker.json';
import LoarHookStaticFee from './apps/contracts/out/LoarHookStaticFee.sol/LoarHookStaticFee.json';

// Revenue stream contracts
import PaymentRouter from './apps/contracts/out/PaymentRouter.sol/PaymentRouter.json';
import SplitRouter from './apps/contracts/out/SplitRouter.sol/SplitRouter.json';
import RightsRegistry from './apps/contracts/out/RightsRegistry.sol/RightsRegistry.json';
import EpisodeNFT from './apps/contracts/out/EpisodeNFT.sol/EpisodeNFT.json';
import EpisodeEditionCollection from './apps/contracts/out/EpisodeEditionCollection.sol/EpisodeEditionCollection.json';
import CharacterNFT from './apps/contracts/out/CharacterNFT.sol/CharacterNFT.json';
import EntityNFT from './apps/contracts/out/EntityNFT.sol/EntityNFT.json';
import EntityEditionNFT from './apps/contracts/out/EntityEditionNFT.sol/EntityEditionNFT.json';
import CreditManager from './apps/contracts/out/CreditManager.sol/CreditManager.json';
import PremiumActions from './apps/contracts/out/PremiumActions.sol/PremiumActions.json';
import StoryBounties from './apps/contracts/out/StoryBounties.sol/StoryBounties.json';
import TalentAgentRegistry from './apps/contracts/out/TalentAgentRegistry.sol/TalentAgentRegistry.json';
import AdSeedEscrow from './apps/contracts/out/AdSeedEscrow.sol/AdSeedEscrow.json';
import LaunchpadStaking from './apps/contracts/out/LaunchpadStaking.sol/LaunchpadStaking.json';
import RemixFees from './apps/contracts/out/RemixFees.sol/RemixFees.json';
import SlopMarket from './apps/contracts/out/SlopMarket.sol/SlopMarket.json';
import SubscriptionManager from './apps/contracts/out/SubscriptionManager.sol/SubscriptionManager.json';
import LicensingRegistry from './apps/contracts/out/LicensingRegistry.sol/LicensingRegistry.json';
import AdPlacement from './apps/contracts/out/AdPlacement.sol/AdPlacement.json';
import CollabManager from './apps/contracts/out/CollabManager.sol/CollabManager.json';
import CanonMarketplace from './apps/contracts/out/CanonMarketplace.sol/CanonMarketplace.json';
import ContentLicensing from './apps/contracts/out/ContentLicensing.sol/ContentLicensing.json';
import LoarToken from './apps/contracts/out/LoarToken.sol/LoarToken.json';
import LoarFaucet from './apps/contracts/out/LoarFaucet.sol/LoarFaucet.json';
import IdentityNFT from './apps/contracts/out/IdentityNFT.sol/IdentityNFT.json';
// Timelock governor (mainnet-ready replacement for UniverseGovernor)
// import UniverseTimelockGovernor from './apps/contracts/out/UniverseTimelockGovernor.sol/UniverseTimelockGovernor.json';

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
    { name: 'SplitRouter', abi: SplitRouter.abi as Abi },
    { name: 'RightsRegistry', abi: RightsRegistry.abi as Abi },
    { name: 'EpisodeNFT', abi: EpisodeNFT.abi as Abi },
    { name: 'EpisodeEditionCollection', abi: EpisodeEditionCollection.abi as Abi },
    { name: 'CharacterNFT', abi: CharacterNFT.abi as Abi },
    { name: 'EntityNFT', abi: EntityNFT.abi as Abi },
    { name: 'EntityEditionNFT', abi: EntityEditionNFT.abi as Abi },
    { name: 'CreditManager', abi: CreditManager.abi as Abi },
    { name: 'PremiumActions', abi: PremiumActions.abi as Abi },
    { name: 'StoryBounties', abi: StoryBounties.abi as Abi },
    { name: 'TalentAgentRegistry', abi: TalentAgentRegistry.abi as Abi },
    { name: 'AdSeedEscrow', abi: AdSeedEscrow.abi as Abi },
    { name: 'LaunchpadStaking', abi: LaunchpadStaking.abi as Abi },
    { name: 'RemixFees', abi: RemixFees.abi as Abi },
    { name: 'SlopMarket', abi: SlopMarket.abi as Abi },
    { name: 'SubscriptionManager', abi: SubscriptionManager.abi as Abi },
    { name: 'LicensingRegistry', abi: LicensingRegistry.abi as Abi },
    { name: 'AdPlacement', abi: AdPlacement.abi as Abi },
    { name: 'CollabManager', abi: CollabManager.abi as Abi },
    { name: 'CanonMarketplace', abi: CanonMarketplace.abi as Abi },
    { name: 'ContentLicensing', abi: ContentLicensing.abi as Abi },
    { name: 'LoarToken', abi: LoarToken.abi as Abi },
    { name: 'LoarFaucet', abi: LoarFaucet.abi as Abi },
    { name: 'IdentityNFT', abi: IdentityNFT.abi as Abi },
  ],
  plugins: [
    react({
      getHookName({ contractName, itemName, type }) {
        return `use${contractName}_${itemName}_${type}`;
      },
    }),
  ],
});
