// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/proxy/ERC1967/ERC1967Proxy.sol";
import {RemixFees} from "../src/revenue/RemixFees.sol";
import {MockLoarToken} from "./mocks/MockLoarToken.sol";

contract RemixFeesTest is Test {
    RemixFees public remix;
    MockLoarToken public loar;

    address deployer = makeAddr("deployer");
    address treasury = makeAddr("treasury");
    address lp = makeAddr("lp");
    address platform = makeAddr("platform");
    address remixer = makeAddr("remixer");
    address creator = makeAddr("creator");
    address anyone = makeAddr("anyone");

    uint256 constant UNIVERSE_ID = 1;

    function setUp() public {
        loar = new MockLoarToken();

        vm.startPrank(deployer);
        RemixFees impl = new RemixFees();
        remix = RemixFees(address(new ERC1967Proxy(
            address(impl),
            abi.encodeCall(RemixFees.initialize, (address(loar), treasury, lp, platform))
        )));

        // Register universe
        remix.registerUniverse(UNIVERSE_ID, creator);
        vm.stopPrank();

        // Fund remixer and approve
        loar.mint(remixer, 10_000e18);
        vm.prank(remixer);
        loar.approve(address(remix), type(uint256).max);
    }

    // ── Initialize ──

    function test_initialize() public view {
        assertEq(address(remix.loarToken()), address(loar));
        assertEq(remix.treasury(), treasury);
        assertEq(remix.liquidityPool(), lp);
        assertEq(remix.platform(), platform);
        assertEq(remix.defaultRemixFee(), 25e18);
        assertEq(remix.minRemixFee(), 5e18);
        assertEq(remix.maxRemixFee(), 10_000e18);
        assertEq(remix.creatorShareBps(), 7000);
        assertEq(remix.lpShareBps(), 2000);
        assertEq(remix.treasuryShareBps(), 1000);
        assertEq(remix.owner(), deployer);
    }

    // ── Charge Remix Fee ──

    function test_chargeRemixFee() public {
        uint256 fee = 25e18; // default
        uint256 toCreator = (fee * 7000) / 10_000; // 70%
        uint256 toLp = (fee * 2000) / 10_000;      // 20%
        uint256 toTreasury = fee - toCreator - toLp; // 10%

        uint256 remixerBalBefore = loar.balanceOf(remixer);

        vm.prank(platform);
        remix.chargeRemixFee(remixer, creator, UNIVERSE_ID);

        assertEq(loar.balanceOf(remixer), remixerBalBefore - fee);
        assertEq(loar.balanceOf(creator), toCreator);
        assertEq(loar.balanceOf(lp), toLp);
        assertEq(loar.balanceOf(treasury), toTreasury);
        assertEq(remix.totalRemixes(), 1);
        assertEq(remix.totalRemixFees(), fee);
    }

    function test_chargeRemixFee_skipsSelfRemix() public {
        uint256 remixerBalBefore = loar.balanceOf(remixer);

        // remixer == originalCreator: should be a no-op
        vm.prank(platform);
        remix.chargeRemixFee(remixer, remixer, UNIVERSE_ID);

        assertEq(loar.balanceOf(remixer), remixerBalBefore);
        assertEq(remix.totalRemixes(), 0);
    }

    function test_chargeRemixFee_revert_notAuthorized() public {
        vm.prank(anyone);
        vm.expectRevert(RemixFees.NotAuthorized.selector);
        remix.chargeRemixFee(remixer, creator, UNIVERSE_ID);
    }

    function test_chargeRemixFee_noLpPool() public {
        // Remove LP pool
        vm.prank(deployer);
        remix.setLiquidityPool(address(0));

        uint256 fee = 25e18;
        uint256 toCreator = (fee * 7000) / 10_000;
        // LP share goes to treasury when no LP set
        uint256 expectedTreasury = fee - toCreator;

        vm.prank(platform);
        remix.chargeRemixFee(remixer, creator, UNIVERSE_ID);

        assertEq(loar.balanceOf(creator), toCreator);
        assertEq(loar.balanceOf(treasury), expectedTreasury);
    }

    // ── Set Universe Remix Fee ──

    function test_setUniverseRemixFee() public {
        uint256 customFee = 50e18;

        vm.prank(creator);
        remix.setUniverseRemixFee(UNIVERSE_ID, customFee);

        assertEq(remix.getRemixFee(UNIVERSE_ID), customFee);

        // Verify custom fee is used during charge
        vm.prank(platform);
        remix.chargeRemixFee(remixer, creator, UNIVERSE_ID);

        assertEq(remix.totalRemixFees(), customFee);
    }

    function test_setUniverseRemixFee_revert_belowMinimum() public {
        vm.prank(creator);
        vm.expectRevert(RemixFees.FeeBelowMinimum.selector);
        remix.setUniverseRemixFee(UNIVERSE_ID, 1e18); // below 5 LOAR min
    }

    function test_setUniverseRemixFee_revert_aboveMaximum() public {
        vm.prank(creator);
        vm.expectRevert(RemixFees.FeeAboveMaximum.selector);
        remix.setUniverseRemixFee(UNIVERSE_ID, 20_000e18); // above 10k LOAR max
    }

    // ── Set Split Ratios ──

    function test_setSplitRatios() public {
        vm.prank(deployer);
        remix.setSplitRatios(8000, 1000, 1000);

        assertEq(remix.creatorShareBps(), 8000);
        assertEq(remix.lpShareBps(), 1000);
        assertEq(remix.treasuryShareBps(), 1000);
    }

    function test_setSplitRatios_revert_invalidSum() public {
        vm.prank(deployer);
        vm.expectRevert("Must sum to 10000");
        remix.setSplitRatios(5000, 3000, 1000); // sums to 9000
    }
}
