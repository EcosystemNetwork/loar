// SPDX-License-Identifier: MIT
pragma solidity =0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {TimelockFactory} from "../src/factories/TimelockFactory.sol";

interface IUniverseTokenDeployerV3 {
    function setTimelockFactory(address _factory) external;
    function timelockFactory() external view returns (address);
    function owner() external view returns (address);
}

/**
 * @title DeployTimelockFactory
 * @notice Deploys the per-universe `TimelockFactory` (distinct from the
 *         protocol 48h TimelockController in `DeployTimelock.s.sol`), then
 *         authorizes `UniverseTokenDeployerV3` to call it and wires the
 *         deployer to point at the factory.
 *
 * Why this script exists:
 *   The previous flow was:
 *     1. deploy TimelockFactory
 *     2. call UniverseTokenDeployerV3.setTimelockFactory(addr)
 *   That worked, but `TimelockFactory.deployTimelock` / `.wireProposer` were
 *   unguarded — any caller could pre-deploy a timelock and front-run the
 *   legitimate UniverseTokenDeployerV3 flow, either bricking universe
 *   creation or hijacking the PROPOSER role (TIMELOCK-02).
 *
 *   The hardened factory (`authorizedCallers`) requires an explicit
 *   `setAuthorizedCaller(UniverseTokenDeployerV3, true)` before the first
 *   universe is created. This script bundles both steps so operators
 *   cannot forget one.
 *
 * Environment variables (required):
 *   PRIVATE_KEY                     - deployer key (factory owner at construction)
 *   UNIVERSE_TOKEN_DEPLOYER_ADDRESS - existing UniverseTokenDeployerV3 address
 *
 * Optional:
 *   RENOUNCE_FACTORY_OWNERSHIP      - 'true' to renounce factory ownership
 *                                     after wiring. Safe on mainnet — no
 *                                     further setAuthorizedCaller calls
 *                                     will ever be possible. Default: false.
 *
 * Run:
 *   forge script script/DeployTimelockFactory.s.sol \
 *     --rpc-url $RPC --broadcast --verify -vvv
 *
 * After running:
 *   - Verify on BaseScan that TimelockFactory.authorizedCallers(<deployer>) == true
 *   - Verify UniverseTokenDeployerV3.timelockFactory() == <new factory>
 *   - (Optional) re-run with RENOUNCE_FACTORY_OWNERSHIP=true after smoke tests
 */
contract DeployTimelockFactoryScript is Script {
    function run() public {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address universeDeployer = vm.envAddress("UNIVERSE_TOKEN_DEPLOYER_ADDRESS");
        bool renounce = vm.envOr("RENOUNCE_FACTORY_OWNERSHIP", false);

        require(universeDeployer != address(0), "UNIVERSE_TOKEN_DEPLOYER_ADDRESS must not be zero");

        // Pre-flight: the deployer key must own UniverseTokenDeployerV3 so it
        // can call setTimelockFactory below. If it doesn't, fail early with a
        // clear message instead of reverting mid-broadcast.
        address utdOwner = IUniverseTokenDeployerV3(universeDeployer).owner();
        require(
            utdOwner == deployer,
            "Deployer key does not own UniverseTokenDeployerV3 - run from the owner wallet"
        );

        console.log("=== Deploy TimelockFactory ===");
        console.log("Deployer (initial factory owner):", deployer);
        console.log("UniverseTokenDeployerV3:", universeDeployer);
        console.log("Renounce factory ownership after wiring:", renounce);
        console.log("");

        vm.startBroadcast(pk);

        // 1. Deploy factory with deployer as initial owner (needed to call
        //    setAuthorizedCaller in step 2).
        TimelockFactory factory = new TimelockFactory(deployer);
        console.log("[OK] TimelockFactory:", address(factory));

        // 2. Authorize UniverseTokenDeployerV3 to call deployTimelock /
        //    wireProposer. Without this step, the first universe creation
        //    will revert with NotAuthorized().
        factory.setAuthorizedCaller(universeDeployer, true);
        console.log("[OK] Authorized UniverseTokenDeployerV3 on factory");

        // 3. Point UniverseTokenDeployerV3 at the new factory so new universe
        //    creations use the per-universe timelock path instead of the
        //    legacy shared `timelock` fallback.
        IUniverseTokenDeployerV3(universeDeployer).setTimelockFactory(address(factory));
        console.log("[OK] UniverseTokenDeployerV3.setTimelockFactory");

        // 4. (optional) Renounce factory ownership so no future
        //    setAuthorizedCaller is possible. Only safe after smoke tests
        //    confirm universe creation works end-to-end.
        if (renounce) {
            factory.renounceOwnership();
            console.log("[OK] Factory ownership renounced");
        }

        vm.stopBroadcast();

        // 5. Post-deploy assertions (view-only, outside broadcast).
        require(
            factory.authorizedCallers(universeDeployer),
            "post-deploy: UniverseTokenDeployerV3 is not authorized"
        );
        require(
            IUniverseTokenDeployerV3(universeDeployer).timelockFactory() == address(factory),
            "post-deploy: UniverseTokenDeployerV3.timelockFactory mismatch"
        );

        console.log("");
        console.log("========================================");
        console.log("  TIMELOCKFACTORY BOOTSTRAP COMPLETE");
        console.log("========================================");
        console.log("");
        console.log("Add to .env:");
        console.log(string.concat("TIMELOCK_FACTORY_ADDRESS=", vm.toString(address(factory))));
        console.log("");
        if (!renounce) {
            console.log("NEXT: once you have smoke-tested universe creation, run this script");
            console.log("      again with RENOUNCE_FACTORY_OWNERSHIP=true to lock the factory.");
        }
        console.log("========================================");
    }
}
