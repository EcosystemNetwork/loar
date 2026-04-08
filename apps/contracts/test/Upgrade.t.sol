// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/proxy/ERC1967/ERC1967Proxy.sol";
import {UpgradeableBeacon} from "@openzeppelin/proxy/beacon/UpgradeableBeacon.sol";
import {BeaconProxy} from "@openzeppelin/proxy/beacon/BeaconProxy.sol";
import {PaymentRouter} from "../src/PaymentRouter.sol";
import {CharacterNFT} from "../src/revenue/CharacterNFT.sol";

/// @title UpgradeTest
/// @notice Tests that UUPS singletons and Beacon NFTs can be upgraded.
///         Deploy V1 → interact → upgrade to V2 → verify state preserved.
contract UpgradeTest is Test {
    address deployer = makeAddr("deployer");
    address treasury = makeAddr("treasury");

    // ── Test UUPS upgrade (PaymentRouter) ──

    function test_UUPS_upgrade_preserves_state() public {
        vm.startPrank(deployer);

        // Deploy V1 implementation + proxy
        PaymentRouter implV1 = new PaymentRouter();
        PaymentRouter proxy = PaymentRouter(address(new ERC1967Proxy(
            address(implV1),
            abi.encodeCall(PaymentRouter.initialize, (treasury, 500))
        )));

        // Verify V1 state
        assertEq(proxy.treasury(), treasury);
        assertEq(proxy.defaultPlatformFeeBps(), 500);

        // Deploy V2 implementation (same contract, simulates a new version)
        PaymentRouter implV2 = new PaymentRouter();

        // Upgrade proxy to V2
        proxy.upgradeToAndCall(address(implV2), "");

        // Verify state is preserved after upgrade
        assertEq(proxy.treasury(), treasury, "Treasury should survive upgrade");
        assertEq(proxy.defaultPlatformFeeBps(), 500, "Fee should survive upgrade");

        vm.stopPrank();
    }

    function test_UUPS_non_owner_cannot_upgrade() public {
        vm.startPrank(deployer);
        PaymentRouter impl = new PaymentRouter();
        PaymentRouter proxy = PaymentRouter(address(new ERC1967Proxy(
            address(impl),
            abi.encodeCall(PaymentRouter.initialize, (treasury, 500))
        )));
        PaymentRouter newImpl = new PaymentRouter();
        vm.stopPrank();

        // Non-owner tries to upgrade — should revert with OwnableUnauthorizedAccount
        address attacker = makeAddr("attacker");
        vm.prank(attacker);
        vm.expectRevert();
        proxy.upgradeToAndCall(address(newImpl), "");
    }

    function test_UUPS_cannot_reinitialize() public {
        vm.startPrank(deployer);
        PaymentRouter proxy = PaymentRouter(address(new ERC1967Proxy(
            address(new PaymentRouter()),
            abi.encodeCall(PaymentRouter.initialize, (treasury, 500))
        )));

        // Try to reinitialize — should revert
        vm.expectRevert();
        proxy.initialize(makeAddr("hacker"), 9999);
        vm.stopPrank();
    }

    // ── Test Beacon upgrade (CharacterNFT) ──

    function test_Beacon_upgrade_all_proxies() public {
        vm.startPrank(deployer);

        // Deploy V1 implementation + beacon
        CharacterNFT implV1 = new CharacterNFT();
        UpgradeableBeacon beacon = new UpgradeableBeacon(address(implV1), deployer);

        // Deploy 2 universe proxies through the beacon
        CharacterNFT universe1 = CharacterNFT(address(new BeaconProxy(
            address(beacon),
            abi.encodeCall(CharacterNFT.initialize, (
                1, deployer, address(0x1), address(0x2), 300
            ))
        )));

        CharacterNFT universe2 = CharacterNFT(address(new BeaconProxy(
            address(beacon),
            abi.encodeCall(CharacterNFT.initialize, (
                2, deployer, address(0x1), address(0x2), 300
            ))
        )));

        // Verify both proxies work
        assertEq(universe1.universeId(), 1);
        assertEq(universe2.universeId(), 2);

        // Deploy V2 implementation
        CharacterNFT implV2 = new CharacterNFT();

        // Upgrade beacon — ALL proxies upgrade instantly
        beacon.upgradeTo(address(implV2));

        // Both proxies still work with preserved state
        assertEq(universe1.universeId(), 1, "Universe 1 state preserved");
        assertEq(universe2.universeId(), 2, "Universe 2 state preserved");

        vm.stopPrank();
    }

    function test_Beacon_non_owner_cannot_upgrade() public {
        vm.startPrank(deployer);
        CharacterNFT impl1 = new CharacterNFT();
        UpgradeableBeacon beacon = new UpgradeableBeacon(address(impl1), deployer);
        CharacterNFT impl2 = new CharacterNFT();
        vm.stopPrank();

        address attacker = makeAddr("attacker");
        vm.prank(attacker);
        vm.expectRevert();
        beacon.upgradeTo(address(impl2));
    }
}
