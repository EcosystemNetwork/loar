// SPDX-License-Identifier: MIT
pragma solidity =0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/proxy/ERC1967/ERC1967Proxy.sol";
import {PaymentRouter} from "../src/PaymentRouter.sol";
import {RightsRegistry} from "../src/RightsRegistry.sol";
import {RevenueModuleFactory} from "../src/RevenueModuleFactory.sol";
import {CanonMarketplace} from "../src/revenue/CanonMarketplace.sol";
import {CreditManager} from "../src/revenue/CreditManager.sol";
import {SubscriptionManager} from "../src/revenue/SubscriptionManager.sol";
import {LicensingRegistry} from "../src/revenue/LicensingRegistry.sol";
import {CollabManager} from "../src/revenue/CollabManager.sol";
import {AnalyticsRegistry} from "../src/revenue/AnalyticsRegistry.sol";
import {UpgradeableBeacon} from "@openzeppelin/proxy/beacon/UpgradeableBeacon.sol";
import {EpisodeEditionCollection} from "../src/revenue/EpisodeEditionCollection.sol";
import {CharacterNFT} from "../src/revenue/CharacterNFT.sol";
import {EntityNFT} from "../src/revenue/EntityNFT.sol";
import {EntityEditionNFT} from "../src/revenue/EntityEditionNFT.sol";
import {EpisodeNFT} from "../src/revenue/EpisodeNFT.sol";

/**
 * @title DeployRevenue
 * @notice Deploys all revenue infrastructure as UUPS proxies + Beacon factory.
 *
 * Run: forge script script/DeployRevenue.s.sol --rpc-url sepolia --broadcast
 */
contract DeployRevenueScript is Script {
    uint16 constant FEE = 500; // 5%
    uint16 constant CANON_FEE = 300; // 3%
    uint256 constant MIN_FEE = 0.001 ether;
    uint256 constant VOTE_DUR = 604800; // 7 days

    function run() public {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address d = vm.addr(pk); // deployer
        address treasury = vm.envOr("TREASURY", d);
        address loarToken = vm.envOr("LOAR_TOKEN", address(0));

        console.log("Deployer:", d);
        vm.startBroadcast(pk);

        // 1. PaymentRouter (UUPS) — initialize(treasury, feeBps, loarToken, loarFeeDiscount)
        PaymentRouter pr = PaymentRouter(
            address(
                new ERC1967Proxy(
                    address(new PaymentRouter()),
                    abi.encodeCall(PaymentRouter.initialize, (treasury, FEE, loarToken, 500))
                )
            )
        );
        console.log("PaymentRouter:", address(pr));

        // 2. RightsRegistry (UUPS) — initialize(platform)
        RightsRegistry rr = RightsRegistry(
            address(
                new ERC1967Proxy(
                    address(new RightsRegistry()), abi.encodeCall(RightsRegistry.initialize, (d))
                )
            )
        );
        console.log("RightsRegistry:", address(rr));

        // 3. Deploy implementations + beacons + factory
        console.log("Deploying 5 NFT implementations + beacons...");
        UpgradeableBeacon epBeacon =
            new UpgradeableBeacon(address(new EpisodeEditionCollection()), d);
        UpgradeableBeacon chBeacon = new UpgradeableBeacon(address(new CharacterNFT()), d);
        UpgradeableBeacon enBeacon = new UpgradeableBeacon(address(new EntityNFT()), d);
        UpgradeableBeacon eeBeacon = new UpgradeableBeacon(address(new EntityEditionNFT()), d);
        UpgradeableBeacon epNftBeacon = new UpgradeableBeacon(address(new EpisodeNFT()), d);

        RevenueModuleFactory rmf = new RevenueModuleFactory(
            d,
            address(rr),
            address(pr),
            FEE,
            FEE,
            300,
            FEE,
            FEE,
            address(epBeacon),
            address(chBeacon),
            address(enBeacon),
            address(eeBeacon),
            address(epNftBeacon)
        );
        console.log("RevenueModuleFactory:", address(rmf));

        // 4. CanonMarketplace (UUPS) — initialize(platform, rightsRegistry, paymentRouter, feeBps, canonBps, minFee, voteDur)
        CanonMarketplace cm = CanonMarketplace(
            address(
                new ERC1967Proxy(
                    address(new CanonMarketplace()),
                    abi.encodeCall(
                        CanonMarketplace.initialize,
                        (d, address(rr), address(pr), FEE, CANON_FEE, MIN_FEE, VOTE_DUR)
                    )
                )
            )
        );
        console.log("CanonMarketplace:", address(cm));

        // 5. CreditManager (UUPS) — initialize(loarToken, platform, treasury, paymentRouter)
        CreditManager cr = CreditManager(
            address(
                new ERC1967Proxy(
                    address(new CreditManager()),
                    abi.encodeCall(CreditManager.initialize, (loarToken, d, treasury, address(pr)))
                )
            )
        );
        console.log("CreditManager:", address(cr));

        // 6. SubscriptionManager (UUPS) — initialize(platform, paymentRouter, feeBps)
        SubscriptionManager sm = SubscriptionManager(
            address(
                new ERC1967Proxy(
                    address(new SubscriptionManager()),
                    abi.encodeCall(SubscriptionManager.initialize, (d, address(pr), FEE))
                )
            )
        );
        console.log("SubscriptionManager:", address(sm));

        // 7. LicensingRegistry (UUPS) — initialize(platform, paymentRouter, feeBps)
        LicensingRegistry lr = LicensingRegistry(
            address(
                new ERC1967Proxy(
                    address(new LicensingRegistry()),
                    abi.encodeCall(LicensingRegistry.initialize, (d, address(pr), FEE))
                )
            )
        );
        console.log("LicensingRegistry:", address(lr));

        // 8. CollabManager (UUPS) — initialize(platform, paymentRouter, feeBps)
        CollabManager cl = CollabManager(
            address(
                new ERC1967Proxy(
                    address(new CollabManager()),
                    abi.encodeCall(
                        CollabManager.initialize,
                        (d, address(pr), vm.envOr("UNIVERSE_MANAGER", d), FEE)
                    )
                )
            )
        );
        console.log("CollabManager:", address(cl));

        // 9. AnalyticsRegistry (UUPS) — initialize(platform)
        AnalyticsRegistry ar = AnalyticsRegistry(
            address(
                new ERC1967Proxy(
                    address(new AnalyticsRegistry()),
                    abi.encodeCall(AnalyticsRegistry.initialize, (d))
                )
            )
        );
        console.log("AnalyticsRegistry:", address(ar));

        vm.stopBroadcast();

        console.log("\n=== Deployed ===");
        console.log("To upgrade: deploy new impl, call proxy.upgradeToAndCall(newImpl, '')");
        console.log("Beacon NFTs: call beacon.upgradeTo(newImpl) to upgrade ALL universe instances");
    }
}
