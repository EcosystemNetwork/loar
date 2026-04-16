// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/proxy/ERC1967/ERC1967Proxy.sol";
import {OwnableUpgradeable} from "@openzeppelin-upgradeable/access/OwnableUpgradeable.sol";
import {Initializable} from "@openzeppelin-upgradeable/proxy/utils/Initializable.sol";
import {LaunchpadStaking} from "../src/revenue/LaunchpadStaking.sol";
import {MockLoarToken} from "./mocks/MockLoarToken.sol";

contract LaunchpadStakingTest is Test {
    LaunchpadStaking public staking;
    MockLoarToken public loar;

    address deployer = makeAddr("deployer");
    address treasury = makeAddr("treasury");
    address lp = makeAddr("lp");
    address staker = makeAddr("staker");
    address staker2 = makeAddr("staker2");
    address rewarder = makeAddr("rewarder");
    address random = makeAddr("random");

    uint256 constant UNIVERSE_ID = 42;
    uint256 constant UNIVERSE_ID_2 = 99;

    function setUp() public {
        loar = new MockLoarToken();

        vm.startPrank(deployer);
        LaunchpadStaking impl = new LaunchpadStaking();
        staking = LaunchpadStaking(address(new ERC1967Proxy(
            address(impl),
            abi.encodeCall(LaunchpadStaking.initialize, (address(loar), treasury, lp))
        )));
        vm.stopPrank();

        // Fund staker and approve
        loar.mint(staker, 2_000_000e18);
        vm.prank(staker);
        loar.approve(address(staking), type(uint256).max);

        // Fund staker2 and approve
        loar.mint(staker2, 2_000_000e18);
        vm.prank(staker2);
        loar.approve(address(staking), type(uint256).max);

        // Fund deployer (owner) for distributeUniverseReward
        loar.mint(deployer, 2_000_000e18);
        vm.prank(deployer);
        loar.approve(address(staking), type(uint256).max);

        // Fund treasury for distributeUniverseReward (treasury is also authorized)
        loar.mint(treasury, 2_000_000e18);
        vm.prank(treasury);
        loar.approve(address(staking), type(uint256).max);
    }

    // ═══════════════════════════════════════════════════════════
    // ── 1. INITIALIZATION ─────────────────────────────────────
    // ═══════════════════════════════════════════════════════════

    function test_initialize_setsAllParameters() public view {
        assertEq(address(staking.loarToken()), address(loar));
        assertEq(staking.treasury(), treasury);
        assertEq(staking.liquidityPool(), lp);
        assertEq(staking.minLockPeriod(), 7 days);
        assertEq(staking.earlyUnstakePenaltyBps(), 500);
        assertEq(staking.owner(), deployer);
    }

    function test_initialize_setsTierConfigs() public view {
        // BRONZE
        (uint256 minStake, uint16 weight, uint16 feeDiscountBps, uint16 curationBoost, bool priorityQueue) =
            staking.tierConfigs(LaunchpadStaking.Tier.BRONZE);
        assertEq(minStake, 1_000e18);
        assertEq(weight, 100);
        assertEq(feeDiscountBps, 100);
        assertEq(curationBoost, 100);
        assertFalse(priorityQueue);

        // SILVER
        (minStake, weight, feeDiscountBps, curationBoost, priorityQueue) =
            staking.tierConfigs(LaunchpadStaking.Tier.SILVER);
        assertEq(minStake, 10_000e18);
        assertEq(weight, 300);
        assertEq(feeDiscountBps, 250);
        assertEq(curationBoost, 150);
        assertTrue(priorityQueue);

        // GOLD
        (minStake, weight, feeDiscountBps, curationBoost, priorityQueue) =
            staking.tierConfigs(LaunchpadStaking.Tier.GOLD);
        assertEq(minStake, 100_000e18);
        assertEq(weight, 1000);
        assertEq(feeDiscountBps, 500);
        assertEq(curationBoost, 200);
        assertTrue(priorityQueue);

        // DIAMOND
        (minStake, weight, feeDiscountBps, curationBoost, priorityQueue) =
            staking.tierConfigs(LaunchpadStaking.Tier.DIAMOND);
        assertEq(minStake, 500_000e18);
        assertEq(weight, 2500);
        assertEq(feeDiscountBps, 1000);
        assertEq(curationBoost, 300);
        assertTrue(priorityQueue);
    }

    function test_initialize_revert_zeroToken() public {
        LaunchpadStaking impl = new LaunchpadStaking();
        vm.expectRevert(LaunchpadStaking.ZeroAddress.selector);
        new ERC1967Proxy(
            address(impl),
            abi.encodeCall(LaunchpadStaking.initialize, (address(0), treasury, lp))
        );
    }

    function test_initialize_revert_zeroTreasury() public {
        LaunchpadStaking impl = new LaunchpadStaking();
        vm.expectRevert(LaunchpadStaking.ZeroAddress.selector);
        new ERC1967Proxy(
            address(impl),
            abi.encodeCall(LaunchpadStaking.initialize, (address(loar), address(0), lp))
        );
    }

    function test_initialize_allowsZeroLiquidityPool() public {
        // liquidityPool can be address(0) — penalty falls back to treasury
        LaunchpadStaking impl2 = new LaunchpadStaking();
        LaunchpadStaking s2 = LaunchpadStaking(address(new ERC1967Proxy(
            address(impl2),
            abi.encodeCall(LaunchpadStaking.initialize, (address(loar), treasury, address(0)))
        )));
        assertEq(s2.liquidityPool(), address(0));
    }

    function test_initialize_revert_doubleInit() public {
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        staking.initialize(address(loar), treasury, lp);
    }

    function test_constructor_disablesInitializers() public {
        LaunchpadStaking impl = new LaunchpadStaking();
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        impl.initialize(address(loar), treasury, lp);
    }

    // ═══════════════════════════════════════════════════════════
    // ── 2. STAKING ────────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════

    function test_stake_bronze() public {
        uint256 amount = 1_000e18;

        vm.expectEmit(true, false, false, true, address(staking));
        emit LaunchpadStaking.Staked(staker, amount, LaunchpadStaking.Tier.BRONZE);

        vm.prank(staker);
        staking.stake(amount);

        assertEq(staking.totalStaked(), amount);
        assertEq(uint8(staking.getUserTier(staker)), uint8(LaunchpadStaking.Tier.BRONZE));
        assertEq(loar.balanceOf(address(staking)), amount);
    }

    function test_stake_tierUpgrade_emitsTierChanged() public {
        // Start at BRONZE
        vm.prank(staker);
        staking.stake(1_000e18);
        assertEq(uint8(staking.getUserTier(staker)), uint8(LaunchpadStaking.Tier.BRONZE));

        // Upgrade to SILVER — expect TierChanged
        vm.expectEmit(true, false, false, true, address(staking));
        emit LaunchpadStaking.TierChanged(staker, LaunchpadStaking.Tier.BRONZE, LaunchpadStaking.Tier.SILVER);

        vm.prank(staker);
        staking.stake(9_000e18);
        assertEq(uint8(staking.getUserTier(staker)), uint8(LaunchpadStaking.Tier.SILVER));

        // Upgrade to GOLD
        vm.prank(staker);
        staking.stake(90_000e18);
        assertEq(uint8(staking.getUserTier(staker)), uint8(LaunchpadStaking.Tier.GOLD));

        // Upgrade to DIAMOND
        vm.prank(staker);
        staking.stake(400_000e18);
        assertEq(uint8(staking.getUserTier(staker)), uint8(LaunchpadStaking.Tier.DIAMOND));

        assertEq(staking.totalStaked(), 500_000e18);
    }

    function test_stake_multipleStakers_trackTierCounts() public {
        // staker stakes to SILVER
        vm.prank(staker);
        staking.stake(10_000e18);

        // staker2 stakes to BRONZE
        vm.prank(staker2);
        staking.stake(1_000e18);

        assertEq(staking.tierCount(LaunchpadStaking.Tier.SILVER), 1);
        assertEq(staking.tierCount(LaunchpadStaking.Tier.BRONZE), 1);
        assertEq(staking.totalStaked(), 11_000e18);
    }

    function test_stake_multipleStakes_preservesTimestamp() public {
        vm.prank(staker);
        staking.stake(1_000e18);

        uint256 firstStakeTime = block.timestamp;

        // Warp forward, add more
        vm.warp(block.timestamp + 3 days);

        vm.prank(staker);
        staking.stake(1_000e18);

        // stakedAt should be the original time
        (uint256 amount, uint256 stakedAt,,) = staking.stakes(staker);
        assertEq(amount, 2_000e18);
        assertEq(stakedAt, firstStakeTime);
    }

    function test_stake_revert_zeroAmount() public {
        vm.prank(staker);
        vm.expectRevert(LaunchpadStaking.ZeroAmount.selector);
        staking.stake(0);
    }

    function test_stake_belowBronze_remainsNone() public {
        vm.prank(staker);
        staking.stake(500e18); // below 1,000 LOAR

        assertEq(uint8(staking.getUserTier(staker)), uint8(LaunchpadStaking.Tier.NONE));
        assertEq(staking.totalStaked(), 500e18);
        // NONE tier should not increment tierCount for NONE
        // Actually, when staking below bronze: oldTier = NONE, newTier = NONE, no tier change
    }

    function test_stake_exactThresholds() public {
        // Exactly BRONZE threshold
        vm.prank(staker);
        staking.stake(1_000e18);
        assertEq(uint8(staking.getUserTier(staker)), uint8(LaunchpadStaking.Tier.BRONZE));

        // Add to exactly SILVER threshold
        vm.prank(staker);
        staking.stake(9_000e18);
        assertEq(uint8(staking.getUserTier(staker)), uint8(LaunchpadStaking.Tier.SILVER));

        // Add to exactly GOLD threshold
        vm.prank(staker);
        staking.stake(90_000e18);
        assertEq(uint8(staking.getUserTier(staker)), uint8(LaunchpadStaking.Tier.GOLD));

        // Add to exactly DIAMOND threshold
        vm.prank(staker);
        staking.stake(400_000e18);
        assertEq(uint8(staking.getUserTier(staker)), uint8(LaunchpadStaking.Tier.DIAMOND));
    }

    // ═══════════════════════════════════════════════════════════
    // ── 3. UNSTAKING ──────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════

    function test_unstake_earlyPenalty() public {
        uint256 amount = 10_000e18;
        vm.prank(staker);
        staking.stake(amount);

        uint256 stakerBalBefore = loar.balanceOf(staker);

        vm.expectEmit(true, false, false, true, address(staking));
        emit LaunchpadStaking.Unstaked(staker, amount, (amount * 500) / 10_000);

        vm.prank(staker);
        staking.unstake(amount);

        uint256 penalty = (amount * 500) / 10_000; // 5%
        uint256 payout = amount - penalty;

        assertEq(loar.balanceOf(staker), stakerBalBefore + payout);
        assertEq(loar.balanceOf(lp), penalty); // penalty to LP
        assertEq(staking.totalPenaltyCollected(), penalty);
        assertEq(staking.totalStaked(), 0);
    }

    function test_unstake_noPenaltyAfterLockPeriod() public {
        uint256 amount = 10_000e18;
        vm.prank(staker);
        staking.stake(amount);

        uint256 stakerBalBefore = loar.balanceOf(staker);

        // Warp past lock period
        vm.warp(block.timestamp + 7 days + 1);

        vm.prank(staker);
        staking.unstake(amount);

        assertEq(loar.balanceOf(staker), stakerBalBefore + amount); // full amount
        assertEq(loar.balanceOf(lp), 0); // no penalty
        assertEq(staking.totalPenaltyCollected(), 0);
    }

    function test_unstake_exactlyAtLockBoundary() public {
        uint256 amount = 10_000e18;
        vm.prank(staker);
        staking.stake(amount);

        // Warp to exactly minLockPeriod (stakedAt + minLockPeriod)
        // block.timestamp < s.stakedAt + minLockPeriod => penalty
        // At exactly the boundary, timestamp == stakedAt + lock => NOT early
        (,uint256 stakedAt,,) = staking.stakes(staker);
        vm.warp(stakedAt + 7 days);

        uint256 stakerBalBefore = loar.balanceOf(staker);
        vm.prank(staker);
        staking.unstake(amount);

        // At exactly the boundary, isEarly is false (not strictly less than)
        assertEq(loar.balanceOf(staker), stakerBalBefore + amount);
        assertEq(staking.totalPenaltyCollected(), 0);
    }

    function test_unstake_tierDowngrade() public {
        // Stake to SILVER
        vm.prank(staker);
        staking.stake(10_000e18);
        assertEq(uint8(staking.getUserTier(staker)), uint8(LaunchpadStaking.Tier.SILVER));
        assertEq(staking.tierCount(LaunchpadStaking.Tier.SILVER), 1);

        // Warp past lock period
        vm.warp(block.timestamp + 7 days + 1);

        // Unstake partial to drop below BRONZE
        vm.prank(staker);
        staking.unstake(9_500e18);
        assertEq(uint8(staking.getUserTier(staker)), uint8(LaunchpadStaking.Tier.NONE));
        assertEq(staking.tierCount(LaunchpadStaking.Tier.SILVER), 0);

        // Unstake remaining
        vm.prank(staker);
        staking.unstake(500e18);
        assertEq(uint8(staking.getUserTier(staker)), uint8(LaunchpadStaking.Tier.NONE));
    }

    function test_unstake_partial_keepsTier() public {
        // Stake to SILVER (10,000)
        vm.prank(staker);
        staking.stake(15_000e18);
        assertEq(uint8(staking.getUserTier(staker)), uint8(LaunchpadStaking.Tier.SILVER));

        vm.warp(block.timestamp + 7 days + 1);

        // Unstake 4,000 — remains at SILVER (11,000 left, >= 10,000)
        vm.prank(staker);
        staking.unstake(4_000e18);
        assertEq(uint8(staking.getUserTier(staker)), uint8(LaunchpadStaking.Tier.SILVER));
        assertEq(staking.totalStaked(), 11_000e18);
    }

    function test_unstake_partial_dropsTier() public {
        // Stake to SILVER (10,000)
        vm.prank(staker);
        staking.stake(10_000e18);

        vm.warp(block.timestamp + 7 days + 1);

        // Unstake 5,000 — drops to BRONZE (5,000 left)
        vm.expectEmit(true, false, false, true, address(staking));
        emit LaunchpadStaking.TierChanged(staker, LaunchpadStaking.Tier.SILVER, LaunchpadStaking.Tier.BRONZE);

        vm.prank(staker);
        staking.unstake(5_000e18);
        assertEq(uint8(staking.getUserTier(staker)), uint8(LaunchpadStaking.Tier.BRONZE));
    }

    function test_unstake_resetsStakedAtWhenFullyUnstaked() public {
        vm.prank(staker);
        staking.stake(1_000e18);

        vm.warp(block.timestamp + 7 days + 1);

        vm.prank(staker);
        staking.unstake(1_000e18);

        (uint256 amount, uint256 stakedAt,,) = staking.stakes(staker);
        assertEq(amount, 0);
        assertEq(stakedAt, 0);
    }

    function test_unstake_revert_nothingStaked() public {
        vm.prank(staker);
        vm.expectRevert(LaunchpadStaking.NothingStaked.selector);
        staking.unstake(1_000e18);
    }

    function test_unstake_revert_insufficientStake() public {
        vm.prank(staker);
        staking.stake(1_000e18);

        vm.prank(staker);
        vm.expectRevert(LaunchpadStaking.InsufficientStake.selector);
        staking.unstake(2_000e18);
    }

    function test_unstake_penaltyToTreasuryWhenNoLP() public {
        // Deploy a new staking with no LP
        vm.startPrank(deployer);
        LaunchpadStaking impl2 = new LaunchpadStaking();
        LaunchpadStaking s2 = LaunchpadStaking(address(new ERC1967Proxy(
            address(impl2),
            abi.encodeCall(LaunchpadStaking.initialize, (address(loar), treasury, address(0)))
        )));
        vm.stopPrank();

        loar.mint(staker, 10_000e18);
        vm.startPrank(staker);
        loar.approve(address(s2), type(uint256).max);
        s2.stake(10_000e18);

        // Early unstake — penalty should go to treasury
        uint256 treasuryBefore = loar.balanceOf(treasury);
        s2.unstake(10_000e18);
        vm.stopPrank();

        uint256 penalty = (10_000e18 * 500) / 10_000;
        assertEq(loar.balanceOf(treasury), treasuryBefore + penalty);
    }

    // ═══════════════════════════════════════════════════════════
    // ── 4. PENALTIES ──────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════

    function test_penalty_calculationAccuracy() public {
        uint256 amount = 7_777e18;
        vm.prank(staker);
        staking.stake(amount);

        uint256 expectedPenalty = (amount * 500) / 10_000;
        uint256 expectedPayout = amount - expectedPenalty;

        uint256 balBefore = loar.balanceOf(staker);
        vm.prank(staker);
        staking.unstake(amount);

        assertEq(loar.balanceOf(staker) - balBefore, expectedPayout);
        assertEq(loar.balanceOf(lp), expectedPenalty);
    }

    function test_penalty_accumulatesAcrossMultipleUnstakes() public {
        // Two stakers each stake and early-unstake
        vm.prank(staker);
        staking.stake(10_000e18);

        vm.prank(staker2);
        staking.stake(20_000e18);

        vm.prank(staker);
        staking.unstake(10_000e18);

        vm.prank(staker2);
        staking.unstake(20_000e18);

        uint256 penalty1 = (10_000e18 * 500) / 10_000;
        uint256 penalty2 = (20_000e18 * 500) / 10_000;
        assertEq(staking.totalPenaltyCollected(), penalty1 + penalty2);
        assertEq(loar.balanceOf(lp), penalty1 + penalty2);
    }

    function test_wouldIncurPenalty_trueWithinLockPeriod() public {
        vm.prank(staker);
        staking.stake(1_000e18);

        assertTrue(staking.wouldIncurPenalty(staker));
    }

    function test_wouldIncurPenalty_falseAfterLockPeriod() public {
        vm.prank(staker);
        staking.stake(1_000e18);

        vm.warp(block.timestamp + 7 days + 1);
        assertFalse(staking.wouldIncurPenalty(staker));
    }

    function test_wouldIncurPenalty_falseWhenNothingStaked() public view {
        assertFalse(staking.wouldIncurPenalty(staker));
    }

    // ═══════════════════════════════════════════════════════════
    // ── 5. UNIVERSE STAKING ───────────────────────────────────
    // ═══════════════════════════════════════════════════════════

    function test_stakeInUniverse_basic() public {
        uint256 amount = 5_000e18;

        vm.expectEmit(true, true, false, true, address(staking));
        emit LaunchpadStaking.UniverseStaked(staker, UNIVERSE_ID, amount);

        vm.prank(staker);
        staking.stakeInUniverse(UNIVERSE_ID, amount);

        (uint256 totalStaked,,) = staking.universePools(UNIVERSE_ID);
        assertEq(totalStaked, amount);
        assertEq(staking.totalUniverseStaked(), amount);
    }

    function test_stakeInUniverse_multipleUsers() public {
        vm.prank(staker);
        staking.stakeInUniverse(UNIVERSE_ID, 5_000e18);

        vm.prank(staker2);
        staking.stakeInUniverse(UNIVERSE_ID, 3_000e18);

        (uint256 totalStaked,,) = staking.universePools(UNIVERSE_ID);
        assertEq(totalStaked, 8_000e18);
        assertEq(staking.totalUniverseStaked(), 8_000e18);
    }

    function test_stakeInUniverse_multipleUniverses() public {
        vm.prank(staker);
        staking.stakeInUniverse(UNIVERSE_ID, 5_000e18);

        vm.prank(staker);
        staking.stakeInUniverse(UNIVERSE_ID_2, 3_000e18);

        (uint256 t1,,) = staking.universePools(UNIVERSE_ID);
        (uint256 t2,,) = staking.universePools(UNIVERSE_ID_2);
        assertEq(t1, 5_000e18);
        assertEq(t2, 3_000e18);
        assertEq(staking.totalUniverseStaked(), 8_000e18);
    }

    function test_stakeInUniverse_revert_zeroAmount() public {
        vm.prank(staker);
        vm.expectRevert(LaunchpadStaking.ZeroAmount.selector);
        staking.stakeInUniverse(UNIVERSE_ID, 0);
    }

    function test_unstakeFromUniverse_earlyPenalty() public {
        uint256 amount = 5_000e18;

        vm.prank(staker);
        staking.stakeInUniverse(UNIVERSE_ID, amount);

        uint256 stakerBalBefore = loar.balanceOf(staker);
        uint256 penalty = (amount * 500) / 10_000;

        vm.expectEmit(true, true, false, true, address(staking));
        emit LaunchpadStaking.UniverseUnstaked(staker, UNIVERSE_ID, amount, penalty);

        vm.prank(staker);
        staking.unstakeFromUniverse(UNIVERSE_ID, amount);

        uint256 payout = amount - penalty;
        assertEq(loar.balanceOf(staker), stakerBalBefore + payout);
        assertEq(loar.balanceOf(lp), penalty);
    }

    function test_unstakeFromUniverse_noPenaltyAfterLock() public {
        uint256 amount = 5_000e18;

        vm.prank(staker);
        staking.stakeInUniverse(UNIVERSE_ID, amount);

        vm.warp(block.timestamp + 7 days + 1);

        uint256 stakerBalBefore = loar.balanceOf(staker);
        vm.prank(staker);
        staking.unstakeFromUniverse(UNIVERSE_ID, amount);

        assertEq(loar.balanceOf(staker), stakerBalBefore + amount);
        assertEq(staking.totalPenaltyCollected(), 0);
    }

    function test_unstakeFromUniverse_partial() public {
        vm.prank(staker);
        staking.stakeInUniverse(UNIVERSE_ID, 10_000e18);

        vm.warp(block.timestamp + 7 days + 1);

        vm.prank(staker);
        staking.unstakeFromUniverse(UNIVERSE_ID, 3_000e18);

        (uint256 totalStaked,,) = staking.universePools(UNIVERSE_ID);
        assertEq(totalStaked, 7_000e18);
        assertEq(staking.totalUniverseStaked(), 7_000e18);
    }

    function test_unstakeFromUniverse_resetsStakedAtWhenFull() public {
        vm.prank(staker);
        staking.stakeInUniverse(UNIVERSE_ID, 5_000e18);

        vm.warp(block.timestamp + 7 days + 1);

        vm.prank(staker);
        staking.unstakeFromUniverse(UNIVERSE_ID, 5_000e18);

        (uint256 uAmount, uint256 uStakedAt,) = staking.universeStakes(staker, UNIVERSE_ID);
        assertEq(uAmount, 0);
        assertEq(uStakedAt, 0);
    }

    function test_unstakeFromUniverse_revert_nothingStaked() public {
        vm.prank(staker);
        vm.expectRevert(LaunchpadStaking.NothingStaked.selector);
        staking.unstakeFromUniverse(UNIVERSE_ID, 1_000e18);
    }

    function test_unstakeFromUniverse_revert_insufficientStake() public {
        vm.prank(staker);
        staking.stakeInUniverse(UNIVERSE_ID, 1_000e18);

        vm.prank(staker);
        vm.expectRevert(LaunchpadStaking.InsufficientStake.selector);
        staking.unstakeFromUniverse(UNIVERSE_ID, 2_000e18);
    }

    // ═══════════════════════════════════════════════════════════
    // ── 6. UNIVERSE REWARDS ───────────────────────────────────
    // ═══════════════════════════════════════════════════════════

    function test_distributeUniverseReward_basic() public {
        uint256 stakeAmount = 10_000e18;
        uint256 rewardAmount = 1_000e18;

        vm.prank(staker);
        staking.stakeInUniverse(UNIVERSE_ID, stakeAmount);

        vm.expectEmit(true, false, false, true, address(staking));
        emit LaunchpadStaking.UniverseRewardDistributed(UNIVERSE_ID, rewardAmount);

        vm.prank(deployer);
        staking.distributeUniverseReward(UNIVERSE_ID, rewardAmount);

        (,uint256 accRewardPerShare, uint256 totalDistributed) = staking.universePools(UNIVERSE_ID);
        assertEq(totalDistributed, rewardAmount);
        assertEq(accRewardPerShare, (rewardAmount * 1e18) / stakeAmount);
    }

    function test_distributeUniverseReward_byTreasury() public {
        vm.prank(staker);
        staking.stakeInUniverse(UNIVERSE_ID, 10_000e18);

        // Treasury is authorized to distribute
        vm.prank(treasury);
        staking.distributeUniverseReward(UNIVERSE_ID, 500e18);

        (,, uint256 totalDistributed) = staking.universePools(UNIVERSE_ID);
        assertEq(totalDistributed, 500e18);
    }

    function test_distributeUniverseReward_revert_unauthorized() public {
        vm.prank(staker);
        staking.stakeInUniverse(UNIVERSE_ID, 10_000e18);

        vm.prank(random);
        vm.expectRevert("Unauthorized");
        staking.distributeUniverseReward(UNIVERSE_ID, 500e18);
    }

    function test_distributeUniverseReward_noStakers_sendsToTreasury() public {
        // No stakers in universe => reward goes directly to treasury
        uint256 treasuryBefore = loar.balanceOf(treasury);

        vm.prank(deployer);
        staking.distributeUniverseReward(UNIVERSE_ID, 1_000e18);

        assertEq(loar.balanceOf(treasury), treasuryBefore + 1_000e18);
        // Pool should be untouched
        (uint256 totalStaked, uint256 accRewardPerShare,) = staking.universePools(UNIVERSE_ID);
        assertEq(totalStaked, 0);
        assertEq(accRewardPerShare, 0);
    }

    function test_claimUniverseReward_singleStaker() public {
        uint256 stakeAmount = 10_000e18;
        uint256 rewardAmount = 1_000e18;

        vm.prank(staker);
        staking.stakeInUniverse(UNIVERSE_ID, stakeAmount);

        vm.prank(deployer);
        staking.distributeUniverseReward(UNIVERSE_ID, rewardAmount);

        uint256 stakerBalBefore = loar.balanceOf(staker);

        vm.expectEmit(true, true, false, true, address(staking));
        emit LaunchpadStaking.UniverseRewardClaimed(staker, UNIVERSE_ID, rewardAmount);

        vm.prank(staker);
        staking.claimUniverseReward(UNIVERSE_ID);

        assertEq(loar.balanceOf(staker), stakerBalBefore + rewardAmount);
    }

    function test_claimUniverseReward_proRataDistribution() public {
        // staker: 75%, staker2: 25%
        vm.prank(staker);
        staking.stakeInUniverse(UNIVERSE_ID, 75_000e18);

        vm.prank(staker2);
        staking.stakeInUniverse(UNIVERSE_ID, 25_000e18);

        uint256 rewardAmount = 10_000e18;
        vm.prank(deployer);
        staking.distributeUniverseReward(UNIVERSE_ID, rewardAmount);

        uint256 bal1Before = loar.balanceOf(staker);
        uint256 bal2Before = loar.balanceOf(staker2);

        vm.prank(staker);
        staking.claimUniverseReward(UNIVERSE_ID);

        vm.prank(staker2);
        staking.claimUniverseReward(UNIVERSE_ID);

        // 75% of 10,000 = 7,500
        assertEq(loar.balanceOf(staker) - bal1Before, 7_500e18);
        // 25% of 10,000 = 2,500
        assertEq(loar.balanceOf(staker2) - bal2Before, 2_500e18);
    }

    function test_claimUniverseReward_multipleDistributions() public {
        vm.prank(staker);
        staking.stakeInUniverse(UNIVERSE_ID, 10_000e18);

        // First distribution
        vm.prank(deployer);
        staking.distributeUniverseReward(UNIVERSE_ID, 1_000e18);

        // Second distribution
        vm.prank(deployer);
        staking.distributeUniverseReward(UNIVERSE_ID, 2_000e18);

        uint256 balBefore = loar.balanceOf(staker);
        vm.prank(staker);
        staking.claimUniverseReward(UNIVERSE_ID);

        // Should receive total of both distributions
        assertEq(loar.balanceOf(staker) - balBefore, 3_000e18);
    }

    function test_claimUniverseReward_nothingToClaim() public {
        vm.prank(staker);
        staking.stakeInUniverse(UNIVERSE_ID, 10_000e18);

        // No rewards distributed yet
        vm.prank(staker);
        vm.expectRevert(LaunchpadStaking.NothingToClaim.selector);
        staking.claimUniverseReward(UNIVERSE_ID);
    }

    function test_claimUniverseReward_revert_nothingStaked() public {
        vm.prank(staker);
        vm.expectRevert(LaunchpadStaking.NothingStaked.selector);
        staking.claimUniverseReward(UNIVERSE_ID);
    }

    function test_claimUniverseReward_doubleClaim() public {
        vm.prank(staker);
        staking.stakeInUniverse(UNIVERSE_ID, 10_000e18);

        vm.prank(deployer);
        staking.distributeUniverseReward(UNIVERSE_ID, 1_000e18);

        // First claim succeeds
        vm.prank(staker);
        staking.claimUniverseReward(UNIVERSE_ID);

        // Second claim reverts (already claimed)
        vm.prank(staker);
        vm.expectRevert(LaunchpadStaking.NothingToClaim.selector);
        staking.claimUniverseReward(UNIVERSE_ID);
    }

    function test_pendingUniverseReward_view() public {
        vm.prank(staker);
        staking.stakeInUniverse(UNIVERSE_ID, 10_000e18);

        vm.prank(deployer);
        staking.distributeUniverseReward(UNIVERSE_ID, 1_000e18);

        assertEq(staking.pendingUniverseReward(staker, UNIVERSE_ID), 1_000e18);

        // After claim, pending should be 0
        vm.prank(staker);
        staking.claimUniverseReward(UNIVERSE_ID);

        assertEq(staking.pendingUniverseReward(staker, UNIVERSE_ID), 0);
    }

    function test_pendingUniverseReward_zeroWhenNotStaked() public view {
        assertEq(staking.pendingUniverseReward(staker, UNIVERSE_ID), 0);
    }

    function test_stakeInUniverse_autoClaimsPending() public {
        vm.prank(staker);
        staking.stakeInUniverse(UNIVERSE_ID, 10_000e18);

        vm.prank(deployer);
        staking.distributeUniverseReward(UNIVERSE_ID, 1_000e18);

        uint256 balBefore = loar.balanceOf(staker);

        // Staking more should auto-claim pending rewards
        vm.prank(staker);
        staking.stakeInUniverse(UNIVERSE_ID, 5_000e18);

        // Should have received 1,000e18 in rewards (auto-claimed) minus 5,000e18 staked
        assertEq(loar.balanceOf(staker), balBefore + 1_000e18 - 5_000e18);

        // Pending should now be 0
        assertEq(staking.pendingUniverseReward(staker, UNIVERSE_ID), 0);
    }

    function test_unstakeFromUniverse_autoClaimsPending() public {
        vm.prank(staker);
        staking.stakeInUniverse(UNIVERSE_ID, 10_000e18);

        vm.prank(deployer);
        staking.distributeUniverseReward(UNIVERSE_ID, 1_000e18);

        vm.warp(block.timestamp + 7 days + 1);

        uint256 balBefore = loar.balanceOf(staker);

        // Unstaking should auto-claim pending rewards
        vm.prank(staker);
        staking.unstakeFromUniverse(UNIVERSE_ID, 5_000e18);

        // Received: 1,000e18 reward + 5,000e18 unstaked
        assertEq(loar.balanceOf(staker), balBefore + 1_000e18 + 5_000e18);
    }

    // ═══════════════════════════════════════════════════════════
    // ── 7. ACCESS CONTROL ─────────────────────────────────────
    // ═══════════════════════════════════════════════════════════

    function test_setTierConfig_onlyOwner() public {
        vm.prank(random);
        vm.expectRevert(abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, random));
        staking.setTierConfig(LaunchpadStaking.Tier.BRONZE, 2_000e18, 200, 150, 120, true);
    }

    function test_setTierConfig_success() public {
        vm.expectEmit(true, false, false, true, address(staking));
        emit LaunchpadStaking.TierConfigChanged(LaunchpadStaking.Tier.BRONZE, 2_000e18, 200, 150, 120, true);

        vm.prank(deployer);
        staking.setTierConfig(LaunchpadStaking.Tier.BRONZE, 2_000e18, 200, 150, 120, true);

        (uint256 minStake, uint16 weight, uint16 feeDiscountBps, uint16 curationBoost, bool priorityQueue) =
            staking.tierConfigs(LaunchpadStaking.Tier.BRONZE);
        assertEq(minStake, 2_000e18);
        assertEq(weight, 200);
        assertEq(feeDiscountBps, 150);
        assertEq(curationBoost, 120);
        assertTrue(priorityQueue);
    }

    function test_setTierConfig_revert_noneTier() public {
        vm.prank(deployer);
        vm.expectRevert("Cannot configure NONE tier");
        staking.setTierConfig(LaunchpadStaking.Tier.NONE, 0, 0, 0, 0, false);
    }

    function test_setMinLockPeriod_onlyOwner() public {
        vm.prank(random);
        vm.expectRevert(abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, random));
        staking.setMinLockPeriod(14 days);
    }

    function test_setMinLockPeriod_success() public {
        vm.expectEmit(false, false, false, true, address(staking));
        emit LaunchpadStaking.MinLockPeriodChanged(7 days, 14 days);

        vm.prank(deployer);
        staking.setMinLockPeriod(14 days);

        assertEq(staking.minLockPeriod(), 14 days);
    }

    function test_setMinLockPeriod_revert_exceedsMax() public {
        vm.prank(deployer);
        vm.expectRevert("Max 90 days");
        staking.setMinLockPeriod(91 days);
    }

    function test_setMinLockPeriod_allowsZero() public {
        vm.prank(deployer);
        staking.setMinLockPeriod(0);
        assertEq(staking.minLockPeriod(), 0);
    }

    function test_setEarlyUnstakePenalty_onlyOwner() public {
        vm.prank(random);
        vm.expectRevert(abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, random));
        staking.setEarlyUnstakePenalty(1000);
    }

    function test_setEarlyUnstakePenalty_success() public {
        vm.expectEmit(false, false, false, true, address(staking));
        emit LaunchpadStaking.EarlyUnstakePenaltyChanged(500, 1000);

        vm.prank(deployer);
        staking.setEarlyUnstakePenalty(1000);

        assertEq(staking.earlyUnstakePenaltyBps(), 1000);
    }

    function test_setEarlyUnstakePenalty_revert_exceedsMax() public {
        vm.prank(deployer);
        vm.expectRevert("Max 20%");
        staking.setEarlyUnstakePenalty(2001);
    }

    function test_setEarlyUnstakePenalty_allowsZero() public {
        vm.prank(deployer);
        staking.setEarlyUnstakePenalty(0);
        assertEq(staking.earlyUnstakePenaltyBps(), 0);
    }

    function test_setTreasury_onlyOwner() public {
        vm.prank(random);
        vm.expectRevert(abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, random));
        staking.setTreasury(random);
    }

    function test_setTreasury_success() public {
        address newTreasury = makeAddr("newTreasury");

        vm.expectEmit(true, true, false, false, address(staking));
        emit LaunchpadStaking.TreasuryChanged(treasury, newTreasury);

        vm.prank(deployer);
        staking.setTreasury(newTreasury);

        assertEq(staking.treasury(), newTreasury);
    }

    function test_setTreasury_revert_zeroAddress() public {
        vm.prank(deployer);
        vm.expectRevert(LaunchpadStaking.ZeroAddress.selector);
        staking.setTreasury(address(0));
    }

    function test_setLiquidityPool_onlyOwner() public {
        vm.prank(random);
        vm.expectRevert(abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, random));
        staking.setLiquidityPool(random);
    }

    function test_setLiquidityPool_success() public {
        address newLP = makeAddr("newLP");

        vm.expectEmit(true, true, false, false, address(staking));
        emit LaunchpadStaking.LiquidityPoolChanged(lp, newLP);

        vm.prank(deployer);
        staking.setLiquidityPool(newLP);

        assertEq(staking.liquidityPool(), newLP);
    }

    function test_setLiquidityPool_allowsZero() public {
        vm.prank(deployer);
        staking.setLiquidityPool(address(0));
        assertEq(staking.liquidityPool(), address(0));
    }

    // ═══════════════════════════════════════════════════════════
    // ── 8. VIEW FUNCTIONS ─────────────────────────────────────
    // ═══════════════════════════════════════════════════════════

    function test_getUserTier_allTiers() public {
        assertEq(uint8(staking.getUserTier(staker)), uint8(LaunchpadStaking.Tier.NONE));

        vm.prank(staker);
        staking.stake(1_000e18);
        assertEq(uint8(staking.getUserTier(staker)), uint8(LaunchpadStaking.Tier.BRONZE));

        vm.prank(staker);
        staking.stake(9_000e18);
        assertEq(uint8(staking.getUserTier(staker)), uint8(LaunchpadStaking.Tier.SILVER));

        vm.prank(staker);
        staking.stake(90_000e18);
        assertEq(uint8(staking.getUserTier(staker)), uint8(LaunchpadStaking.Tier.GOLD));

        vm.prank(staker);
        staking.stake(400_000e18);
        assertEq(uint8(staking.getUserTier(staker)), uint8(LaunchpadStaking.Tier.DIAMOND));
    }

    function test_getAllocationWeight() public {
        assertEq(staking.getAllocationWeight(staker), 0); // NONE

        vm.prank(staker);
        staking.stake(1_000e18);
        assertEq(staking.getAllocationWeight(staker), 100); // BRONZE

        vm.prank(staker);
        staking.stake(9_000e18);
        assertEq(staking.getAllocationWeight(staker), 300); // SILVER

        vm.prank(staker);
        staking.stake(90_000e18);
        assertEq(staking.getAllocationWeight(staker), 1000); // GOLD

        vm.prank(staker);
        staking.stake(400_000e18);
        assertEq(staking.getAllocationWeight(staker), 2500); // DIAMOND
    }

    function test_getFeeDiscount() public {
        assertEq(staking.getFeeDiscount(staker), 0);

        vm.prank(staker);
        staking.stake(1_000e18);
        assertEq(staking.getFeeDiscount(staker), 100); // BRONZE = 1%

        vm.prank(staker);
        staking.stake(9_000e18);
        assertEq(staking.getFeeDiscount(staker), 250); // SILVER = 2.5%
    }

    function test_hasPriorityAccess() public {
        vm.prank(staker);
        staking.stake(1_000e18);
        assertFalse(staking.hasPriorityAccess(staker)); // BRONZE = no priority

        vm.prank(staker);
        staking.stake(9_000e18);
        assertTrue(staking.hasPriorityAccess(staker)); // SILVER = priority
    }

    function test_getCurationBoost() public {
        assertEq(staking.getCurationBoost(staker), 100); // NONE = 1x base

        vm.prank(staker);
        staking.stake(1_000e18);
        assertEq(staking.getCurationBoost(staker), 100); // BRONZE = 1x

        vm.prank(staker);
        staking.stake(9_000e18);
        assertEq(staking.getCurationBoost(staker), 150); // SILVER = 1.5x

        vm.prank(staker);
        staking.stake(90_000e18);
        assertEq(staking.getCurationBoost(staker), 200); // GOLD = 2x

        vm.prank(staker);
        staking.stake(400_000e18);
        assertEq(staking.getCurationBoost(staker), 300); // DIAMOND = 3x
    }

    // ═══════════════════════════════════════════════════════════
    // ── 9. EDGE CASES ─────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════

    function test_restake_afterFullUnstake() public {
        // Stake, unstake fully, then stake again
        vm.prank(staker);
        staking.stake(10_000e18);

        vm.warp(block.timestamp + 7 days + 1);

        vm.prank(staker);
        staking.unstake(10_000e18);

        // Re-stake: should reset stakedAt
        uint256 newTime = block.timestamp + 1 days;
        vm.warp(newTime);

        vm.prank(staker);
        staking.stake(5_000e18);

        (uint256 amount, uint256 stakedAt,,) = staking.stakes(staker);
        assertEq(amount, 5_000e18);
        assertEq(stakedAt, newTime);
        assertEq(uint8(staking.getUserTier(staker)), uint8(LaunchpadStaking.Tier.BRONZE));
    }

    function test_restake_universeAfterFullUnstake() public {
        vm.prank(staker);
        staking.stakeInUniverse(UNIVERSE_ID, 5_000e18);

        vm.warp(block.timestamp + 7 days + 1);

        vm.prank(staker);
        staking.unstakeFromUniverse(UNIVERSE_ID, 5_000e18);

        // Re-stake in same universe
        uint256 newTime = block.timestamp + 1 days;
        vm.warp(newTime);

        vm.prank(staker);
        staking.stakeInUniverse(UNIVERSE_ID, 3_000e18);

        (uint256 uAmount, uint256 uStakedAt,) = staking.universeStakes(staker, UNIVERSE_ID);
        assertEq(uAmount, 3_000e18);
        assertEq(uStakedAt, newTime);
    }

    function test_penaltyWithModifiedRate() public {
        // Owner changes penalty to 10%
        vm.prank(deployer);
        staking.setEarlyUnstakePenalty(1000);

        vm.prank(staker);
        staking.stake(10_000e18);

        uint256 balBefore = loar.balanceOf(staker);
        vm.prank(staker);
        staking.unstake(10_000e18);

        uint256 penalty = (10_000e18 * 1000) / 10_000; // 10%
        assertEq(loar.balanceOf(staker) - balBefore, 10_000e18 - penalty);
        assertEq(loar.balanceOf(lp), penalty);
    }

    function test_zeroPenaltyRate() public {
        // Owner sets penalty to 0
        vm.prank(deployer);
        staking.setEarlyUnstakePenalty(0);

        vm.prank(staker);
        staking.stake(10_000e18);

        uint256 balBefore = loar.balanceOf(staker);
        // Early unstake but 0% penalty
        vm.prank(staker);
        staking.unstake(10_000e18);

        assertEq(loar.balanceOf(staker) - balBefore, 10_000e18);
        assertEq(loar.balanceOf(lp), 0);
        assertEq(staking.totalPenaltyCollected(), 0);
    }

    function test_modifiedLockPeriod_affectsNewStakes() public {
        // Change lock to 14 days
        vm.prank(deployer);
        staking.setMinLockPeriod(14 days);

        vm.prank(staker);
        staking.stake(10_000e18);

        // After 7 days, still early
        vm.warp(block.timestamp + 7 days);
        assertTrue(staking.wouldIncurPenalty(staker));

        // After 14 days + 1, no penalty
        vm.warp(block.timestamp + 7 days + 1);
        assertFalse(staking.wouldIncurPenalty(staker));
    }

    function test_tierConfigChange_affectsNewStakes() public {
        // Lower BRONZE threshold
        vm.prank(deployer);
        staking.setTierConfig(LaunchpadStaking.Tier.BRONZE, 500e18, 100, 100, 100, false);

        // 500 LOAR should now be BRONZE
        vm.prank(staker);
        staking.stake(500e18);
        assertEq(uint8(staking.getUserTier(staker)), uint8(LaunchpadStaking.Tier.BRONZE));
    }

    function test_stake_verySmallAmount() public {
        // Stake 1 wei
        vm.prank(staker);
        staking.stake(1);

        assertEq(staking.totalStaked(), 1);
        assertEq(uint8(staking.getUserTier(staker)), uint8(LaunchpadStaking.Tier.NONE));
    }

    function test_universeReward_lateStakerGetsNoOldRewards() public {
        // staker1 stakes, reward distributed, staker2 joins after
        vm.prank(staker);
        staking.stakeInUniverse(UNIVERSE_ID, 10_000e18);

        vm.prank(deployer);
        staking.distributeUniverseReward(UNIVERSE_ID, 2_000e18);

        // staker2 joins after distribution
        vm.prank(staker2);
        staking.stakeInUniverse(UNIVERSE_ID, 10_000e18);

        // staker2 pending should be 0 (missed the earlier distribution)
        assertEq(staking.pendingUniverseReward(staker2, UNIVERSE_ID), 0);

        // staker should still have full reward
        assertEq(staking.pendingUniverseReward(staker, UNIVERSE_ID), 2_000e18);
    }

    function test_universeReward_newDistributionSplitEvenly() public {
        // Both stakers with equal amounts
        vm.prank(staker);
        staking.stakeInUniverse(UNIVERSE_ID, 10_000e18);

        vm.prank(staker2);
        staking.stakeInUniverse(UNIVERSE_ID, 10_000e18);

        vm.prank(deployer);
        staking.distributeUniverseReward(UNIVERSE_ID, 4_000e18);

        assertEq(staking.pendingUniverseReward(staker, UNIVERSE_ID), 2_000e18);
        assertEq(staking.pendingUniverseReward(staker2, UNIVERSE_ID), 2_000e18);
    }

    function test_globalAndUniverseStakesAreIndependent() public {
        // Global stake
        vm.prank(staker);
        staking.stake(10_000e18);

        // Universe stake
        vm.prank(staker);
        staking.stakeInUniverse(UNIVERSE_ID, 5_000e18);

        // Both tracked independently
        (uint256 globalAmount,,,) = staking.stakes(staker);
        assertEq(globalAmount, 10_000e18);

        (uint256 universeAmount,,) = staking.universeStakes(staker, UNIVERSE_ID);
        assertEq(universeAmount, 5_000e18);

        assertEq(staking.totalStaked(), 10_000e18);
        assertEq(staking.totalUniverseStaked(), 5_000e18);
    }

    // ═══════════════════════════════════════════════════════════
    // ── 10. UPGRADE AUTHORIZATION ─────────────────────────────
    // ═══════════════════════════════════════════════════════════

    function test_upgrade_onlyOwner() public {
        LaunchpadStaking impl2 = new LaunchpadStaking();

        vm.prank(random);
        vm.expectRevert(abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, random));
        staking.upgradeToAndCall(address(impl2), "");
    }

    function test_upgrade_succeeds_asOwner() public {
        LaunchpadStaking impl2 = new LaunchpadStaking();

        vm.prank(deployer);
        staking.upgradeToAndCall(address(impl2), "");

        // State should be preserved after upgrade
        assertEq(address(staking.loarToken()), address(loar));
        assertEq(staking.treasury(), treasury);
        assertEq(staking.owner(), deployer);
    }

    function test_upgrade_preservesStakingState() public {
        // Stake first
        vm.prank(staker);
        staking.stake(10_000e18);

        vm.prank(staker);
        staking.stakeInUniverse(UNIVERSE_ID, 5_000e18);

        // Upgrade
        LaunchpadStaking impl2 = new LaunchpadStaking();
        vm.prank(deployer);
        staking.upgradeToAndCall(address(impl2), "");

        // Verify state preserved
        assertEq(staking.totalStaked(), 10_000e18);
        assertEq(staking.totalUniverseStaked(), 5_000e18);
        assertEq(uint8(staking.getUserTier(staker)), uint8(LaunchpadStaking.Tier.SILVER));
    }

    // ═══════════════════════════════════════════════════════════
    // ── 11. FUZZ TESTS ────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════

    function testFuzz_stake_unstake_balanceInvariant(uint256 amount) public {
        amount = bound(amount, 1, 1_000_000e18);

        uint256 totalBefore = loar.balanceOf(staker) + loar.balanceOf(address(staking)) + loar.balanceOf(lp);

        vm.prank(staker);
        staking.stake(amount);

        // Early unstake (with penalty)
        vm.prank(staker);
        staking.unstake(amount);

        uint256 totalAfter = loar.balanceOf(staker) + loar.balanceOf(address(staking)) + loar.balanceOf(lp);

        // Total token balance across all addresses should be conserved
        assertEq(totalBefore, totalAfter);
    }

    function testFuzz_penaltyNeverExceedsStake(uint256 amount) public {
        amount = bound(amount, 1, 1_000_000e18);

        vm.prank(staker);
        staking.stake(amount);

        uint256 balBefore = loar.balanceOf(staker);
        vm.prank(staker);
        staking.unstake(amount);

        // Staker should always receive something (penalty < 100%)
        assertTrue(loar.balanceOf(staker) > balBefore);
    }

    function testFuzz_tierCalculation(uint256 amount) public {
        amount = bound(amount, 1, 1_000_000e18);

        vm.prank(staker);
        staking.stake(amount);

        LaunchpadStaking.Tier tier = staking.getUserTier(staker);

        if (amount >= 500_000e18) {
            assertEq(uint8(tier), uint8(LaunchpadStaking.Tier.DIAMOND));
        } else if (amount >= 100_000e18) {
            assertEq(uint8(tier), uint8(LaunchpadStaking.Tier.GOLD));
        } else if (amount >= 10_000e18) {
            assertEq(uint8(tier), uint8(LaunchpadStaking.Tier.SILVER));
        } else if (amount >= 1_000e18) {
            assertEq(uint8(tier), uint8(LaunchpadStaking.Tier.BRONZE));
        } else {
            assertEq(uint8(tier), uint8(LaunchpadStaking.Tier.NONE));
        }
    }
}
