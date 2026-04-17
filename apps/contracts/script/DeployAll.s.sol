// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/proxy/ERC1967/ERC1967Proxy.sol";
import {UpgradeableBeacon} from "@openzeppelin/proxy/beacon/UpgradeableBeacon.sol";

// Core
import {LoarToken} from "../src/LoarToken.sol";
import {LoarFaucet} from "../src/LoarFaucet.sol";
import {UniverseManager} from "../src/UniverseManager.sol";
import {UniverseTokenDeployer} from "../src/UniverseTokenDeployer.sol";
import {UniverseFactory} from "../src/factories/UniverseFactory.sol";
import {UniverseMetadataRenderer} from "../src/UniverseMetadataRenderer.sol";
import {LoarFeeLocker} from "../src/LoarFeeLocker.sol";

// Revenue infrastructure
import {PaymentRouter} from "../src/PaymentRouter.sol";
import {RightsRegistry} from "../src/RightsRegistry.sol";
import {SplitRouter} from "../src/SplitRouter.sol";
import {RevenueModuleFactory} from "../src/RevenueModuleFactory.sol";
import {CanonMarketplace} from "../src/revenue/CanonMarketplace.sol";
import {CreditManager} from "../src/revenue/CreditManager.sol";
import {AdPlacement} from "../src/revenue/AdPlacement.sol";
import {SubscriptionManager} from "../src/revenue/SubscriptionManager.sol";
import {LicensingRegistry} from "../src/revenue/LicensingRegistry.sol";
import {CollabManager} from "../src/revenue/CollabManager.sol";
import {AnalyticsRegistry} from "../src/revenue/AnalyticsRegistry.sol";
import {LaunchpadStaking} from "../src/revenue/LaunchpadStaking.sol";
import {StoryBounties} from "../src/revenue/StoryBounties.sol";
import {IdentityNFT} from "../src/IdentityNFT.sol";
import {Escrow} from "../src/revenue/Escrow.sol";

// NFT beacons
import {EpisodeEditionCollection} from "../src/revenue/EpisodeEditionCollection.sol";
import {CharacterNFT} from "../src/revenue/CharacterNFT.sol";
import {EntityNFT} from "../src/revenue/EntityNFT.sol";
import {EntityEditionNFT} from "../src/revenue/EntityEditionNFT.sol";
import {EpisodeNFT} from "../src/revenue/EpisodeNFT.sol";

/**
 * @title DeployAll
 * @notice Full-stack deployment of the LOAR protocol.
 *         Deploys everything needed to fill every server env variable.
 *
 * Phases:
 *   1. $LOAR Token + Faucet
 *   2. Core protocol (UniverseManager, TokenDeployer, FeeLocker)
 *   3. Revenue infra (PaymentRouter, RightsRegistry, NFT beacons, Factory)
 *   4. Marketplace contracts (Canon, Credit, Ads, Subs, Licensing, Collabs, Analytics)
 *   5. Staking + SplitRouter + StoryBounties
 *
 * Run:
 *   forge script script/DeployAll.s.sol \
 *     --rpc-url sepolia --broadcast --verify \
 *     -vvv
 *
 * Output: All contract addresses printed — copy into .env
 */
contract DeployAllScript is Script {
    uint16 constant PLATFORM_FEE_BPS = 500;   // 5%
    uint16 constant CANON_FEE_BPS = 300;       // 3%
    uint16 constant LOAR_DISCOUNT_BPS = 500;   // 5% discount for $LOAR payments
    uint256 constant CANON_MIN_FEE = 0.001 ether;
    uint256 constant CANON_VOTE_DURATION = 7 days;
    uint256 constant BOUNTY_MIN = 10e18;       // 10 $LOAR minimum bounty
    uint16 constant BOUNTY_FEE = 500;          // 5%
    uint16 constant BOUNTY_CANCEL_FEE = 200;   // 2%

    function run() public {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address d = vm.addr(pk);
        address treasury = vm.envOr("TREASURY", d);
        address wethAddr = vm.envAddress("WETH");

        console.log("=== LOAR Full Deploy ===");
        console.log("Deployer:", d);
        console.log("Treasury:", treasury);
        console.log("WETH:", wethAddr);

        vm.startBroadcast(pk);

        // ── Phase 1: $LOAR Token ────────────────────────────────────
        LoarToken loarToken = new LoarToken(treasury, d);
        console.log("[1] LoarToken:", address(loarToken));

        LoarFaucet faucet = new LoarFaucet(address(loarToken));
        console.log("[1] LoarFaucet:", address(faucet));

        // Seed faucet with tokens for testnet
        uint256 faucetSeed = 1_000_000e18; // 1M $LOAR
        if (loarToken.balanceOf(d) >= faucetSeed) {
            loarToken.transfer(address(faucet), faucetSeed);
            console.log("[1] Faucet seeded with 1M LOAR");
        }

        // ── Phase 2: Core Protocol ──────────────────────────────────
        UniverseFactory uf = new UniverseFactory();
        console.log("[2] UniverseFactory:", address(uf));

        UniverseMetadataRenderer umr = new UniverseMetadataRenderer();
        console.log("[2] MetadataRenderer:", address(umr));

        UniverseManager um = new UniverseManager(treasury, wethAddr);
        console.log("[2] UniverseManager:", address(um));

        um.setUniverseFactory(address(uf));
        um.setMetadataRenderer(address(umr));
        console.log("[2] Factory + Renderer wired");

        UniverseTokenDeployer utd = new UniverseTokenDeployer(address(um));
        console.log("[2] UniverseTokenDeployer:", address(utd));

        LoarFeeLocker feeLocker = new LoarFeeLocker(d);
        console.log("[2] LoarFeeLocker:", address(feeLocker));

        // Wire up: set token deployer on UniverseManager
        um.setTokenDeployer(address(utd));
        console.log("[2] TokenDeployer set on UniverseManager");

        // Identity NFT for co-creators / multi-sig signers
        IdentityNFT identityNft = new IdentityNFT(address(um));
        um.setIdentityNft(address(identityNft));
        console.log("[2] IdentityNFT:", address(identityNft));

        // ── Phase 3: Revenue Infrastructure ─────────────────────────
        // PaymentRouter (UUPS proxy)
        PaymentRouter paymentRouter = PaymentRouter(
            address(
                new ERC1967Proxy(
                    address(new PaymentRouter()),
                    abi.encodeCall(PaymentRouter.initialize, (treasury, PLATFORM_FEE_BPS, address(loarToken), LOAR_DISCOUNT_BPS))
                )
            )
        );
        console.log("[3] PaymentRouter:", address(paymentRouter));

        // RightsRegistry (UUPS proxy)
        RightsRegistry rightsRegistry = RightsRegistry(
            address(
                new ERC1967Proxy(
                    address(new RightsRegistry()),
                    abi.encodeCall(RightsRegistry.initialize, (d))
                )
            )
        );
        console.log("[3] RightsRegistry:", address(rightsRegistry));

        // NFT Beacons
        UpgradeableBeacon epBeacon = new UpgradeableBeacon(address(new EpisodeEditionCollection()), d);
        UpgradeableBeacon chBeacon = new UpgradeableBeacon(address(new CharacterNFT()), d);
        UpgradeableBeacon enBeacon = new UpgradeableBeacon(address(new EntityNFT()), d);
        UpgradeableBeacon eeBeacon = new UpgradeableBeacon(address(new EntityEditionNFT()), d);
        UpgradeableBeacon epNftBeacon = new UpgradeableBeacon(address(new EpisodeNFT()), d);
        console.log("[3] NFT Beacons deployed");

        // RevenueModuleFactory
        RevenueModuleFactory rmf = new RevenueModuleFactory(
            d, address(rightsRegistry), address(paymentRouter),
            PLATFORM_FEE_BPS, PLATFORM_FEE_BPS, 300, PLATFORM_FEE_BPS, PLATFORM_FEE_BPS,
            address(epBeacon), address(chBeacon), address(enBeacon), address(eeBeacon), address(epNftBeacon)
        );
        console.log("[3] RevenueModuleFactory:", address(rmf));

        // SplitRouter (non-upgradeable)
        SplitRouter splitRouter = new SplitRouter(address(paymentRouter));
        console.log("[3] SplitRouter:", address(splitRouter));

        // ── Phase 4: Marketplace Contracts ──────────────────────────
        // CanonMarketplace
        CanonMarketplace canon = CanonMarketplace(
            address(
                new ERC1967Proxy(
                    address(new CanonMarketplace()),
                    abi.encodeCall(CanonMarketplace.initialize, (
                        d, address(rightsRegistry), address(paymentRouter),
                        PLATFORM_FEE_BPS, CANON_FEE_BPS, CANON_MIN_FEE, CANON_VOTE_DURATION
                    ))
                )
            )
        );
        console.log("[4] CanonMarketplace:", address(canon));

        // CreditManager
        CreditManager creditManager = CreditManager(
            address(
                new ERC1967Proxy(
                    address(new CreditManager()),
                    abi.encodeCall(CreditManager.initialize, (address(loarToken), d, treasury, address(paymentRouter)))
                )
            )
        );
        console.log("[4] CreditManager:", address(creditManager));

        // AdPlacement
        AdPlacement adPlacement = AdPlacement(
            address(
                new ERC1967Proxy(
                    address(new AdPlacement()),
                    abi.encodeCall(AdPlacement.initialize, (d, address(paymentRouter), PLATFORM_FEE_BPS))
                )
            )
        );
        console.log("[4] AdPlacement:", address(adPlacement));

        // SubscriptionManager
        SubscriptionManager subManager = SubscriptionManager(
            address(
                new ERC1967Proxy(
                    address(new SubscriptionManager()),
                    abi.encodeCall(SubscriptionManager.initialize, (d, address(paymentRouter), PLATFORM_FEE_BPS))
                )
            )
        );
        console.log("[4] SubscriptionManager:", address(subManager));

        // LicensingRegistry
        LicensingRegistry licensingRegistry = LicensingRegistry(
            address(
                new ERC1967Proxy(
                    address(new LicensingRegistry()),
                    abi.encodeCall(LicensingRegistry.initialize, (d, address(paymentRouter), PLATFORM_FEE_BPS))
                )
            )
        );
        console.log("[4] LicensingRegistry:", address(licensingRegistry));

        // CollabManager
        CollabManager collabManager = CollabManager(
            address(
                new ERC1967Proxy(
                    address(new CollabManager()),
                    abi.encodeCall(CollabManager.initialize, (d, address(paymentRouter), address(um), PLATFORM_FEE_BPS))
                )
            )
        );
        console.log("[4] CollabManager:", address(collabManager));

        // AnalyticsRegistry
        AnalyticsRegistry analytics = AnalyticsRegistry(
            address(
                new ERC1967Proxy(
                    address(new AnalyticsRegistry()),
                    abi.encodeCall(AnalyticsRegistry.initialize, (d))
                )
            )
        );
        console.log("[4] AnalyticsRegistry:", address(analytics));

        // ── Phase 5: Staking + Bounties ─────────────────────────────
        // LaunchpadStaking (UUPS proxy)
        LaunchpadStaking staking = LaunchpadStaking(
            address(
                new ERC1967Proxy(
                    address(new LaunchpadStaking()),
                    abi.encodeCall(LaunchpadStaking.initialize, (address(loarToken), treasury, treasury))
                )
            )
        );
        console.log("[5] LaunchpadStaking:", address(staking));

        // Configure staking tiers
        staking.setTierConfig(LaunchpadStaking.Tier(1), 1_000e18,    100, 100,  100, false); // BRONZE
        staking.setTierConfig(LaunchpadStaking.Tier(2), 10_000e18,   200, 250,  150, true);  // SILVER
        staking.setTierConfig(LaunchpadStaking.Tier(3), 100_000e18,  400, 500,  200, true);  // GOLD
        staking.setTierConfig(LaunchpadStaking.Tier(4), 500_000e18,  800, 1000, 300, true);  // DIAMOND
        console.log("[5] Staking tiers configured");

        // StoryBounties (UUPS proxy)
        StoryBounties bounties = StoryBounties(
            address(
                new ERC1967Proxy(
                    address(new StoryBounties()),
                    abi.encodeCall(StoryBounties.initialize, (address(loarToken), treasury, d))
                )
            )
        );
        console.log("[5] StoryBounties:", address(bounties));

        // ── Phase 6: Marketplace Escrow ─────────────────────────────────
        Escrow escrow = Escrow(
            address(
                new ERC1967Proxy(
                    address(new Escrow()),
                    abi.encodeCall(Escrow.initialize, (treasury, address(paymentRouter), PLATFORM_FEE_BPS, 7 days))
                )
            )
        );
        console.log("[6] Escrow:", address(escrow));

        vm.stopBroadcast();

        // ── Output: All env vars ────────────────────────────────────
        console.log("\n");
        console.log("========================================");
        console.log("  COPY THESE INTO YOUR .env FILE");
        console.log("========================================");
        console.log("");
        console.log("# --- Core ---");
        _logEnv("LOAR_TOKEN_ADDRESS", address(loarToken));
        _logEnv("LOAR_FAUCET_ADDRESS", address(faucet));
        _logEnv("TREASURY_ADDRESS", treasury);
        _logEnv("UNIVERSE_MANAGER", address(um));
        _logEnv("UNIVERSE_TOKEN_DEPLOYER", address(utd));
        _logEnv("FEE_LOCKER_ADDRESS", address(feeLocker));
        _logEnv("IDENTITY_NFT_ADDRESS", address(identityNft));
        console.log("");
        console.log("# --- Revenue ---");
        _logEnv("PAYMENT_ROUTER_ADDRESS", address(paymentRouter));
        _logEnv("RIGHTS_REGISTRY_ADDRESS", address(rightsRegistry));
        _logEnv("SPLIT_ROUTER_ADDRESS", address(splitRouter));
        _logEnv("REVENUE_MODULE_FACTORY", address(rmf));
        _logEnv("CANON_MARKETPLACE_ADDRESS", address(canon));
        _logEnv("CREDIT_MANAGER_ADDRESS", address(creditManager));
        _logEnv("AD_PLACEMENT_ADDRESS", address(adPlacement));
        _logEnv("SUBSCRIPTION_MANAGER_ADDRESS", address(subManager));
        _logEnv("LICENSING_REGISTRY_ADDRESS", address(licensingRegistry));
        _logEnv("COLLAB_MANAGER_ADDRESS", address(collabManager));
        _logEnv("ANALYTICS_REGISTRY_ADDRESS", address(analytics));
        console.log("");
        console.log("# --- Staking, Bounties & Escrow ---");
        _logEnv("LAUNCHPAD_STAKING_ADDRESS", address(staking));
        _logEnv("STORY_BOUNTIES_ADDRESS", address(bounties));
        _logEnv("ESCROW_ADDRESS", address(escrow));
        console.log("");
        console.log("# --- Vite (frontend) ---");
        _logEnv("VITE_LOAR_TOKEN_ADDRESS", address(loarToken));
        _logEnv("VITE_TREASURY_ADDRESS", treasury);
        _logEnv("VITE_LOAR_FAUCET_ADDRESS", address(faucet));
        _logEnv("VITE_UNIVERSE_MANAGER", address(um));
        _logEnv("VITE_PAYMENT_ROUTER_ADDRESS", address(paymentRouter));
        _logEnv("VITE_SPLIT_ROUTER_ADDRESS", address(splitRouter));
        _logEnv("VITE_LAUNCHPAD_STAKING_ADDRESS", address(staking));
        _logEnv("VITE_STORY_BOUNTIES_ADDRESS", address(bounties));
        _logEnv("VITE_IDENTITY_NFT_ADDRESS", address(identityNft));
        console.log("");
        console.log("# --- Platform treasury for split orchestrator ---");
        _logEnv("PLATFORM_TREASURY_ADDRESS", treasury);
        console.log("");
        console.log("========================================");
    }

    function _logEnv(string memory key, address val) internal pure {
        console.log(string.concat(key, "="), val);
    }
}
