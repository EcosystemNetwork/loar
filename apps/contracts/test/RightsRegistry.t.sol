// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {RightsRegistry} from "../src/RightsRegistry.sol";
import {IRightsRegistry} from "../src/interfaces/IRightsRegistry.sol";

contract RightsRegistryTest is Test {
    RightsRegistry registry;
    address owner = address(this);
    address platform = address(0x1);
    address operator = address(0x2);
    address nonOperator = address(0x3);

    bytes32 hash1 = keccak256("content1");
    bytes32 hash2 = keccak256("content2");

    function setUp() public {
        registry = new RightsRegistry(platform);
    }

    // ── Constructor ──

    function test_constructor_setsPlatformAsOperator() public view {
        assertTrue(registry.operators(platform));
    }

    // ── setRights ──

    function test_setRights_operator() public {
        vm.prank(platform);
        registry.setRights(hash1, IRightsRegistry.RightsType.ORIGINAL);
        assertEq(uint(registry.rights(hash1)), uint(IRightsRegistry.RightsType.ORIGINAL));
    }

    function test_setRights_owner() public {
        registry.setRights(hash1, IRightsRegistry.RightsType.LICENSED);
        assertEq(uint(registry.rights(hash1)), uint(IRightsRegistry.RightsType.LICENSED));
    }

    function test_setRights_revertsNonOperator() public {
        vm.prank(nonOperator);
        vm.expectRevert(RightsRegistry.NotOperator.selector);
        registry.setRights(hash1, IRightsRegistry.RightsType.ORIGINAL);
    }

    function test_setRights_revertsZeroHash() public {
        vm.expectRevert(RightsRegistry.ZeroHash.selector);
        registry.setRights(bytes32(0), IRightsRegistry.RightsType.ORIGINAL);
    }

    function test_setRights_revertsFrozen() public {
        vm.prank(platform);
        registry.freeze(hash1, "DMCA");

        vm.prank(platform);
        vm.expectRevert(RightsRegistry.AlreadyFrozen.selector);
        registry.setRights(hash1, IRightsRegistry.RightsType.ORIGINAL);
    }

    // ── freeze ──

    function test_freeze_setsFrozenStatus() public {
        vm.prank(platform);
        registry.freeze(hash1, "DMCA takedown");
        assertEq(uint(registry.rights(hash1)), uint(IRightsRegistry.RightsType.FROZEN));
    }

    function test_freeze_canFreezeAlreadyFrozen() public {
        vm.startPrank(platform);
        registry.freeze(hash1, "first");
        registry.freeze(hash1, "second"); // should not revert
        vm.stopPrank();
    }

    // ── isMonetizable ──

    function test_isMonetizable_unsetAllowed() public view {
        assertTrue(registry.isMonetizable(hash1));
    }

    function test_isMonetizable_originalAllowed() public {
        vm.prank(platform);
        registry.setRights(hash1, IRightsRegistry.RightsType.ORIGINAL);
        assertTrue(registry.isMonetizable(hash1));
    }

    function test_isMonetizable_licensedAllowed() public {
        vm.prank(platform);
        registry.setRights(hash1, IRightsRegistry.RightsType.LICENSED);
        assertTrue(registry.isMonetizable(hash1));
    }

    function test_isMonetizable_publicDomainAllowed() public {
        vm.prank(platform);
        registry.setRights(hash1, IRightsRegistry.RightsType.PUBLIC_DOMAIN);
        assertTrue(registry.isMonetizable(hash1));
    }

    function test_isMonetizable_funBlocked() public {
        vm.prank(platform);
        registry.setRights(hash1, IRightsRegistry.RightsType.FUN);
        assertFalse(registry.isMonetizable(hash1));
    }

    function test_isMonetizable_frozenBlocked() public {
        vm.prank(platform);
        registry.freeze(hash1, "DMCA");
        assertFalse(registry.isMonetizable(hash1));
    }

    // ── setOperator ──

    function test_setOperator_addsOperator() public {
        registry.setOperator(operator, true);
        assertTrue(registry.operators(operator));

        vm.prank(operator);
        registry.setRights(hash1, IRightsRegistry.RightsType.ORIGINAL);
    }

    function test_setOperator_removesOperator() public {
        registry.setOperator(operator, true);
        registry.setOperator(operator, false);
        assertFalse(registry.operators(operator));
    }

    function test_setOperator_revertsNonOwner() public {
        vm.prank(nonOperator);
        vm.expectRevert();
        registry.setOperator(operator, true);
    }
}
