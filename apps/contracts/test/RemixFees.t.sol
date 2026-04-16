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
    uint256 constant DEFAULT_FEE = 25e18;
    uint256 constant MIN_FEE = 5e18;
    uint256 constant MAX_FEE = 10_000e18;

    event RemixFeeCharged(
        address indexed remixer,
        address indexed originalCreator,
        uint256 indexed universeId,
        uint256 fee,
        uint256 toCreator,
        uint256 toLp,
        uint256 toTreasury
    );
    event UniverseRemixFeeSet(uint256 indexed universeId, uint256 fee);
    event DefaultRemixFeeUpdated(uint256 oldFee, uint256 newFee);

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
        loar.mint(remixer, 100_000e18);
        vm.prank(remixer);
        loar.approve(address(remix), type(uint256).max);
    }

    // ═══════════════════════════════════════════════════════════
    // ── Initialization
    // ═══════════════════════════════════════════════════════════

    function test_initialize() public view {
        assertEq(address(remix.loarToken()), address(loar));
        assertEq(remix.treasury(), treasury);
        assertEq(remix.liquidityPool(), lp);
        assertEq(remix.platform(), platform);
        assertEq(remix.defaultRemixFee(), DEFAULT_FEE);
        assertEq(remix.minRemixFee(), MIN_FEE);
        assertEq(remix.maxRemixFee(), MAX_FEE);
        assertEq(remix.creatorShareBps(), 7000);
        assertEq(remix.lpShareBps(), 2000);
        assertEq(remix.treasuryShareBps(), 1000);
        assertEq(remix.owner(), deployer);
        assertEq(remix.totalRemixFees(), 0);
        assertEq(remix.totalRemixes(), 0);
        assertEq(remix.totalToCreators(), 0);
        assertEq(remix.totalToLp(), 0);
    }

    function test_initialize_revert_zeroLoarToken() public {
        RemixFees impl = new RemixFees();
        vm.expectRevert(RemixFees.ZeroAddress.selector);
        new ERC1967Proxy(
            address(impl),
            abi.encodeCall(RemixFees.initialize, (address(0), treasury, lp, platform))
        );
    }

    function test_initialize_revert_zeroTreasury() public {
        RemixFees impl = new RemixFees();
        vm.expectRevert(RemixFees.ZeroAddress.selector);
        new ERC1967Proxy(
            address(impl),
            abi.encodeCall(RemixFees.initialize, (address(loar), address(0), lp, platform))
        );
    }

    function test_initialize_revert_doubleInit() public {
        vm.expectRevert();
        remix.initialize(address(loar), treasury, lp, platform);
    }

    // ═══════════════════════════════════════════════════════════
    // ── Charge Remix Fee — basic flow
    // ═══════════════════════════════════════════════════════════

    function test_chargeRemixFee_defaultFee() public {
        uint256 fee = DEFAULT_FEE;
        uint256 toCreator = (fee * 7000) / 10_000;
        uint256 toLp = (fee * 2000) / 10_000;
        uint256 toTreasury = fee - toCreator - toLp;

        uint256 remixerBalBefore = loar.balanceOf(remixer);

        vm.prank(platform);
        remix.chargeRemixFee(remixer, creator, UNIVERSE_ID);

        assertEq(loar.balanceOf(remixer), remixerBalBefore - fee);
        assertEq(loar.balanceOf(creator), toCreator);
        assertEq(loar.balanceOf(lp), toLp);
        assertEq(loar.balanceOf(treasury), toTreasury);
        assertEq(remix.totalRemixes(), 1);
        assertEq(remix.totalRemixFees(), fee);
        assertEq(remix.totalToCreators(), toCreator);
        assertEq(remix.totalToLp(), toLp);
    }

    function test_chargeRemixFee_calledByOwner() public {
        vm.prank(deployer);
        remix.chargeRemixFee(remixer, creator, UNIVERSE_ID);

        assertEq(remix.totalRemixes(), 1);
    }

    function test_chargeRemixFee_emitsEvent() public {
        uint256 fee = DEFAULT_FEE;
        uint256 toCreator = (fee * 7000) / 10_000;
        uint256 toLp = (fee * 2000) / 10_000;
        uint256 toTreasury = fee - toCreator - toLp;

        vm.expectEmit(true, true, true, true);
        emit RemixFeeCharged(remixer, creator, UNIVERSE_ID, fee, toCreator, toLp, toTreasury);

        vm.prank(platform);
        remix.chargeRemixFee(remixer, creator, UNIVERSE_ID);
    }

    // ── Fee calculation accuracy (split math) ──────────────────

    function test_chargeRemixFee_splitAccuracy_noRemainder() public {
        // 100 LOAR: 70 + 20 + 10 = 100 exactly
        vm.prank(creator);
        remix.setUniverseRemixFee(UNIVERSE_ID, 100e18);

        vm.prank(platform);
        remix.chargeRemixFee(remixer, creator, UNIVERSE_ID);

        assertEq(loar.balanceOf(creator), 70e18);
        assertEq(loar.balanceOf(lp), 20e18);
        assertEq(loar.balanceOf(treasury), 10e18);
    }

    function test_chargeRemixFee_splitAccuracy_withRounding() public {
        // 33 LOAR: 70% = 23.1, 20% = 6.6, treasury gets remainder
        // Integer: 33e18 * 7000 / 10000 = 23.1e18, 33e18 * 2000 / 10000 = 6.6e18
        // treasury = 33e18 - 23.1e18 - 6.6e18 = 3.3e18
        vm.prank(creator);
        remix.setUniverseRemixFee(UNIVERSE_ID, 33e18);

        vm.prank(platform);
        remix.chargeRemixFee(remixer, creator, UNIVERSE_ID);

        uint256 expectedCreator = (33e18 * 7000) / 10_000;
        uint256 expectedLp = (33e18 * 2000) / 10_000;
        uint256 expectedTreasury = 33e18 - expectedCreator - expectedLp;

        assertEq(loar.balanceOf(creator), expectedCreator);
        assertEq(loar.balanceOf(lp), expectedLp);
        assertEq(loar.balanceOf(treasury), expectedTreasury);
        // Verify total adds up exactly
        assertEq(expectedCreator + expectedLp + expectedTreasury, 33e18);
    }

    function test_chargeRemixFee_splitAccuracy_customSplit() public {
        // 50/30/20 split on 100 LOAR
        vm.prank(deployer);
        remix.setSplitRatios(5000, 3000, 2000);

        vm.prank(platform);
        remix.chargeRemixFee(remixer, creator, UNIVERSE_ID);

        uint256 fee = DEFAULT_FEE;
        assertEq(loar.balanceOf(creator), (fee * 5000) / 10_000);
        assertEq(loar.balanceOf(lp), (fee * 3000) / 10_000);
        assertEq(loar.balanceOf(treasury), fee - (fee * 5000) / 10_000 - (fee * 3000) / 10_000);
    }

    // ── LOAR distribution splits ───────────────────────────────

    function test_chargeRemixFee_noLpPool_lpShareGoesToTreasury() public {
        vm.prank(deployer);
        remix.setLiquidityPool(address(0));

        uint256 fee = DEFAULT_FEE;
        uint256 toCreator = (fee * 7000) / 10_000;
        uint256 expectedTreasury = fee - toCreator;

        vm.prank(platform);
        remix.chargeRemixFee(remixer, creator, UNIVERSE_ID);

        assertEq(loar.balanceOf(creator), toCreator);
        assertEq(loar.balanceOf(treasury), expectedTreasury);
        assertEq(remix.totalToLp(), 0);
    }

    function test_chargeRemixFee_100PercentCreatorShare() public {
        vm.prank(deployer);
        remix.setSplitRatios(10_000, 0, 0);

        vm.prank(platform);
        remix.chargeRemixFee(remixer, creator, UNIVERSE_ID);

        assertEq(loar.balanceOf(creator), DEFAULT_FEE);
        assertEq(loar.balanceOf(lp), 0);
        assertEq(loar.balanceOf(treasury), 0);
    }

    function test_chargeRemixFee_100PercentTreasuryShare() public {
        vm.prank(deployer);
        remix.setSplitRatios(0, 0, 10_000);

        vm.prank(platform);
        remix.chargeRemixFee(remixer, creator, UNIVERSE_ID);

        assertEq(loar.balanceOf(creator), 0);
        assertEq(loar.balanceOf(lp), 0);
        assertEq(loar.balanceOf(treasury), DEFAULT_FEE);
    }

    // ── Self-remix (edge case) ─────────────────────────────────

    function test_chargeRemixFee_skipsSelfRemix() public {
        uint256 remixerBalBefore = loar.balanceOf(remixer);

        vm.prank(platform);
        remix.chargeRemixFee(remixer, remixer, UNIVERSE_ID);

        assertEq(loar.balanceOf(remixer), remixerBalBefore);
        assertEq(remix.totalRemixes(), 0);
        assertEq(remix.totalRemixFees(), 0);
    }

    // ── Access control ─────────────────────────────────────────

    function test_chargeRemixFee_revert_notAuthorized() public {
        vm.prank(anyone);
        vm.expectRevert(RemixFees.NotAuthorized.selector);
        remix.chargeRemixFee(remixer, creator, UNIVERSE_ID);
    }

    function test_chargeRemixFee_revert_zeroRemixer() public {
        vm.prank(platform);
        vm.expectRevert(RemixFees.ZeroAddress.selector);
        remix.chargeRemixFee(address(0), creator, UNIVERSE_ID);
    }

    function test_chargeRemixFee_revert_zeroCreator() public {
        vm.prank(platform);
        vm.expectRevert(RemixFees.ZeroAddress.selector);
        remix.chargeRemixFee(remixer, address(0), UNIVERSE_ID);
    }

    function test_chargeRemixFee_revert_insufficientBalance() public {
        address poorRemixer = makeAddr("poor");
        loar.mint(poorRemixer, 1e18); // less than 25 LOAR default fee
        vm.prank(poorRemixer);
        loar.approve(address(remix), type(uint256).max);

        vm.prank(platform);
        vm.expectRevert(); // SafeERC20 will revert on transferFrom
        remix.chargeRemixFee(poorRemixer, creator, UNIVERSE_ID);
    }

    function test_chargeRemixFee_revert_noApproval() public {
        address noApproval = makeAddr("noapproval");
        loar.mint(noApproval, 100e18);
        // No approve call

        vm.prank(platform);
        vm.expectRevert(); // SafeERC20 will revert on transferFrom
        remix.chargeRemixFee(noApproval, creator, UNIVERSE_ID);
    }

    // ── Multiple remixes (accumulation) ────────────────────────

    function test_chargeRemixFee_multipleAccumulations() public {
        vm.startPrank(platform);
        remix.chargeRemixFee(remixer, creator, UNIVERSE_ID);
        remix.chargeRemixFee(remixer, creator, UNIVERSE_ID);
        remix.chargeRemixFee(remixer, creator, UNIVERSE_ID);
        vm.stopPrank();

        assertEq(remix.totalRemixes(), 3);
        assertEq(remix.totalRemixFees(), DEFAULT_FEE * 3);
        assertEq(remix.totalToCreators(), (DEFAULT_FEE * 7000 / 10_000) * 3);
        assertEq(remix.totalToLp(), (DEFAULT_FEE * 2000 / 10_000) * 3);
    }

    // ═══════════════════════════════════════════════════════════
    // ── Universe Config
    // ═══════════════════════════════════════════════════════════

    function test_setUniverseRemixFee_byCreator() public {
        uint256 customFee = 50e18;

        vm.prank(creator);
        remix.setUniverseRemixFee(UNIVERSE_ID, customFee);

        assertEq(remix.getRemixFee(UNIVERSE_ID), customFee);
    }

    function test_setUniverseRemixFee_byPlatform() public {
        vm.prank(platform);
        remix.setUniverseRemixFee(UNIVERSE_ID, 100e18);

        assertEq(remix.getRemixFee(UNIVERSE_ID), 100e18);
    }

    function test_setUniverseRemixFee_byOwner() public {
        vm.prank(deployer);
        remix.setUniverseRemixFee(UNIVERSE_ID, 100e18);

        assertEq(remix.getRemixFee(UNIVERSE_ID), 100e18);
    }

    function test_setUniverseRemixFee_emitsEvent() public {
        vm.expectEmit(true, false, false, true);
        emit UniverseRemixFeeSet(UNIVERSE_ID, 50e18);

        vm.prank(creator);
        remix.setUniverseRemixFee(UNIVERSE_ID, 50e18);
    }

    function test_setUniverseRemixFee_usedDuringCharge() public {
        uint256 customFee = 50e18;

        vm.prank(creator);
        remix.setUniverseRemixFee(UNIVERSE_ID, customFee);

        vm.prank(platform);
        remix.chargeRemixFee(remixer, creator, UNIVERSE_ID);

        assertEq(remix.totalRemixFees(), customFee);
    }

    function test_setUniverseRemixFee_zeroAllowed() public {
        // Fee of 0 is allowed (free remixes) — bypasses minimum check
        vm.prank(creator);
        remix.setUniverseRemixFee(UNIVERSE_ID, 0);

        assertEq(remix.getRemixFee(UNIVERSE_ID), 0);

        // Charge should be a no-op when fee is 0
        uint256 balBefore = loar.balanceOf(remixer);
        vm.prank(platform);
        remix.chargeRemixFee(remixer, creator, UNIVERSE_ID);

        assertEq(loar.balanceOf(remixer), balBefore);
    }

    function test_setUniverseRemixFee_atMinimum() public {
        vm.prank(creator);
        remix.setUniverseRemixFee(UNIVERSE_ID, MIN_FEE);

        assertEq(remix.getRemixFee(UNIVERSE_ID), MIN_FEE);
    }

    function test_setUniverseRemixFee_atMaximum() public {
        vm.prank(creator);
        remix.setUniverseRemixFee(UNIVERSE_ID, MAX_FEE);

        assertEq(remix.getRemixFee(UNIVERSE_ID), MAX_FEE);
    }

    function test_setUniverseRemixFee_revert_belowMinimum() public {
        vm.prank(creator);
        vm.expectRevert(RemixFees.FeeBelowMinimum.selector);
        remix.setUniverseRemixFee(UNIVERSE_ID, 1e18);
    }

    function test_setUniverseRemixFee_revert_aboveMaximum() public {
        vm.prank(creator);
        vm.expectRevert(RemixFees.FeeAboveMaximum.selector);
        remix.setUniverseRemixFee(UNIVERSE_ID, MAX_FEE + 1);
    }

    function test_setUniverseRemixFee_revert_notCreatorOrPlatform() public {
        vm.prank(anyone);
        vm.expectRevert(RemixFees.NotCreatorOrPlatform.selector);
        remix.setUniverseRemixFee(UNIVERSE_ID, 50e18);
    }

    function test_getRemixFee_returnsDefault_noCustomConfig() public view {
        // Universe 999 has no config
        assertEq(remix.getRemixFee(999), DEFAULT_FEE);
    }

    // ── Register universe ──────────────────────────────────────

    function test_registerUniverse_byPlatform() public {
        address newCreator = makeAddr("newCreator");

        vm.prank(platform);
        remix.registerUniverse(42, newCreator);

        assertEq(remix.universeCreators(42), newCreator);
    }

    function test_registerUniverse_byOwner() public {
        address newCreator = makeAddr("newCreator");

        vm.prank(deployer);
        remix.registerUniverse(42, newCreator);

        assertEq(remix.universeCreators(42), newCreator);
    }

    function test_registerUniverse_revert_unauthorized() public {
        vm.prank(anyone);
        vm.expectRevert("Unauthorized");
        remix.registerUniverse(42, anyone);
    }

    // ═══════════════════════════════════════════════════════════
    // ── Admin Functions
    // ═══════════════════════════════════════════════════════════

    function test_setDefaultRemixFee() public {
        vm.expectEmit(false, false, false, true);
        emit DefaultRemixFeeUpdated(DEFAULT_FEE, 50e18);

        vm.prank(deployer);
        remix.setDefaultRemixFee(50e18);

        assertEq(remix.defaultRemixFee(), 50e18);
    }

    function test_setDefaultRemixFee_revert_notOwner() public {
        vm.prank(anyone);
        vm.expectRevert();
        remix.setDefaultRemixFee(50e18);
    }

    function test_setMinRemixFee() public {
        vm.prank(deployer);
        remix.setMinRemixFee(10e18);

        assertEq(remix.minRemixFee(), 10e18);
    }

    function test_setMinRemixFee_revert_notOwner() public {
        vm.prank(anyone);
        vm.expectRevert();
        remix.setMinRemixFee(10e18);
    }

    function test_setMaxRemixFee() public {
        vm.prank(deployer);
        remix.setMaxRemixFee(50_000e18);

        assertEq(remix.maxRemixFee(), 50_000e18);
    }

    function test_setMaxRemixFee_revert_notOwner() public {
        vm.prank(anyone);
        vm.expectRevert();
        remix.setMaxRemixFee(50_000e18);
    }

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
        remix.setSplitRatios(5000, 3000, 1000);
    }

    function test_setSplitRatios_revert_notOwner() public {
        vm.prank(anyone);
        vm.expectRevert();
        remix.setSplitRatios(7000, 2000, 1000);
    }

    function test_setTreasury() public {
        address newTreasury = makeAddr("newTreasury");

        vm.prank(deployer);
        remix.setTreasury(newTreasury);

        assertEq(remix.treasury(), newTreasury);
    }

    function test_setTreasury_revert_zeroAddress() public {
        vm.prank(deployer);
        vm.expectRevert(RemixFees.ZeroAddress.selector);
        remix.setTreasury(address(0));
    }

    function test_setTreasury_revert_notOwner() public {
        vm.prank(anyone);
        vm.expectRevert();
        remix.setTreasury(makeAddr("x"));
    }

    function test_setLiquidityPool() public {
        address newLp = makeAddr("newLp");

        vm.prank(deployer);
        remix.setLiquidityPool(newLp);

        assertEq(remix.liquidityPool(), newLp);
    }

    function test_setLiquidityPool_zeroAllowed() public {
        vm.prank(deployer);
        remix.setLiquidityPool(address(0));

        assertEq(remix.liquidityPool(), address(0));
    }

    function test_setLiquidityPool_revert_notOwner() public {
        vm.prank(anyone);
        vm.expectRevert();
        remix.setLiquidityPool(makeAddr("x"));
    }

    function test_setPlatform() public {
        address newPlatform = makeAddr("newPlatform");

        vm.prank(deployer);
        remix.setPlatform(newPlatform);

        assertEq(remix.platform(), newPlatform);
    }

    function test_setPlatform_revert_notOwner() public {
        vm.prank(anyone);
        vm.expectRevert();
        remix.setPlatform(makeAddr("x"));
    }

    // ═══════════════════════════════════════════════════════════
    // ── Edge Cases
    // ═══════════════════════════════════════════════════════════

    function test_chargeRemixFee_unregisteredUniverse_usesDefault() public {
        uint256 unknownUniverse = 9999;

        vm.prank(platform);
        remix.chargeRemixFee(remixer, creator, unknownUniverse);

        assertEq(remix.totalRemixFees(), DEFAULT_FEE);
    }

    function test_chargeRemixFee_customFeeOverridesDefault() public {
        uint256 customFee = 200e18;

        vm.prank(creator);
        remix.setUniverseRemixFee(UNIVERSE_ID, customFee);

        vm.prank(platform);
        remix.chargeRemixFee(remixer, creator, UNIVERSE_ID);

        assertEq(remix.totalRemixFees(), customFee);
        assertEq(loar.balanceOf(creator), (customFee * 7000) / 10_000);
    }

    function test_chargeRemixFee_contractHoldsNoDust() public {
        // After a charge, the contract should hold 0 tokens
        vm.prank(platform);
        remix.chargeRemixFee(remixer, creator, UNIVERSE_ID);

        assertEq(loar.balanceOf(address(remix)), 0);
    }

    function test_chargeRemixFee_contractHoldsNoDust_noLp() public {
        vm.prank(deployer);
        remix.setLiquidityPool(address(0));

        vm.prank(platform);
        remix.chargeRemixFee(remixer, creator, UNIVERSE_ID);

        assertEq(loar.balanceOf(address(remix)), 0);
    }

    function test_setUniverseRemixFee_overwrite() public {
        vm.prank(creator);
        remix.setUniverseRemixFee(UNIVERSE_ID, 50e18);
        assertEq(remix.getRemixFee(UNIVERSE_ID), 50e18);

        vm.prank(creator);
        remix.setUniverseRemixFee(UNIVERSE_ID, 100e18);
        assertEq(remix.getRemixFee(UNIVERSE_ID), 100e18);
    }

    function test_chargeRemixFee_minFee_boundary() public {
        vm.prank(creator);
        remix.setUniverseRemixFee(UNIVERSE_ID, MIN_FEE);

        vm.prank(platform);
        remix.chargeRemixFee(remixer, creator, UNIVERSE_ID);

        assertEq(remix.totalRemixFees(), MIN_FEE);
    }

    function test_chargeRemixFee_maxFee_boundary() public {
        vm.prank(creator);
        remix.setUniverseRemixFee(UNIVERSE_ID, MAX_FEE);

        // Fund enough
        loar.mint(remixer, MAX_FEE);

        vm.prank(platform);
        remix.chargeRemixFee(remixer, creator, UNIVERSE_ID);

        assertEq(remix.totalRemixFees(), MAX_FEE);
    }

    // ── UUPS Upgrade access control ────────────────────────────

    function test_upgradeToAndCall_revert_notOwner() public {
        RemixFees newImpl = new RemixFees();

        vm.prank(anyone);
        vm.expectRevert();
        remix.upgradeToAndCall(address(newImpl), "");
    }

    function test_upgradeToAndCall_owner() public {
        RemixFees newImpl = new RemixFees();

        vm.prank(deployer);
        remix.upgradeToAndCall(address(newImpl), "");
        // Should succeed without revert
    }
}
