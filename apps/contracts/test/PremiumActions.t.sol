// SPDX-License-Identifier: MIT
pragma solidity =0.8.30;

import {Test, Vm} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/proxy/ERC1967/ERC1967Proxy.sol";
import {PremiumActions} from "../src/revenue/PremiumActions.sol";
import {MockLoarToken} from "./mocks/MockLoarToken.sol";

contract PremiumActionsTest is Test {
    PremiumActions public premium;
    MockLoarToken public loar;

    address deployer = makeAddr("deployer");
    address treasury = makeAddr("treasury");
    address lp = makeAddr("lp");
    address platform = makeAddr("platform");
    address user = makeAddr("user");

    function setUp() public {
        loar = new MockLoarToken();

        vm.startPrank(deployer);
        PremiumActions impl = new PremiumActions();
        premium = PremiumActions(
            address(
                new ERC1967Proxy(
                    address(impl),
                    abi.encodeCall(PremiumActions.initialize, (address(loar), treasury, lp, platform))
                )
            )
        );
        vm.stopPrank();

        // Fund user and approve
        loar.mint(user, 100_000e18);
        vm.prank(user);
        loar.approve(address(premium), type(uint256).max);
    }

    // ── Initialize ──

    function test_initialize() public view {
        assertEq(address(premium.loarToken()), address(loar));
        assertEq(premium.treasury(), treasury);
        assertEq(premium.liquidityPool(), lp);
        assertEq(premium.platform(), platform);
        assertEq(premium.lpRatioBps(), 5000);
        assertEq(premium.owner(), deployer);

        // Check default action costs
        (uint256 cost, bool active,,) = premium.actions(PremiumActions.BurnAction.PRIORITY_GENERATION);
        assertEq(cost, 50e18);
        assertTrue(active);

        (cost, active,,) = premium.actions(PremiumActions.BurnAction.PERMANENT_CANON);
        assertEq(cost, 500e18);
        assertTrue(active);

        (cost, active,,) = premium.actions(PremiumActions.BurnAction.PREMIUM_PROFILE);
        assertEq(cost, 1000e18);
        assertTrue(active);

        (cost, active,,) = premium.actions(PremiumActions.BurnAction.REMIX_BOOST);
        assertEq(cost, 100e18);
        assertTrue(active);
    }

    // ── Execute ──

    function test_execute() public {
        uint256 cost = 50e18; // PRIORITY_GENERATION
        uint256 toLp = (cost * 5000) / 10_000; // 50%
        uint256 toTreasury = cost - toLp; // 50%
        uint256 userBalBefore = loar.balanceOf(user);

        vm.prank(user);
        premium.execute(PremiumActions.BurnAction.PRIORITY_GENERATION);

        assertEq(loar.balanceOf(user), userBalBefore - cost);
        assertEq(loar.balanceOf(lp), toLp);
        assertEq(loar.balanceOf(treasury), toTreasury);
        assertEq(premium.totalCollected(), cost);
        assertEq(premium.totalToLp(), toLp);
    }

    function test_execute_revert_actionNotActive() public {
        // Deactivate PRIORITY_GENERATION
        vm.prank(deployer);
        premium.setActionConfig(PremiumActions.BurnAction.PRIORITY_GENERATION, 50e18, false);

        vm.prank(user);
        vm.expectRevert(PremiumActions.ActionNotActive.selector);
        premium.execute(PremiumActions.BurnAction.PRIORITY_GENERATION);
    }

    // ── ExecuteFor ──

    function test_executeFor() public {
        uint256 cost = 50e18;
        uint256 userBalBefore = loar.balanceOf(user);

        vm.prank(platform);
        premium.executeFor(user, PremiumActions.BurnAction.PRIORITY_GENERATION);

        assertEq(loar.balanceOf(user), userBalBefore - cost);
        assertEq(premium.totalCollected(), cost);
    }

    function test_executeFor_revert_unauthorized() public {
        vm.prank(user);
        vm.expectRevert(PremiumActions.NotAuthorized.selector);
        premium.executeFor(user, PremiumActions.BurnAction.PRIORITY_GENERATION);
    }

    // ── ExecuteCustom ──

    function test_executeCustom() public {
        bytes32 actionName = keccak256("SPECIAL_ACTION");
        uint256 customCost = 75e18;

        // Set up custom action
        vm.prank(deployer);
        premium.setCustomAction(actionName, customCost, true);

        uint256 userBalBefore = loar.balanceOf(user);

        vm.prank(user);
        premium.executeCustom(actionName);

        assertEq(loar.balanceOf(user), userBalBefore - customCost);
        assertEq(premium.totalCollected(), customCost);
    }

    function test_executeCustom_revert_notActive() public {
        bytes32 actionName = keccak256("INACTIVE_ACTION");

        vm.prank(user);
        vm.expectRevert(PremiumActions.ActionNotActive.selector);
        premium.executeCustom(actionName);
    }

    // ── Admin ──

    function test_setActionConfig() public {
        vm.prank(deployer);
        premium.setActionConfig(PremiumActions.BurnAction.PRIORITY_GENERATION, 200e18, true);

        (uint256 cost, bool active,,) = premium.actions(PremiumActions.BurnAction.PRIORITY_GENERATION);
        assertEq(cost, 200e18);
        assertTrue(active);
    }

    function test_setLpRatio() public {
        vm.prank(deployer);
        premium.setLpRatio(7000);
        assertEq(premium.lpRatioBps(), 7000);

        // Now execute and verify new split
        uint256 cost = 50e18;
        uint256 expectedLp = (cost * 7000) / 10_000;
        uint256 expectedTreasury = cost - expectedLp;

        vm.prank(user);
        premium.execute(PremiumActions.BurnAction.PRIORITY_GENERATION);

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
        premium.execute(PremiumActions.BurnAction.PRIORITY_GENERATION);
        totalLp += (50e18 * 5000) / 10_000;
        totalTreasury += 50e18 - (50e18 * 5000) / 10_000;

        // REMIX_BOOST: 100e18
        vm.prank(user);
        premium.execute(PremiumActions.BurnAction.REMIX_BOOST);
        totalLp += (100e18 * 5000) / 10_000;
        totalTreasury += 100e18 - (100e18 * 5000) / 10_000;

        assertEq(loar.balanceOf(lp), totalLp);
        assertEq(loar.balanceOf(treasury), totalTreasury);
        assertEq(premium.totalCollected(), 150e18);
        assertEq(premium.totalToLp(), totalLp);
    }

    function test_execute_split_100pctToLp() public {
        vm.prank(deployer);
        premium.setLpRatio(10_000); // 100% to LP

        uint256 cost = 50e18;

        vm.prank(user);
        premium.execute(PremiumActions.BurnAction.PRIORITY_GENERATION);

        assertEq(loar.balanceOf(lp), cost);
        assertEq(loar.balanceOf(treasury), 0);
        assertEq(premium.totalToLp(), cost);
    }

    function test_execute_split_0pctToLp() public {
        vm.prank(deployer);
        premium.setLpRatio(0); // 0% to LP, 100% treasury

        uint256 cost = 50e18;

        vm.prank(user);
        premium.execute(PremiumActions.BurnAction.PRIORITY_GENERATION);

        assertEq(loar.balanceOf(lp), 0);
        assertEq(loar.balanceOf(treasury), cost);
        assertEq(premium.totalToLp(), 0);
    }

    // ── No LP address (zero address) — all goes to treasury ──

    function test_execute_noLpAddress_allToTreasury() public {
        // Deploy a new burner with LP = address(0)
        vm.startPrank(deployer);
        PremiumActions impl2 = new PremiumActions();
        PremiumActions burner2 = PremiumActions(
            address(
                new ERC1967Proxy(
                    address(impl2),
                    abi.encodeCall(
                        PremiumActions.initialize, (address(loar), treasury, address(0), platform)
                    )
                )
            )
        );
        vm.stopPrank();

        // Fund user and approve
        loar.mint(user, 10_000e18);
        vm.prank(user);
        loar.approve(address(burner2), type(uint256).max);

        uint256 cost = 50e18;
        uint256 treasuryBefore = loar.balanceOf(treasury);

        vm.prank(user);
        burner2.execute(PremiumActions.BurnAction.PRIORITY_GENERATION);

        // All goes to treasury even though lpRatio is 50%
        assertEq(loar.balanceOf(treasury) - treasuryBefore, cost);
        assertEq(burner2.totalToLp(), 0);
        assertEq(burner2.totalCollected(), cost);
    }

    // ── Pause functionality ──

    function test_pause_blocksExecute() public {
        vm.prank(deployer);
        premium.pause();

        vm.prank(user);
        vm.expectRevert();
        premium.execute(PremiumActions.BurnAction.PRIORITY_GENERATION);
    }

    function test_pause_blocksExecuteFor() public {
        vm.prank(deployer);
        premium.pause();

        vm.prank(platform);
        vm.expectRevert();
        premium.executeFor(user, PremiumActions.BurnAction.PRIORITY_GENERATION);
    }

    function test_pause_blocksExecuteCustom() public {
        bytes32 actionName = keccak256("PAUSED_ACTION");

        vm.prank(deployer);
        premium.setCustomAction(actionName, 10e18, true);

        vm.prank(deployer);
        premium.pause();

        vm.prank(user);
        vm.expectRevert();
        premium.executeCustom(actionName);
    }

    function test_unpause_restoresExecution() public {
        vm.prank(deployer);
        premium.pause();

        vm.prank(deployer);
        premium.unpause();

        // Should work now
        vm.prank(user);
        premium.execute(PremiumActions.BurnAction.PRIORITY_GENERATION);
        assertEq(premium.totalCollected(), 50e18);
    }

    function test_pause_revert_notOwner() public {
        vm.prank(user);
        vm.expectRevert();
        premium.pause();
    }

    function test_unpause_revert_notOwner() public {
        vm.prank(deployer);
        premium.pause();

        vm.prank(user);
        vm.expectRevert();
        premium.unpause();
    }

    // ── SafeERC20 transfers — insufficient allowance ──

    function test_execute_revert_noAllowance() public {
        address user2 = makeAddr("user2");
        loar.mint(user2, 100_000e18);
        // user2 does NOT approve burner

        vm.prank(user2);
        vm.expectRevert(); // SafeERC20 will revert
        premium.execute(PremiumActions.BurnAction.PRIORITY_GENERATION);
    }

    function test_execute_revert_insufficientBalance() public {
        address poorUser = makeAddr("poorUser");
        loar.mint(poorUser, 1e18); // Only 1 token, action costs 50
        vm.prank(poorUser);
        loar.approve(address(premium), type(uint256).max);

        vm.prank(poorUser);
        vm.expectRevert(); // SafeERC20 will revert on transferFrom
        premium.execute(PremiumActions.BurnAction.PRIORITY_GENERATION);
    }

    // ── Action config tracking (totalBurned / totalCount) ──

    function test_execute_tracksTotalBurnedAndCount() public {
        vm.prank(user);
        premium.execute(PremiumActions.BurnAction.PRIORITY_GENERATION);

        (uint256 cost, bool active, uint256 totalBurned, uint256 totalCount) =
            premium.actions(PremiumActions.BurnAction.PRIORITY_GENERATION);
        assertEq(cost, 50e18);
        assertTrue(active);
        assertEq(totalBurned, 50e18);
        assertEq(totalCount, 1);

        // Execute again
        vm.prank(user);
        premium.execute(PremiumActions.BurnAction.PRIORITY_GENERATION);

        (,, totalBurned, totalCount) = premium.actions(PremiumActions.BurnAction.PRIORITY_GENERATION);
        assertEq(totalBurned, 100e18);
        assertEq(totalCount, 2);
    }

    function test_executeCustom_tracksTotalBurnedAndCount() public {
        bytes32 actionName = keccak256("TRACKED_ACTION");

        vm.prank(deployer);
        premium.setCustomAction(actionName, 25e18, true);

        vm.prank(user);
        premium.executeCustom(actionName);

        (uint256 cost, bool active, uint256 totalBurned, uint256 totalCount) =
            premium.customActions(actionName);
        assertEq(cost, 25e18);
        assertTrue(active);
        assertEq(totalBurned, 25e18);
        assertEq(totalCount, 1);
    }

    // ── Access control — admin setters ──

    function test_setActionConfig_revert_notOwner() public {
        vm.prank(user);
        vm.expectRevert();
        premium.setActionConfig(PremiumActions.BurnAction.PRIORITY_GENERATION, 999e18, true);
    }

    function test_setCustomAction_revert_notOwner() public {
        vm.prank(user);
        vm.expectRevert();
        premium.setCustomAction(keccak256("X"), 1e18, true);
    }

    function test_setLpRatio_revert_notOwner() public {
        vm.prank(user);
        vm.expectRevert();
        premium.setLpRatio(8000);
    }

    function test_setLpRatio_revert_invalidRatio() public {
        vm.prank(deployer);
        vm.expectRevert(PremiumActions.InvalidRatio.selector);
        premium.setLpRatio(10_001);
    }

    function test_setTreasury() public {
        address newTreasury = makeAddr("newTreasury");
        vm.prank(deployer);
        premium.setTreasury(newTreasury);
        assertEq(premium.treasury(), newTreasury);
    }

    function test_setTreasury_revert_zeroAddress() public {
        vm.prank(deployer);
        vm.expectRevert(PremiumActions.ZeroAddress.selector);
        premium.setTreasury(address(0));
    }

    function test_setTreasury_revert_notOwner() public {
        vm.prank(user);
        vm.expectRevert();
        premium.setTreasury(makeAddr("x"));
    }

    function test_setLiquidityPool() public {
        address newLp = makeAddr("newLp");
        vm.prank(deployer);
        premium.setLiquidityPool(newLp);
        assertEq(premium.liquidityPool(), newLp);
    }

    function test_setLiquidityPool_zeroAddress_allowed() public {
        vm.prank(deployer);
        premium.setLiquidityPool(address(0));
        assertEq(premium.liquidityPool(), address(0));
    }

    function test_setLiquidityPool_revert_notOwner() public {
        vm.prank(user);
        vm.expectRevert();
        premium.setLiquidityPool(makeAddr("x"));
    }

    function test_setPlatform() public {
        address newPlatform = makeAddr("newPlatform");
        vm.prank(deployer);
        premium.setPlatform(newPlatform);
        assertEq(premium.platform(), newPlatform);
    }

    function test_setPlatform_revert_notOwner() public {
        vm.prank(user);
        vm.expectRevert();
        premium.setPlatform(makeAddr("x"));
    }

    // ── ExecuteFor by owner (not just platform) ──

    function test_executeFor_byOwner() public {
        uint256 cost = 50e18;
        uint256 userBalBefore = loar.balanceOf(user);

        vm.prank(deployer); // owner, not platform
        premium.executeFor(user, PremiumActions.BurnAction.PRIORITY_GENERATION);

        assertEq(loar.balanceOf(user), userBalBefore - cost);
        assertEq(premium.totalCollected(), cost);
    }

    // ── Initialize guards ──

    function test_initialize_revert_zeroToken() public {
        PremiumActions impl2 = new PremiumActions();

        vm.expectRevert(PremiumActions.ZeroAddress.selector);
        new ERC1967Proxy(
            address(impl2),
            abi.encodeCall(PremiumActions.initialize, (address(0), treasury, lp, platform))
        );
    }

    function test_initialize_revert_zeroTreasury() public {
        PremiumActions impl2 = new PremiumActions();

        vm.expectRevert(PremiumActions.ZeroAddress.selector);
        new ERC1967Proxy(
            address(impl2),
            abi.encodeCall(PremiumActions.initialize, (address(loar), address(0), lp, platform))
        );
    }

    function test_initialize_revert_doubleInit() public {
        vm.expectRevert();
        premium.initialize(address(loar), treasury, lp, platform);
    }

    // ── Events ──

    function test_emit_ActionExecuted() public {
        uint256 cost = 50e18;
        // MockLoarToken is a vanilla ERC20 (no fee-on-transfer), so received == cost.
        uint256 received = cost;
        uint256 toLp = (received * 5000) / 10_000;
        uint256 toTreasury = received - toLp;

        vm.expectEmit(true, true, true, true);
        emit PremiumActions.ActionExecuted(
            user, PremiumActions.BurnAction.PRIORITY_GENERATION, cost, received, toLp, toTreasury
        );

        vm.prank(user);
        premium.execute(PremiumActions.BurnAction.PRIORITY_GENERATION);
    }

    function test_emit_CustomActionExecuted() public {
        bytes32 actionName = keccak256("EVENT_ACTION");
        uint256 customCost = 60e18;

        vm.prank(deployer);
        premium.setCustomAction(actionName, customCost, true);

        uint256 received = customCost;
        uint256 toLp = (received * 5000) / 10_000;
        uint256 toTreasury = received - toLp;

        vm.expectEmit(true, true, true, true);
        emit PremiumActions.CustomActionExecuted(
            user, actionName, customCost, received, toLp, toTreasury
        );

        vm.prank(user);
        premium.executeCustom(actionName);
    }

    // ── H-1: cost vs received emit disambiguation ──

    function test_emit_ActionExecuted_costAndReceived_separateFields() public {
        // Vanilla ERC20: cost == received. With FoT tokens the two would
        // diverge — this test pins the wiring (cost from config, received
        // from balance delta) regardless of whether the token has fees.
        uint256 cost = 50e18;

        vm.recordLogs();
        vm.prank(user);
        premium.execute(PremiumActions.BurnAction.PRIORITY_GENERATION);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        // Find the ActionExecuted event (topic0 = keccak of sig).
        bytes32 sig = keccak256("ActionExecuted(address,uint8,uint256,uint256,uint256,uint256)");
        bool found;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] == sig) {
                (uint256 emittedCost, uint256 emittedReceived, uint256 toLp, uint256 toTreasury) =
                    abi.decode(logs[i].data, (uint256, uint256, uint256, uint256));
                assertEq(emittedCost, cost, "cost slot must equal sticker price");
                assertEq(emittedReceived, cost, "received == cost for vanilla ERC20");
                assertEq(toLp, cost / 2);
                assertEq(toTreasury, cost - toLp);
                found = true;
                break;
            }
        }
        assertTrue(found, "ActionExecuted log not found");
    }

    // ── M-4: setActionConfig must revert on CUSTOM slot ──

    function test_setActionConfig_revert_customSlot() public {
        vm.prank(deployer);
        vm.expectRevert(PremiumActions.UseCustomActionSetter.selector);
        premium.setActionConfig(PremiumActions.BurnAction.CUSTOM, 1e18, true);
    }

    function test_emit_LpRatioUpdated() public {
        vm.expectEmit(true, true, true, true);
        emit PremiumActions.LpRatioUpdated(5000, 8000);

        vm.prank(deployer);
        premium.setLpRatio(8000);
    }

    function test_emit_TreasuryUpdated() public {
        address newTreasury = makeAddr("newTreasury");

        vm.expectEmit(true, true, true, true);
        emit PremiumActions.TreasuryUpdated(treasury, newTreasury);

        vm.prank(deployer);
        premium.setTreasury(newTreasury);
    }

    function test_emit_LiquidityPoolUpdated() public {
        address newLp = makeAddr("newLp");

        vm.expectEmit(true, true, true, true);
        emit PremiumActions.LiquidityPoolUpdated(lp, newLp);

        vm.prank(deployer);
        premium.setLiquidityPool(newLp);
    }

    function test_emit_PlatformUpdated() public {
        address newPlatform = makeAddr("newPlatform");

        vm.expectEmit(true, true, true, true);
        emit PremiumActions.PlatformUpdated(platform, newPlatform);

        vm.prank(deployer);
        premium.setPlatform(newPlatform);
    }

    function test_emit_ActionConfigUpdated() public {
        vm.expectEmit(true, true, true, true);
        emit PremiumActions.ActionConfigUpdated(PremiumActions.BurnAction.PRIORITY_GENERATION, 200e18, true);

        vm.prank(deployer);
        premium.setActionConfig(PremiumActions.BurnAction.PRIORITY_GENERATION, 200e18, true);
    }

    function test_emit_CustomActionConfigUpdated() public {
        bytes32 actionName = keccak256("NEW_CUSTOM");

        vm.expectEmit(true, true, true, true);
        emit PremiumActions.CustomActionConfigUpdated(actionName, 99e18, true);

        vm.prank(deployer);
        premium.setCustomAction(actionName, 99e18, true);
    }

    // ── Distribution after LP address change ──

    function test_execute_afterLpChange_routesCorrectly() public {
        address newLp = makeAddr("newLp");
        vm.prank(deployer);
        premium.setLiquidityPool(newLp);

        uint256 cost = 50e18;
        uint256 expectedLp = (cost * 5000) / 10_000;
        uint256 expectedTreasury = cost - expectedLp;

        vm.prank(user);
        premium.execute(PremiumActions.BurnAction.PRIORITY_GENERATION);

        assertEq(loar.balanceOf(newLp), expectedLp);
        assertEq(loar.balanceOf(lp), 0); // old LP gets nothing
        assertEq(loar.balanceOf(treasury), expectedTreasury);
    }

    // ── Distribution after treasury change ──

    function test_execute_afterTreasuryChange_routesCorrectly() public {
        address newTreasury = makeAddr("newTreasury");
        vm.prank(deployer);
        premium.setTreasury(newTreasury);

        uint256 cost = 50e18;
        uint256 expectedTreasury = cost - (cost * 5000) / 10_000;

        vm.prank(user);
        premium.execute(PremiumActions.BurnAction.PRIORITY_GENERATION);

        assertEq(loar.balanceOf(newTreasury), expectedTreasury);
        assertEq(loar.balanceOf(treasury), 0); // old treasury gets nothing
    }

    // ── Multiple users executing ──

    function test_execute_multipleUsers() public {
        address user2 = makeAddr("user2");
        loar.mint(user2, 100_000e18);
        vm.prank(user2);
        loar.approve(address(premium), type(uint256).max);

        vm.prank(user);
        premium.execute(PremiumActions.BurnAction.PRIORITY_GENERATION);

        vm.prank(user2);
        premium.execute(PremiumActions.BurnAction.PRIORITY_GENERATION);

        assertEq(premium.totalCollected(), 100e18);

        (,, uint256 totalBurned, uint256 totalCount) =
            premium.actions(PremiumActions.BurnAction.PRIORITY_GENERATION);
        assertEq(totalBurned, 100e18);
        assertEq(totalCount, 2);
    }

    // ── Set LP to zero address after deployment ──

    function test_setLiquidityPool_toZero_allGoesToTreasury() public {
        vm.prank(deployer);
        premium.setLiquidityPool(address(0));

        uint256 cost = 50e18;

        vm.prank(user);
        premium.execute(PremiumActions.BurnAction.PRIORITY_GENERATION);

        assertEq(loar.balanceOf(treasury), cost); // all to treasury
        assertEq(premium.totalToLp(), 0);
    }
}
