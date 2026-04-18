// SPDX-License-Identifier: UNLICENSED
pragma solidity =0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/proxy/ERC1967/ERC1967Proxy.sol";
import {RightsRegistry} from "../src/RightsRegistry.sol";
import {IRightsRegistry} from "../src/interfaces/IRightsRegistry.sol";

contract RightsRegistryTest is Test {
    RightsRegistry public registry;
    address deployer = makeAddr("deployer");
    address platform = makeAddr("platform");
    address operator = makeAddr("operator");
    address stranger = makeAddr("stranger");

    bytes32 hash1 = keccak256("content-1");
    bytes32 hash2 = keccak256("content-2");

    function setUp() public {
        vm.startPrank(deployer);
        RightsRegistry impl = new RightsRegistry();
        registry = RightsRegistry(address(new ERC1967Proxy(
            address(impl),
            abi.encodeCall(RightsRegistry.initialize, (platform))
        )));
        vm.stopPrank();
    }

    // ── Initialize ──

    function test_initialize() public view {
        assertEq(registry.owner(), deployer);
        assertTrue(registry.operators(platform));
    }

    // ── setRights ──

    function test_setRights_byPlatform_fun() public {
        // RIGHTS-01 hardening: plain operators may only set non-monetizable classifications.
        vm.prank(platform);
        registry.setRights(hash1, IRightsRegistry.RightsType.FUN);
        assertEq(uint(registry.rights(hash1)), uint(IRightsRegistry.RightsType.FUN));
    }

    function test_setRights_byOwner_monetizable() public {
        vm.prank(deployer);
        registry.setRights(hash1, IRightsRegistry.RightsType.LICENSED);
        assertEq(uint(registry.rights(hash1)), uint(IRightsRegistry.RightsType.LICENSED));
    }

    function test_setRights_byOperator_fun() public {
        vm.prank(deployer);
        registry.setOperator(operator, true);

        vm.prank(operator);
        registry.setRights(hash1, IRightsRegistry.RightsType.FUN);
        assertEq(uint(registry.rights(hash1)), uint(IRightsRegistry.RightsType.FUN));
    }

    function test_setRights_operator_revert_monetizable() public {
        // RIGHTS-01 hardening: operator cannot pre-claim ORIGINAL/LICENSED/PUBLIC_DOMAIN;
        // those require creator signature (setRightsWithCreatorSig) or owner bypass.
        vm.prank(platform);
        vm.expectRevert(RightsRegistry.MonetizableRequiresCreatorSig.selector);
        registry.setRights(hash1, IRightsRegistry.RightsType.ORIGINAL);
    }

    function test_setRights_revert_notOperator() public {
        vm.prank(stranger);
        vm.expectRevert(RightsRegistry.NotOperator.selector);
        registry.setRights(hash1, IRightsRegistry.RightsType.ORIGINAL);
    }

    function test_setRights_revert_zeroHash() public {
        vm.prank(platform);
        vm.expectRevert(RightsRegistry.ZeroHash.selector);
        registry.setRights(bytes32(0), IRightsRegistry.RightsType.ORIGINAL);
    }

    function test_setRights_revert_frozen() public {
        vm.prank(platform);
        registry.emergencyFreeze(hash1, "DMCA");
        vm.prank(deployer);
        vm.expectRevert(RightsRegistry.AlreadyFrozen.selector);
        registry.setRights(hash1, IRightsRegistry.RightsType.ORIGINAL);
    }

    // ── emergencyFreeze ──

    function test_emergencyFreeze() public {
        vm.prank(platform);
        registry.emergencyFreeze(hash1, "DMCA takedown");
        assertEq(uint(registry.rights(hash1)), uint(IRightsRegistry.RightsType.FROZEN));
    }

    function test_emergencyFreeze_revert_zeroHash() public {
        vm.prank(platform);
        vm.expectRevert(RightsRegistry.ZeroHash.selector);
        registry.emergencyFreeze(bytes32(0), "reason");
    }

    // ── isMonetizable ──

    function test_isMonetizable_unset() public view {
        assertFalse(registry.isMonetizable(hash1)); // UNSET is blocked (default-deny)
    }

    function test_isMonetizable_original() public {
        vm.prank(deployer);
        registry.setRights(hash1, IRightsRegistry.RightsType.ORIGINAL);
        assertTrue(registry.isMonetizable(hash1));
    }

    function test_isMonetizable_licensed() public {
        vm.prank(deployer);
        registry.setRights(hash1, IRightsRegistry.RightsType.LICENSED);
        assertTrue(registry.isMonetizable(hash1));
    }

    function test_isMonetizable_fun_blocked() public {
        vm.prank(platform);
        registry.setRights(hash1, IRightsRegistry.RightsType.FUN);
        assertFalse(registry.isMonetizable(hash1));
    }

    function test_isMonetizable_frozen_blocked() public {
        vm.prank(platform);
        registry.emergencyFreeze(hash1, "dispute");
        assertFalse(registry.isMonetizable(hash1));
    }

    function test_isMonetizable_publicDomain() public {
        vm.prank(deployer);
        registry.setRights(hash1, IRightsRegistry.RightsType.PUBLIC_DOMAIN);
        assertTrue(registry.isMonetizable(hash1));
    }

    // ── Operator management ──

    function test_setOperator() public {
        vm.prank(deployer);
        registry.setOperator(operator, true);
        assertTrue(registry.operators(operator));
    }

    function test_setOperator_revoke() public {
        vm.startPrank(deployer);
        registry.setOperator(operator, true);
        registry.setOperator(operator, false);
        vm.stopPrank();
        assertFalse(registry.operators(operator));
    }

    function test_setOperator_revert_notOwner() public {
        vm.prank(stranger);
        vm.expectRevert();
        registry.setOperator(operator, true);
    }
}
