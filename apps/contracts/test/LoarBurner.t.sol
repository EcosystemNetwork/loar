// SPDX-License-Identifier: UNLICENSED
pragma solidity =0.8.30;

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

    // ── Token allocation splits ──

    function test_execute_splitAccuracy_allActions() public {
        // Execute each default action and verify cumulative split accuracy
        uint256 totalLp;
        uint256 totalTreasury;

        // PRIORITY_GENERATION: 50e18
        vm.prank(user);
        burner.execute(LoarBurner.BurnAction.PRIORITY_GENERATION);
        totalLp += (50e18 * 5000) / 10_000;
        totalTreasury += 50e18 - (50e18 * 5000) / 10_000;

        // REMIX_BOOST: 100e18
        vm.prank(user);
        burner.execute(LoarBurner.BurnAction.REMIX_BOOST);
        totalLp += (100e18 * 5000) / 10_000;
        totalTreasury += 100e18 - (100e18 * 5000) / 10_000;

        assertEq(loar.balanceOf(lp), totalLp);
        assertEq(loar.balanceOf(treasury), totalTreasury);
        assertEq(burner.totalCollected(), 150e18);
        assertEq(burner.totalToLp(), totalLp);
    }

    function test_execute_split_100pctToLp() public {
        vm.prank(deployer);
        burner.setLpRatio(10_000); // 100% to LP

        uint256 cost = 50e18;

        vm.prank(user);
        burner.execute(LoarBurner.BurnAction.PRIORITY_GENERATION);

        assertEq(loar.balanceOf(lp), cost);
        assertEq(loar.balanceOf(treasury), 0);
        assertEq(burner.totalToLp(), cost);
    }

    function test_execute_split_0pctToLp() public {
        vm.prank(deployer);
        burner.setLpRatio(0); // 0% to LP, 100% treasury

        uint256 cost = 50e18;

        vm.prank(user);
        burner.execute(LoarBurner.BurnAction.PRIORITY_GENERATION);

        assertEq(loar.balanceOf(lp), 0);
        assertEq(loar.balanceOf(treasury), cost);
        assertEq(burner.totalToLp(), 0);
    }

    // ── No LP address (zero address) — all goes to treasury ──

    function test_execute_noLpAddress_allToTreasury() public {
        // Deploy a new burner with LP = address(0)
        vm.startPrank(deployer);
        LoarBurner impl2 = new LoarBurner();
        LoarBurner burner2 = LoarBurner(address(new ERC1967Proxy(
            address(impl2),
            abi.encodeCall(LoarBurner.initialize, (address(loar), treasury, address(0), platform))
        )));
        vm.stopPrank();

        // Fund user and approve
        loar.mint(user, 10_000e18);
        vm.prank(user);
        loar.approve(address(burner2), type(uint256).max);

        uint256 cost = 50e18;
        uint256 treasuryBefore = loar.balanceOf(treasury);

        vm.prank(user);
        burner2.execute(LoarBurner.BurnAction.PRIORITY_GENERATION);

        // All goes to treasury even though lpRatio is 50%
        assertEq(loar.balanceOf(treasury) - treasuryBefore, cost);
        assertEq(burner2.totalToLp(), 0);
        assertEq(burner2.totalCollected(), cost);
    }

    // ── Pause functionality ──

    function test_pause_blocksExecute() public {
        vm.prank(deployer);
        burner.pause();

        vm.prank(user);
        vm.expectRevert();
        burner.execute(LoarBurner.BurnAction.PRIORITY_GENERATION);
    }

    function test_pause_blocksExecuteFor() public {
        vm.prank(deployer);
        burner.pause();

        vm.prank(platform);
        vm.expectRevert();
        burner.executeFor(user, LoarBurner.BurnAction.PRIORITY_GENERATION);
    }

    function test_pause_blocksExecuteCustom() public {
        bytes32 actionName = keccak256("PAUSED_ACTION");

        vm.prank(deployer);
        burner.setCustomAction(actionName, 10e18, true);

        vm.prank(deployer);
        burner.pause();

        vm.prank(user);
        vm.expectRevert();
        burner.executeCustom(actionName);
    }

    function test_unpause_restoresExecution() public {
        vm.prank(deployer);
        burner.pause();

        vm.prank(deployer);
        burner.unpause();

        // Should work now
        vm.prank(user);
        burner.execute(LoarBurner.BurnAction.PRIORITY_GENERATION);
        assertEq(burner.totalCollected(), 50e18);
    }

    function test_pause_revert_notOwner() public {
        vm.prank(user);
        vm.expectRevert();
        burner.pause();
    }

    function test_unpause_revert_notOwner() public {
        vm.prank(deployer);
        burner.pause();

        vm.prank(user);
        vm.expectRevert();
        burner.unpause();
    }

    // ── SafeERC20 transfers — insufficient allowance ──

    function test_execute_revert_noAllowance() public {
        address user2 = makeAddr("user2");
        loar.mint(user2, 100_000e18);
        // user2 does NOT approve burner

        vm.prank(user2);
        vm.expectRevert(); // SafeERC20 will revert
        burner.execute(LoarBurner.BurnAction.PRIORITY_GENERATION);
    }

    function test_execute_revert_insufficientBalance() public {
        address poorUser = makeAddr("poorUser");
        loar.mint(poorUser, 1e18); // Only 1 token, action costs 50
        vm.prank(poorUser);
        loar.approve(address(burner), type(uint256).max);

        vm.prank(poorUser);
        vm.expectRevert(); // SafeERC20 will revert on transferFrom
        burner.execute(LoarBurner.BurnAction.PRIORITY_GENERATION);
    }

    // ── Action config tracking (totalBurned / totalCount) ──

    function test_execute_tracksTotalBurnedAndCount() public {
        vm.prank(user);
        burner.execute(LoarBurner.BurnAction.PRIORITY_GENERATION);

        (uint256 cost, bool active, uint256 totalBurned, uint256 totalCount) =
            burner.actions(LoarBurner.BurnAction.PRIORITY_GENERATION);
        assertEq(cost, 50e18);
        assertTrue(active);
        assertEq(totalBurned, 50e18);
        assertEq(totalCount, 1);

        // Execute again
        vm.prank(user);
        burner.execute(LoarBurner.BurnAction.PRIORITY_GENERATION);

        (, , totalBurned, totalCount) = burner.actions(LoarBurner.BurnAction.PRIORITY_GENERATION);
        assertEq(totalBurned, 100e18);
        assertEq(totalCount, 2);
    }

    function test_executeCustom_tracksTotalBurnedAndCount() public {
        bytes32 actionName = keccak256("TRACKED_ACTION");

        vm.prank(deployer);
        burner.setCustomAction(actionName, 25e18, true);

        vm.prank(user);
        burner.executeCustom(actionName);

        (uint256 cost, bool active, uint256 totalBurned, uint256 totalCount) =
            burner.customActions(actionName);
        assertEq(cost, 25e18);
        assertTrue(active);
        assertEq(totalBurned, 25e18);
        assertEq(totalCount, 1);
    }

    // ── Access control — admin setters ──

    function test_setActionConfig_revert_notOwner() public {
        vm.prank(user);
        vm.expectRevert();
        burner.setActionConfig(LoarBurner.BurnAction.PRIORITY_GENERATION, 999e18, true);
    }

    function test_setCustomAction_revert_notOwner() public {
        vm.prank(user);
        vm.expectRevert();
        burner.setCustomAction(keccak256("X"), 1e18, true);
    }

    function test_setLpRatio_revert_notOwner() public {
        vm.prank(user);
        vm.expectRevert();
        burner.setLpRatio(8000);
    }

    function test_setLpRatio_revert_invalidRatio() public {
        vm.prank(deployer);
        vm.expectRevert("Invalid ratio");
        burner.setLpRatio(10_001);
    }

    function test_setTreasury() public {
        address newTreasury = makeAddr("newTreasury");
        vm.prank(deployer);
        burner.setTreasury(newTreasury);
        assertEq(burner.treasury(), newTreasury);
    }

    function test_setTreasury_revert_zeroAddress() public {
        vm.prank(deployer);
        vm.expectRevert(LoarBurner.ZeroAddress.selector);
        burner.setTreasury(address(0));
    }

    function test_setTreasury_revert_notOwner() public {
        vm.prank(user);
        vm.expectRevert();
        burner.setTreasury(makeAddr("x"));
    }

    function test_setLiquidityPool() public {
        address newLp = makeAddr("newLp");
        vm.prank(deployer);
        burner.setLiquidityPool(newLp);
        assertEq(burner.liquidityPool(), newLp);
    }

    function test_setLiquidityPool_zeroAddress_allowed() public {
        vm.prank(deployer);
        burner.setLiquidityPool(address(0));
        assertEq(burner.liquidityPool(), address(0));
    }

    function test_setLiquidityPool_revert_notOwner() public {
        vm.prank(user);
        vm.expectRevert();
        burner.setLiquidityPool(makeAddr("x"));
    }

    function test_setPlatform() public {
        address newPlatform = makeAddr("newPlatform");
        vm.prank(deployer);
        burner.setPlatform(newPlatform);
        assertEq(burner.platform(), newPlatform);
    }

    function test_setPlatform_revert_notOwner() public {
        vm.prank(user);
        vm.expectRevert();
        burner.setPlatform(makeAddr("x"));
    }

    // ── ExecuteFor by owner (not just platform) ──

    function test_executeFor_byOwner() public {
        uint256 cost = 50e18;
        uint256 userBalBefore = loar.balanceOf(user);

        vm.prank(deployer); // owner, not platform
        burner.executeFor(user, LoarBurner.BurnAction.PRIORITY_GENERATION);

        assertEq(loar.balanceOf(user), userBalBefore - cost);
        assertEq(burner.totalCollected(), cost);
    }

    // ── Initialize guards ──

    function test_initialize_revert_zeroToken() public {
        LoarBurner impl2 = new LoarBurner();

        vm.expectRevert(LoarBurner.ZeroAddress.selector);
        new ERC1967Proxy(
            address(impl2),
            abi.encodeCall(LoarBurner.initialize, (address(0), treasury, lp, platform))
        );
    }

    function test_initialize_revert_zeroTreasury() public {
        LoarBurner impl2 = new LoarBurner();

        vm.expectRevert(LoarBurner.ZeroAddress.selector);
        new ERC1967Proxy(
            address(impl2),
            abi.encodeCall(LoarBurner.initialize, (address(loar), address(0), lp, platform))
        );
    }

    function test_initialize_revert_doubleInit() public {
        vm.expectRevert();
        burner.initialize(address(loar), treasury, lp, platform);
    }

    // ── Events ──

    function test_emit_ActionExecuted() public {
        uint256 cost = 50e18;
        uint256 toLp = (cost * 5000) / 10_000;
        uint256 toTreasury = cost - toLp;

        vm.expectEmit(true, true, true, true);
        emit LoarBurner.ActionExecuted(user, LoarBurner.BurnAction.PRIORITY_GENERATION, cost, toLp, toTreasury);

        vm.prank(user);
        burner.execute(LoarBurner.BurnAction.PRIORITY_GENERATION);
    }

    function test_emit_CustomActionExecuted() public {
        bytes32 actionName = keccak256("EVENT_ACTION");
        uint256 customCost = 60e18;

        vm.prank(deployer);
        burner.setCustomAction(actionName, customCost, true);

        uint256 toLp = (customCost * 5000) / 10_000;
        uint256 toTreasury = customCost - toLp;

        vm.expectEmit(true, true, true, true);
        emit LoarBurner.CustomActionExecuted(user, actionName, customCost, toLp, toTreasury);

        vm.prank(user);
        burner.executeCustom(actionName);
    }

    function test_emit_LpRatioUpdated() public {
        vm.expectEmit(true, true, true, true);
        emit LoarBurner.LpRatioUpdated(5000, 8000);

        vm.prank(deployer);
        burner.setLpRatio(8000);
    }

    function test_emit_TreasuryUpdated() public {
        address newTreasury = makeAddr("newTreasury");

        vm.expectEmit(true, true, true, true);
        emit LoarBurner.TreasuryUpdated(treasury, newTreasury);

        vm.prank(deployer);
        burner.setTreasury(newTreasury);
    }

    function test_emit_LiquidityPoolUpdated() public {
        address newLp = makeAddr("newLp");

        vm.expectEmit(true, true, true, true);
        emit LoarBurner.LiquidityPoolUpdated(lp, newLp);

        vm.prank(deployer);
        burner.setLiquidityPool(newLp);
    }

    function test_emit_PlatformUpdated() public {
        address newPlatform = makeAddr("newPlatform");

        vm.expectEmit(true, true, true, true);
        emit LoarBurner.PlatformUpdated(platform, newPlatform);

        vm.prank(deployer);
        burner.setPlatform(newPlatform);
    }

    function test_emit_ActionConfigUpdated() public {
        vm.expectEmit(true, true, true, true);
        emit LoarBurner.ActionConfigUpdated(LoarBurner.BurnAction.PRIORITY_GENERATION, 200e18, true);

        vm.prank(deployer);
        burner.setActionConfig(LoarBurner.BurnAction.PRIORITY_GENERATION, 200e18, true);
    }

    function test_emit_CustomActionConfigUpdated() public {
        bytes32 actionName = keccak256("NEW_CUSTOM");

        vm.expectEmit(true, true, true, true);
        emit LoarBurner.CustomActionConfigUpdated(actionName, 99e18, true);

        vm.prank(deployer);
        burner.setCustomAction(actionName, 99e18, true);
    }

    // ── Distribution after LP address change ──

    function test_execute_afterLpChange_routesCorrectly() public {
        address newLp = makeAddr("newLp");
        vm.prank(deployer);
        burner.setLiquidityPool(newLp);

        uint256 cost = 50e18;
        uint256 expectedLp = (cost * 5000) / 10_000;
        uint256 expectedTreasury = cost - expectedLp;

        vm.prank(user);
        burner.execute(LoarBurner.BurnAction.PRIORITY_GENERATION);

        assertEq(loar.balanceOf(newLp), expectedLp);
        assertEq(loar.balanceOf(lp), 0); // old LP gets nothing
        assertEq(loar.balanceOf(treasury), expectedTreasury);
    }

    // ── Distribution after treasury change ──

    function test_execute_afterTreasuryChange_routesCorrectly() public {
        address newTreasury = makeAddr("newTreasury");
        vm.prank(deployer);
        burner.setTreasury(newTreasury);

        uint256 cost = 50e18;
        uint256 expectedTreasury = cost - (cost * 5000) / 10_000;

        vm.prank(user);
        burner.execute(LoarBurner.BurnAction.PRIORITY_GENERATION);

        assertEq(loar.balanceOf(newTreasury), expectedTreasury);
        assertEq(loar.balanceOf(treasury), 0); // old treasury gets nothing
    }

    // ── Multiple users executing ──

    function test_execute_multipleUsers() public {
        address user2 = makeAddr("user2");
        loar.mint(user2, 100_000e18);
        vm.prank(user2);
        loar.approve(address(burner), type(uint256).max);

        vm.prank(user);
        burner.execute(LoarBurner.BurnAction.PRIORITY_GENERATION);

        vm.prank(user2);
        burner.execute(LoarBurner.BurnAction.PRIORITY_GENERATION);

        assertEq(burner.totalCollected(), 100e18);

        (, , uint256 totalBurned, uint256 totalCount) =
            burner.actions(LoarBurner.BurnAction.PRIORITY_GENERATION);
        assertEq(totalBurned, 100e18);
        assertEq(totalCount, 2);
    }

    // ── Set LP to zero address after deployment ──

    function test_setLiquidityPool_toZero_allGoesToTreasury() public {
        vm.prank(deployer);
        burner.setLiquidityPool(address(0));

        uint256 cost = 50e18;

        vm.prank(user);
        burner.execute(LoarBurner.BurnAction.PRIORITY_GENERATION);

        assertEq(loar.balanceOf(treasury), cost); // all to treasury
        assertEq(burner.totalToLp(), 0);
    }
}
