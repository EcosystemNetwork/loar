// SPDX-License-Identifier: MIT
pragma solidity =0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/proxy/ERC1967/ERC1967Proxy.sol";
import {ContentLicensing} from "../src/revenue/ContentLicensing.sol";
import {SplitRouter} from "../src/SplitRouter.sol";
import {RightsRegistry} from "../src/RightsRegistry.sol";

/**
 * @title DeployContentLicensing
 * @notice Deploys ContentLicensing.sol (UUPS proxy) and, if SplitRouter is
 *         missing on the target chain, deploys it too. Then optionally
 *         registers the marketplace operator on RightsRegistry so the
 *         Likeness Marketplace server can submit `setRightsWithCreatorSig`.
 *
 * Environment:
 *   PRIVATE_KEY              — deployer (also receives platform / owner role)
 *   PAYMENT_ROUTER           — already-deployed PaymentRouter address
 *   RIGHTS_REGISTRY          — already-deployed RightsRegistry address
 *   SPLIT_ROUTER             — optional; if unset, a new one is deployed
 *   MARKETPLACE_OPERATOR     — optional; if set, `RightsRegistry.setOperator(it, true)` is called
 *   TREASURY                 — optional platform address (defaults to deployer)
 *
 * Run (Sepolia):
 *   PAYMENT_ROUTER=0x0fF81B57D5B47AC5bF2A84EeA69cCf4Aa6eb0C7C \
 *   RIGHTS_REGISTRY=0x82b4Fe50cE07a64CbF5f97E9d70F2cEb8af63EA3 \
 *   forge script script/DeployContentLicensing.s.sol --rpc-url sepolia --broadcast
 *
 * Run (Base Sepolia, splits already deployed):
 *   PAYMENT_ROUTER=0x3a6C6Bc90F34839a4792c107d9597a92fBCCA984 \
 *   RIGHTS_REGISTRY=0x3EF8d96cf4336E46cc7091A2325B19f53b65b109 \
 *   SPLIT_ROUTER=0x8370F54A01Fc035f89293272C597bCE3B1289FC4 \
 *   forge script script/DeployContentLicensing.s.sol --rpc-url base-sepolia --broadcast
 */
contract DeployContentLicensingScript is Script {
    /// @notice Platform fee in bps (5%) — mirrors the rest of the revenue stack.
    uint16 constant PLATFORM_FEE_BPS = 500;

    function run() public {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address treasury = vm.envOr("TREASURY", deployer);
        address paymentRouter = vm.envAddress("PAYMENT_ROUTER");
        address rightsRegistry = vm.envAddress("RIGHTS_REGISTRY");
        address splitRouter = vm.envOr("SPLIT_ROUTER", address(0));
        address marketplaceOperator = vm.envOr("MARKETPLACE_OPERATOR", address(0));

        require(paymentRouter != address(0), "PAYMENT_ROUTER env required");
        require(rightsRegistry != address(0), "RIGHTS_REGISTRY env required");

        console.log("=== Deploy ContentLicensing ===");
        console.log("Deployer:        ", deployer);
        console.log("Treasury:        ", treasury);
        console.log("PaymentRouter:   ", paymentRouter);
        console.log("RightsRegistry:  ", rightsRegistry);

        vm.startBroadcast(pk);

        // 1. Deploy SplitRouter only if one wasn't already provided.
        if (splitRouter == address(0)) {
            SplitRouter sr = new SplitRouter(paymentRouter);
            splitRouter = address(sr);
            console.log("SplitRouter:     ", splitRouter, "(newly deployed)");
        } else {
            console.log("SplitRouter:     ", splitRouter, "(reused)");
        }

        // 2. Deploy ContentLicensing as a UUPS proxy.
        //    initialize(_platform, _splitRouter, _paymentRouter, _rightsRegistry, _platformFeeBps)
        ContentLicensing cl = ContentLicensing(
            address(
                new ERC1967Proxy(
                    address(new ContentLicensing()),
                    abi.encodeCall(
                        ContentLicensing.initialize,
                        (treasury, splitRouter, paymentRouter, rightsRegistry, PLATFORM_FEE_BPS)
                    )
                )
            )
        );
        console.log("ContentLicensing:", address(cl));

        // 3. Optionally register the marketplace operator. The deployer must
        //    own RightsRegistry for this; if not, the call will revert and we
        //    log a hint so the operator step can be run manually.
        if (marketplaceOperator != address(0)) {
            try RightsRegistry(rightsRegistry).setOperator(marketplaceOperator, true) {
                console.log("Operator added: ", marketplaceOperator);
            } catch {
                console.log("WARN: setOperator failed (deployer is not RightsRegistry owner?).");
                console.log("Run separately:  RightsRegistry.setOperator(", marketplaceOperator);
                console.log("                                          , true)");
            }
        }

        vm.stopBroadcast();

        console.log("\n=== Add to .env ===");
        console.log("CONTENT_LICENSING_ADDRESS_<CHAIN>=", address(cl));
        if (splitRouter != vm.envOr("SPLIT_ROUTER", address(0))) {
            console.log("SPLIT_ROUTER_ADDRESS_<CHAIN>=     ", splitRouter);
        }
        console.log("\nThen run: pnpm tsx scripts/rebuild-deployments.ts --apply");
        console.log("to merge the new addresses into packages/abis/src/addresses.ts.");
    }
}
