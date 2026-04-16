// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/proxy/ERC1967/ERC1967Proxy.sol";
import {LoarBurner} from "../src/revenue/LoarBurner.sol";
import {MockLoarToken} from "./mocks/MockLoarToken.sol";

contract LoarBurnerTest is Test {
    LoarBurner public burner;
    MockLoarToken public loar;

    address deployer = makeAddr("deployer");
    address treasury = makeAddr("treasury");
    address lp = makeAddr("lp");
    address platform = makeAddr("platform");
    address user = makeAddr("user");

    function setUp() public {
        loar = new MockLoarToken();

        vm.startPrank(deployer);
        LoarBurner impl = new LoarBurner();
        burner = LoarBurner(address(new ERC1967Proxy(
            address(impl),
            abi.encodeCall(LoarBurner.initialize, (address(loar), treasury, lp, platform))
        )));
        vm.stopPrank();

        // Fund user and approve
        loar.mint(user, 100_000e18);
        vm.prank(user);
        loar.approve(address(burner), type(uint256).max);
    }

    // ── Initialize ──

    function test_initialize() public view {
        assertEq(address(burner.loarToken()), address(loar));
        assertEq(burner.treasury(), treasury);
        assertEq(burner.liquidityPool(), lp);
        assertEq(burner.platform(), platform);
        assertEq(burner.lpRatioBps(), 5000);
        assertEq(burner.owner(), deployer);

        // Check default action costs
        (uint256 cost, bool active,,) = burner.actions(LoarBurner.BurnAction.PRIORITY_GENERATION);
        assertEq(cost, 50e18);
        assertTrue(active);

        (cost, active,,) = burner.actions(LoarBurner.BurnAction.PERMANENT_CANON);
        assertEq(cost, 500e18);
        assertTrue(active);

        (cost, active,,) = burner.actions(LoarBurner.BurnAction.PREMIUM_PROFILE);
        assertEq(cost, 1000e18);
        assertTrue(active);

        (cost, active,,) = burner.actions(LoarBurner.BurnAction.REMIX_BOOST);
        assertEq(cost, 100e18);
        assertTrue(active);
    }

    // ── Execute ──

    function test_execute() public {
        uint256 cost = 50e18; // PRIORITY_GENERATION
        uint256 toLp = (cost * 5000) / 10_000;       // 50%
        uint256 toTreasury = cost - toLp;             // 50%
        uint256 userBalBefore = loar.balanceOf(user);

        vm.prank(user);
        burner.execute(LoarBurner.BurnAction.PRIORITY_GENERATION);

        assertEq(loar.balanceOf(user), userBalBefore - cost);
        assertEq(loar.balanceOf(lp), toLp);
        assertEq(loar.balanceOf(treasury), toTreasury);
        assertEq(burner.totalCollected(), cost);
        assertEq(burner.totalToLp(), toLp);
    }

    function test_execute_revert_actionNotActive() public {
        // Deactivate PRIORITY_GENERATION
        vm.prank(deployer);
        burner.setActionConfig(LoarBurner.BurnAction.PRIORITY_GENERATION, 50e18, false);

        vm.prank(user);
        vm.expectRevert(LoarBurner.ActionNotActive.selector);
        burner.execute(LoarBurner.BurnAction.PRIORITY_GENERATION);
    }

    // ── ExecuteFor ──

    function test_executeFor() public {
        uint256 cost = 50e18;
        uint256 userBalBefore = loar.balanceOf(user);

        vm.prank(platform);
        burner.executeFor(user, LoarBurner.BurnAction.PRIORITY_GENERATION);

        assertEq(loar.balanceOf(user), userBalBefore - cost);
        assertEq(burner.totalCollected(), cost);
    }

    function test_executeFor_revert_unauthorized() public {
        vm.prank(user);
        vm.expectRevert("Unauthorized");
        burner.executeFor(user, LoarBurner.BurnAction.PRIORITY_GENERATION);
    }

    // ── ExecuteCustom ──

    function test_executeCustom() public {
        bytes32 actionName = keccak256("SPECIAL_ACTION");
        uint256 customCost = 75e18;

        // Set up custom action
        vm.prank(deployer);
        burner.setCustomAction(actionName, customCost, true);

        uint256 userBalBefore = loar.balanceOf(user);

        vm.prank(user);
        burner.executeCustom(actionName);

        assertEq(loar.balanceOf(user), userBalBefore - customCost);
        assertEq(burner.totalCollected(), customCost);
    }

    function test_executeCustom_revert_notActive() public {
        bytes32 actionName = keccak256("INACTIVE_ACTION");

        vm.prank(user);
        vm.expectRevert(LoarBurner.ActionNotActive.selector);
        burner.executeCustom(actionName);
    }

    // ── Admin ──

    function test_setActionConfig() public {
        vm.prank(deployer);
        burner.setActionConfig(LoarBurner.BurnAction.PRIORITY_GENERATION, 200e18, true);

        (uint256 cost, bool active,,) = burner.actions(LoarBurner.BurnAction.PRIORITY_GENERATION);
        assertEq(cost, 200e18);
        assertTrue(active);
    }

    function test_setLpRatio() public {
        vm.prank(deployer);
        burner.setLpRatio(7000);
        assertEq(burner.lpRatioBps(), 7000);

        // Now execute and verify new split
        uint256 cost = 50e18;
        uint256 expectedLp = (cost * 7000) / 10_000;
        uint256 expectedTreasury = cost - expectedLp;

        vm.prank(user);
        burner.execute(LoarBurner.BurnAction.PRIORITY_GENERATION);

        assertEq(loar.balanceOf(lp), expectedLp);
        assertEq(loar.balanceOf(treasury), expectedTreasury);
    }
}
