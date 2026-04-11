// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

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

    function test_setRights_byPlatform() public {
        vm.prank(platform);
        registry.setRights(hash1, IRightsRegistry.RightsType.ORIGINAL);
        assertEq(uint(registry.rights(hash1)), uint(IRightsRegistry.RightsType.ORIGINAL));
    }

    function test_setRights_byOwner() public {
        vm.prank(deployer);
        registry.setRights(hash1, IRightsRegistry.RightsType.LICENSED);
        assertEq(uint(registry.rights(hash1)), uint(IRightsRegistry.RightsType.LICENSED));
    }

    function test_setRights_byOperator() public {
        vm.prank(deployer);
        registry.setOperator(operator, true);

        vm.prank(operator);
        registry.setRights(hash1, IRightsRegistry.RightsType.ORIGINAL);
        assertEq(uint(registry.rights(hash1)), uint(IRightsRegistry.RightsType.ORIGINAL));
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
        vm.startPrank(platform);
        registry.freeze(hash1, "DMCA");
        vm.expectRevert(RightsRegistry.AlreadyFrozen.selector);
        registry.setRights(hash1, IRightsRegistry.RightsType.ORIGINAL);
        vm.stopPrank();
    }

    // ── freeze ──

    function test_freeze() public {
        vm.prank(platform);
        registry.freeze(hash1, "DMCA takedown");
        assertEq(uint(registry.rights(hash1)), uint(IRightsRegistry.RightsType.FROZEN));
    }

    function test_freeze_revert_zeroHash() public {
        vm.prank(platform);
        vm.expectRevert(RightsRegistry.ZeroHash.selector);
        registry.freeze(bytes32(0), "reason");
    }

    // ── isMonetizable ──

    function test_isMonetizable_unset() public view {
        assertTrue(registry.isMonetizable(hash1)); // UNSET is allowed
    }

    function test_isMonetizable_original() public {
        vm.prank(platform);
        registry.setRights(hash1, IRightsRegistry.RightsType.ORIGINAL);
        assertTrue(registry.isMonetizable(hash1));
    }

    function test_isMonetizable_licensed() public {
        vm.prank(platform);
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
        registry.freeze(hash1, "dispute");
        assertFalse(registry.isMonetizable(hash1));
    }

    function test_isMonetizable_publicDomain() public {
        vm.prank(platform);
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
