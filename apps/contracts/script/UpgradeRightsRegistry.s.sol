// SPDX-License-Identifier: MIT
pragma solidity =0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {RightsRegistry} from "../src/RightsRegistry.sol";
import {ERC1967Utils} from "@openzeppelin-contracts-5.0.2/proxy/ERC1967/ERC1967Utils.sol";

interface IUUPS {
    function upgradeToAndCall(address newImplementation, bytes memory data) external;
}

/**
 * @title UpgradeRightsRegistry
 * @notice Replaces the implementation behind an existing RightsRegistry UUPS
 *         proxy with the audit-hardened version from `src/RightsRegistry.sol`.
 *         The proxy owner (deployer on both testnets today) calls
 *         `upgradeToAndCall`; storage layout is preserved.
 *
 * Behaviour change after upgrade:
 *   - `isMonetizable(unset hash)` flips from TRUE (legacy permissive) to FALSE (default-deny).
 *   - `creatorNonce` mapping becomes available (was missing pre-upgrade).
 *   - `setRightsWithCreatorSig(...)` becomes available for creator-attested classification.
 *
 * Risk: any other revenue contract that gates content with
 * `rightsRegistry.isMonetizable(hash)` will start blocking content that
 * wasn't explicitly classified. For testnet this is generally acceptable;
 * for mainnet, plan a backfill step BEFORE upgrading.
 *
 * Environment:
 *   PRIVATE_KEY               — deployer (also the proxy owner today)
 *   RIGHTS_REGISTRY_PROXY     — proxy address on the target chain
 *
 * Run (Sepolia):
 *   RIGHTS_REGISTRY_PROXY=0x3A14A746990498d5a4eCe867db10a197f91856Bc \
 *   forge script script/UpgradeRightsRegistry.s.sol --rpc-url sepolia --broadcast
 *
 * Run (Base Sepolia):
 *   RIGHTS_REGISTRY_PROXY=0x982c153e41b8B78ca48D7A13e6766Ce85F039558 \
 *   forge script script/UpgradeRightsRegistry.s.sol --rpc-url base-sepolia --broadcast
 */
contract UpgradeRightsRegistryScript is Script {
    function run() public {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address proxy = vm.envAddress("RIGHTS_REGISTRY_PROXY");

        require(proxy != address(0), "RIGHTS_REGISTRY_PROXY env required");

        // Sanity-check that `proxy` is in fact an ERC1967 proxy with a non-zero
        // implementation slot. Without this, a typo'd address would silently
        // `upgradeToAndCall` against arbitrary code (or a contract that has
        // a matching selector but isn't a UUPS proxy at all).
        bytes32 implSlot = vm.load(proxy, ERC1967Utils.IMPLEMENTATION_SLOT);
        address currentImpl = address(uint160(uint256(implSlot)));
        require(currentImpl != address(0), "Address is not an ERC1967 proxy (impl slot is zero)");

        console.log("=== Upgrade RightsRegistry ===");
        console.log("Deployer:        ", deployer);
        console.log("Proxy:           ", proxy);
        console.log("Current impl:    ", currentImpl);

        vm.startBroadcast(pk);

        // 1. Deploy the new (hardened) implementation. No constructor args — UUPS init
        //    happens via the existing proxy's stored state; we do NOT call initialize again.
        RightsRegistry newImpl = new RightsRegistry();
        console.log("New impl:", address(newImpl));

        // 2. Point the proxy at the new implementation. Empty calldata = no re-init.
        IUUPS(proxy).upgradeToAndCall(address(newImpl), "");
        console.log("Upgraded.");

        vm.stopBroadcast();

        // Confirm the impl slot moved to the freshly deployed contract.
        bytes32 postSlot = vm.load(proxy, ERC1967Utils.IMPLEMENTATION_SLOT);
        address postImpl = address(uint160(uint256(postSlot)));
        require(postImpl == address(newImpl), "Upgrade did not move the impl slot");

        console.log("\n=== Verification (do these after broadcast) ===");
        console.log("cast call <proxy> 'creatorNonce(address)(uint256)' <any-address>");
        console.log("cast call <proxy> 'isMonetizable(bytes32)(bool)' 0x000...0  # expect false now");
        console.log("\n=== Storage-layout check (run BEFORE broadcast on mainnet) ===");
        console.log("forge inspect src/RightsRegistry.sol:RightsRegistry storage-layout > new-layout.json");
        console.log("# Diff against the deployed impl artifact and fail on any non-append change.");
    }
}
