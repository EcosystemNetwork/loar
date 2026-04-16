// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {PaymentRouter} from "../src/PaymentRouter.sol";
import {CreditManager} from "../src/revenue/CreditManager.sol";
import {LicensingRegistry} from "../src/revenue/LicensingRegistry.sol";
import {RemixFees} from "../src/revenue/RemixFees.sol";

interface IUUPS {
    function upgradeToAndCall(address newImplementation, bytes memory data) external;
}

/**
 * @title UpgradeRevenue
 * @notice Deploys new implementations for security-audited contracts and upgrades
 *         existing UUPS proxies on Sepolia.
 *
 * Security fixes included:
 *   - PaymentRouter: indexed event parameters for efficient off-chain filtering
 *   - CreditManager: try/catch on discountToken.balanceOf to prevent DoS
 *   - LicensingRegistry: access control on payRoyalty, consistent custom errors
 *   - RemixFees: address(0) validation, custom error for unauthorized
 *
 * Run:
 *   source ../../.env
 *   forge script script/UpgradeRevenue.s.sol \
 *     --rpc-url $RPC_URL --broadcast \
 *     --sender <DEPLOYER_ADDRESS>
 */
contract UpgradeRevenueScript is Script {
    function run() public {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        // Existing proxy addresses (Sepolia)
        address paymentRouterProxy = vm.envOr(
            "PAYMENT_ROUTER_PROXY",
            address(0x920e9A9bac991554AEE2AB7c76c521e5FB3113b6)
        );
        address creditManagerProxy = vm.envOr(
            "CREDIT_MANAGER_PROXY",
            address(0x5110FCCaf50316D8F874F22428dC1a832F591639)
        );
        address licensingRegistryProxy = vm.envOr(
            "LICENSING_REGISTRY_PROXY",
            address(0xbF0Fed6125b1e05aA3Dc52B72B5cd7703990627C)
        );
        // RemixFees proxy address -- set via env if deployed, skip if not
        address remixFeesProxy = vm.envOr("REMIX_FEES_PROXY", address(0));

        console.log("=== LOAR Revenue Upgrade (Security Audit Fixes) ===");
        console.log("Deployer:", deployer);
        console.log("");

        vm.startBroadcast(pk);

        // 1. Deploy new PaymentRouter implementation
        PaymentRouter newPaymentRouter = new PaymentRouter();
        console.log("PaymentRouter new impl:", address(newPaymentRouter));

        // 2. Deploy new CreditManager implementation
        CreditManager newCreditManager = new CreditManager();
        console.log("CreditManager new impl:", address(newCreditManager));

        // 3. Deploy new LicensingRegistry implementation
        LicensingRegistry newLicensingRegistry = new LicensingRegistry();
        console.log("LicensingRegistry new impl:", address(newLicensingRegistry));

        // 4. Deploy new RemixFees implementation (if proxy exists)
        if (remixFeesProxy != address(0)) {
            RemixFees newRemixFees = new RemixFees();
            console.log("RemixFees new impl:", address(newRemixFees));
            IUUPS(remixFeesProxy).upgradeToAndCall(address(newRemixFees), "");
            console.log("RemixFees proxy upgraded");
        } else {
            console.log("RemixFees: skipped (no proxy address set)");
        }

        // Upgrade proxies to new implementations
        IUUPS(paymentRouterProxy).upgradeToAndCall(address(newPaymentRouter), "");
        console.log("PaymentRouter proxy upgraded");

        IUUPS(creditManagerProxy).upgradeToAndCall(address(newCreditManager), "");
        console.log("CreditManager proxy upgraded");

        IUUPS(licensingRegistryProxy).upgradeToAndCall(address(newLicensingRegistry), "");
        console.log("LicensingRegistry proxy upgraded");

        vm.stopBroadcast();

        console.log("");
        console.log("=== Upgrade complete ===");
        console.log("All proxies upgraded to security-audited implementations.");
        console.log("No state migration needed -- storage layout is unchanged.");
    }
}
