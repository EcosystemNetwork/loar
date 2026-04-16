// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/proxy/ERC1967/ERC1967Proxy.sol";
import {LaunchpadStaking} from "../src/revenue/LaunchpadStaking.sol";
import {MockLoarToken} from "./mocks/MockLoarToken.sol";

contract LaunchpadStakingTest is Test {
    LaunchpadStaking public staking;
    MockLoarToken public loar;

    address deployer = makeAddr("deployer");
    address treasury = makeAddr("treasury");
    address lp = makeAddr("lp");
    address staker = makeAddr("staker");
    address rewarder = makeAddr("rewarder");

    uint256 constant UNIVERSE_ID = 42;

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
        loar.mint(staker, 1_000_000e18);
        vm.prank(staker);
        loar.approve(address(staking), type(uint256).max);

        // Fund rewarder (owner for distributeUniverseReward)
        loar.mint(deployer, 1_000_000e18);
        vm.prank(deployer);
        loar.approve(address(staking), type(uint256).max);
    }

    // ── Initialize ──

    function test_initialize() public view {
        assertEq(address(staking.loarToken()), address(loar));
        assertEq(staking.treasury(), treasury);
        assertEq(staking.liquidityPool(), lp);
        assertEq(staking.minLockPeriod(), 7 days);
        assertEq(staking.earlyUnstakePenaltyBps(), 500);
        assertEq(staking.owner(), deployer);
    }

    // ── Stake ──

    function test_stake_bronze() public {
        uint256 amount = 1_000e18;

        vm.prank(staker);
        staking.stake(amount);

        assertEq(staking.totalStaked(), amount);
        assertEq(uint8(staking.getUserTier(staker)), uint8(LaunchpadStaking.Tier.BRONZE));
    }

    function test_stake_tierUpgrade() public {
        // Start at BRONZE
        vm.prank(staker);
        staking.stake(1_000e18);
        assertEq(uint8(staking.getUserTier(staker)), uint8(LaunchpadStaking.Tier.BRONZE));

        // Upgrade to SILVER
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

    // ── Unstake ──

    function test_unstake_earlyPenalty() public {
        uint256 amount = 10_000e18;
        vm.prank(staker);
        staking.stake(amount);

        uint256 stakerBalBefore = loar.balanceOf(staker);

        // Unstake within 7 days => 5% penalty
        vm.prank(staker);
        staking.unstake(amount);

        uint256 penalty = (amount * 500) / 10_000; // 5%
        uint256 payout = amount - penalty;

        assertEq(loar.balanceOf(staker), stakerBalBefore + payout);
        assertEq(loar.balanceOf(lp), penalty); // penalty to LP
        assertEq(staking.totalPenaltyCollected(), penalty);
        assertEq(staking.totalStaked(), 0);
    }

    function test_unstake_noPenalty() public {
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

    function test_unstake_tierDowngrade() public {
        // Stake to SILVER
        vm.prank(staker);
        staking.stake(10_000e18);
        assertEq(uint8(staking.getUserTier(staker)), uint8(LaunchpadStaking.Tier.SILVER));

        // Warp past lock period to avoid penalty complexity
        vm.warp(block.timestamp + 7 days + 1);

        // Unstake partial to drop to BRONZE
        vm.prank(staker);
        staking.unstake(9_500e18);
        assertEq(uint8(staking.getUserTier(staker)), uint8(LaunchpadStaking.Tier.NONE));

        // Unstake all remaining
        vm.prank(staker);
        staking.unstake(500e18);
        assertEq(uint8(staking.getUserTier(staker)), uint8(LaunchpadStaking.Tier.NONE));
    }

    // ── Universe Staking ──

    function test_stakeInUniverse() public {
        uint256 amount = 5_000e18;

        vm.prank(staker);
        staking.stakeInUniverse(UNIVERSE_ID, amount);

        (uint256 totalStaked,,) = staking.universePools(UNIVERSE_ID);
        assertEq(totalStaked, amount);
        assertEq(staking.totalUniverseStaked(), amount);
    }

    function test_unstakeFromUniverse_earlyPenalty() public {
        uint256 amount = 5_000e18;

        vm.prank(staker);
        staking.stakeInUniverse(UNIVERSE_ID, amount);

        uint256 stakerBalBefore = loar.balanceOf(staker);

        // Unstake within 7 days => penalty
        vm.prank(staker);
        staking.unstakeFromUniverse(UNIVERSE_ID, amount);

        uint256 penalty = (amount * 500) / 10_000;
        uint256 payout = amount - penalty;

        assertEq(loar.balanceOf(staker), stakerBalBefore + payout);
        assertEq(loar.balanceOf(lp), penalty);
    }

    // ── Universe Rewards ──

    function test_distributeUniverseReward() public {
        uint256 stakeAmount = 10_000e18;
        uint256 rewardAmount = 1_000e18;

        // Staker stakes into universe
        vm.prank(staker);
        staking.stakeInUniverse(UNIVERSE_ID, stakeAmount);

        // Owner distributes rewards
        vm.prank(deployer);
        staking.distributeUniverseReward(UNIVERSE_ID, rewardAmount);

        (,uint256 accRewardPerShare, uint256 totalDistributed) = staking.universePools(UNIVERSE_ID);
        assertEq(totalDistributed, rewardAmount);
        assertEq(accRewardPerShare, (rewardAmount * 1e18) / stakeAmount);
    }

    function test_claimUniverseReward() public {
        uint256 stakeAmount = 10_000e18;
        uint256 rewardAmount = 1_000e18;

        vm.prank(staker);
        staking.stakeInUniverse(UNIVERSE_ID, stakeAmount);

        vm.prank(deployer);
        staking.distributeUniverseReward(UNIVERSE_ID, rewardAmount);

        uint256 stakerBalBefore = loar.balanceOf(staker);

        // Claim
        vm.prank(staker);
        staking.claimUniverseReward(UNIVERSE_ID);

        assertEq(loar.balanceOf(staker), stakerBalBefore + rewardAmount);
    }

    function test_claimUniverseReward_revert_nothingToClaim() public {
        uint256 stakeAmount = 10_000e18;

        vm.prank(staker);
        staking.stakeInUniverse(UNIVERSE_ID, stakeAmount);

        // No rewards distributed yet
        vm.prank(staker);
        vm.expectRevert(LaunchpadStaking.NothingToClaim.selector);
        staking.claimUniverseReward(UNIVERSE_ID);
    }

    // ── View Functions ──

    function test_getUserTier() public {
        assertEq(uint8(staking.getUserTier(staker)), uint8(LaunchpadStaking.Tier.NONE));

        vm.prank(staker);
        staking.stake(1_000e18);
        assertEq(uint8(staking.getUserTier(staker)), uint8(LaunchpadStaking.Tier.BRONZE));
    }

    function test_getFeeDiscount() public {
        assertEq(staking.getFeeDiscount(staker), 0);

        vm.prank(staker);
        staking.stake(1_000e18);
        assertEq(staking.getFeeDiscount(staker), 100); // BRONZE = 1% = 100 bps

        vm.prank(staker);
        staking.stake(9_000e18);
        assertEq(staking.getFeeDiscount(staker), 250); // SILVER = 2.5% = 250 bps
    }

    function test_hasPriorityAccess() public {
        vm.prank(staker);
        staking.stake(1_000e18);
        assertFalse(staking.hasPriorityAccess(staker)); // BRONZE = no priority

        vm.prank(staker);
        staking.stake(9_000e18);
        assertTrue(staking.hasPriorityAccess(staker)); // SILVER = priority
    }
}
