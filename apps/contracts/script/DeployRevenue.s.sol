// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {PaymentRouter} from "../src/PaymentRouter.sol";
import {RightsRegistry} from "../src/RightsRegistry.sol";
import {RevenueModuleFactory} from "../src/RevenueModuleFactory.sol";
import {SplitRouter} from "../src/SplitRouter.sol";
import {CanonMarketplace} from "../src/revenue/CanonMarketplace.sol";
import {CreditManager} from "../src/revenue/CreditManager.sol";
import {AdPlacement} from "../src/revenue/AdPlacement.sol";
import {SubscriptionManager} from "../src/revenue/SubscriptionManager.sol";
import {LicensingRegistry} from "../src/revenue/LicensingRegistry.sol";
import {CollabManager} from "../src/revenue/CollabManager.sol";
import {AnalyticsRegistry} from "../src/revenue/AnalyticsRegistry.sol";

/**
 * @title DeployRevenue
 * @notice Deploys all revenue infrastructure contracts AFTER the core protocol.
 *         DeployProtocol.s.sol must be run first (deploys UniverseManager, TokenDeployer, Hook, Lockers).
 *
 * @dev Required environment variables:
 *      - PRIVATE_KEY: Deployer private key
 *      - UNIVERSE_MANAGER: Address from DeployProtocol output
 *
 *      Optional environment variables:
 *      - TREASURY: Treasury address (defaults to deployer)
 *      - LOAR_TOKEN: $LOAR token address (defaults to address(0) — set after token deployment)
 *      - PLATFORM_FEE_BPS: Platform fee in basis points (defaults to 500 = 5%)
 *
 * Run with: forge script script/DeployRevenue.s.sol --rpc-url base-sepolia --broadcast --verify
 */
contract DeployRevenueScript is Script {
    // ── Deployed contracts ──────────────────────────────────────
    PaymentRouter public paymentRouter;
    RightsRegistry public rightsRegistry;
    RevenueModuleFactory public revenueModuleFactory;
    SplitRouter public splitRouter;
    CanonMarketplace public canonMarketplace;
    CreditManager public creditManager;
    AdPlacement public adPlacement;
    SubscriptionManager public subscriptionManager;
    LicensingRegistry public licensingRegistry;
    CollabManager public collabManager;
    AnalyticsRegistry public analyticsRegistry;

    // ── Default fee settings ────────────────────────────────────
    uint16 public constant DEFAULT_PLATFORM_FEE_BPS = 500;       // 5%
    uint16 public constant CANON_LICENSE_FEE_BPS = 300;           // 3%
    uint256 public constant MIN_SUBMISSION_FEE = 0.001 ether;
    uint256 public constant VOTING_DURATION = 604800;             // 7 days

    // Revenue module factory defaults
    uint16 public constant EPISODE_PLATFORM_FEE_BPS = 500;       // 5%
    uint16 public constant EPISODE_ROYALTY_BPS = 500;             // 5%
    uint16 public constant CHARACTER_APPEARANCE_FEE_BPS = 300;    // 3%
    uint16 public constant ENTITY_PLATFORM_FEE_BPS = 500;        // 5%
    uint16 public constant ENTITY_ROYALTY_BPS = 500;              // 5%

    function setUp() public {}

    function run() public {
        // ── Read required env vars ──────────────────────────────
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        address universeManager = vm.envAddress("UNIVERSE_MANAGER");

        // ── Read optional env vars ──────────────────────────────
        address treasury = vm.envOr("TREASURY", deployer);
        address loarToken = vm.envOr("LOAR_TOKEN", address(0));
        uint16 platformFeeBps = uint16(vm.envOr("PLATFORM_FEE_BPS", uint256(DEFAULT_PLATFORM_FEE_BPS)));

        // ── Validate ────────────────────────────────────────────
        require(universeManager != address(0), "UNIVERSE_MANAGER not set");

        console.log("=== Revenue Deployment Configuration ===");
        console.log("Deployer:", deployer);
        console.log("Deployer balance:", deployer.balance);
        console.log("UniverseManager:", universeManager);
        console.log("Treasury:", treasury);
        console.log("LOAR Token:", loarToken);
        console.log("Platform fee bps:", uint256(platformFeeBps));
        console.log("\n=== Starting Revenue Deployment ===\n");

        vm.startBroadcast(deployerPrivateKey);

        // ── 1. PaymentRouter ────────────────────────────────────
        console.log("1/11 Deploying PaymentRouter...");
        paymentRouter = new PaymentRouter(treasury, platformFeeBps);
        console.log("      PaymentRouter:", address(paymentRouter));

        // ── 2. RightsRegistry ───────────────────────────────────
        console.log("2/11 Deploying RightsRegistry...");
        rightsRegistry = new RightsRegistry(deployer);
        console.log("      RightsRegistry:", address(rightsRegistry));

        // ── 3. RevenueModuleFactory ─────────────────────────────
        console.log("3/11 Deploying RevenueModuleFactory...");
        revenueModuleFactory = new RevenueModuleFactory(
            deployer,                       // platform
            address(rightsRegistry),
            address(paymentRouter),
            EPISODE_PLATFORM_FEE_BPS,
            EPISODE_ROYALTY_BPS,
            CHARACTER_APPEARANCE_FEE_BPS,
            ENTITY_PLATFORM_FEE_BPS,
            ENTITY_ROYALTY_BPS
        );
        console.log("      RevenueModuleFactory:", address(revenueModuleFactory));

        // ── 4. SplitRouter ──────────────────────────────────────
        console.log("4/11 Deploying SplitRouter...");
        splitRouter = new SplitRouter(address(paymentRouter));
        console.log("      SplitRouter:", address(splitRouter));

        // ── 5. CanonMarketplace ─────────────────────────────────
        console.log("5/11 Deploying CanonMarketplace...");
        canonMarketplace = new CanonMarketplace(
            deployer,                       // platform
            address(rightsRegistry),
            address(paymentRouter),
            platformFeeBps,
            CANON_LICENSE_FEE_BPS,
            MIN_SUBMISSION_FEE,
            VOTING_DURATION
        );
        console.log("      CanonMarketplace:", address(canonMarketplace));

        // ── 6. CreditManager ────────────────────────────────────
        console.log("6/11 Deploying CreditManager...");
        creditManager = new CreditManager(
            loarToken,
            deployer,                       // platform
            treasury,
            address(paymentRouter)
        );
        console.log("      CreditManager:", address(creditManager));

        // ── 7. AdPlacement ──────────────────────────────────────
        console.log("7/11 Deploying AdPlacement...");
        adPlacement = new AdPlacement(deployer, address(paymentRouter), platformFeeBps);
        console.log("      AdPlacement:", address(adPlacement));

        // ── 8. SubscriptionManager ──────────────────────────────
        console.log("8/11 Deploying SubscriptionManager...");
        subscriptionManager = new SubscriptionManager(deployer, address(paymentRouter), platformFeeBps);
        console.log("      SubscriptionManager:", address(subscriptionManager));

        // ── 9. LicensingRegistry ────────────────────────────────
        console.log("9/11 Deploying LicensingRegistry...");
        licensingRegistry = new LicensingRegistry(deployer, address(paymentRouter), platformFeeBps);
        console.log("      LicensingRegistry:", address(licensingRegistry));

        // ── 10. CollabManager ───────────────────────────────────
        console.log("10/11 Deploying CollabManager...");
        collabManager = new CollabManager(deployer, address(paymentRouter), platformFeeBps);
        console.log("      CollabManager:", address(collabManager));

        // ── 11. AnalyticsRegistry ───────────────────────────────
        console.log("11/11 Deploying AnalyticsRegistry...");
        analyticsRegistry = new AnalyticsRegistry(deployer);
        console.log("      AnalyticsRegistry:", address(analyticsRegistry));

        vm.stopBroadcast();

        // ── Summary ─────────────────────────────────────────────
        console.log("\n=== Revenue Deployment Complete ===\n");
        console.log("PaymentRouter:        ", address(paymentRouter));
        console.log("RightsRegistry:       ", address(rightsRegistry));
        console.log("RevenueModuleFactory: ", address(revenueModuleFactory));
        console.log("SplitRouter:          ", address(splitRouter));
        console.log("CanonMarketplace:     ", address(canonMarketplace));
        console.log("CreditManager:        ", address(creditManager));
        console.log("AdPlacement:          ", address(adPlacement));
        console.log("SubscriptionManager:  ", address(subscriptionManager));
        console.log("LicensingRegistry:    ", address(licensingRegistry));
        console.log("CollabManager:        ", address(collabManager));
        console.log("AnalyticsRegistry:    ", address(analyticsRegistry));
        console.log("\n=== Next Steps ===");
        console.log("1. Set LOAR_TOKEN on CreditManager after token deployment (if address(0) was used)");
        console.log("2. Verify all contracts on block explorer");
        console.log("3. Configure SplitRouter registrars for UniverseManager and revenue contracts");
        console.log("4. Add revenue contracts as RightsRegistry operators if needed");
        console.log("5. Wire up UniverseManager to call RevenueModuleFactory.deployModules()");
    }
}
