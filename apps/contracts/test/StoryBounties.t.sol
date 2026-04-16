// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/proxy/ERC1967/ERC1967Proxy.sol";
import {StoryBounties} from "../src/revenue/StoryBounties.sol";
import {MockLoarToken} from "./mocks/MockLoarToken.sol";

contract StoryBountiesTest is Test {
    StoryBounties public bounties;
    MockLoarToken public loar;

    address deployer = makeAddr("deployer");
    address treasury = makeAddr("treasury");
    address platform = makeAddr("platform");
    address poster = makeAddr("poster");
    address winner = makeAddr("winner");
    address anyone = makeAddr("anyone");

    uint256 constant REWARD = 100e18;

    function setUp() public {
        loar = new MockLoarToken();

        vm.startPrank(deployer);
        StoryBounties impl = new StoryBounties();
        bounties = StoryBounties(address(new ERC1967Proxy(
            address(impl),
            abi.encodeCall(StoryBounties.initialize, (address(loar), treasury, platform))
        )));
        vm.stopPrank();

        // Fund poster
        loar.mint(poster, 10_000e18);
        vm.prank(poster);
        loar.approve(address(bounties), type(uint256).max);
    }

    // ── Helpers ──

    function _createDefaultBounty() internal returns (uint256) {
        vm.prank(poster);
        return bounties.createBounty(
            1, REWARD, "Test Bounty", "QmHash", "story", block.timestamp + 30 days
        );
    }

    // ── Initialize ──

    function test_initialize() public view {
        assertEq(address(bounties.loarToken()), address(loar));
        assertEq(bounties.treasury(), treasury);
        assertEq(bounties.platform(), platform);
        assertEq(bounties.platformFeeBps(), 500);
        assertEq(bounties.cancellationFeeBps(), 200);
        assertEq(bounties.minBountyAmount(), 10e18);
        assertEq(bounties.owner(), deployer);
    }

    // ── Create Bounty ──

    function test_createBounty() public {
        uint256 posterBalBefore = loar.balanceOf(poster);

        uint256 bountyId = _createDefaultBounty();

        assertEq(bountyId, 0);
        assertEq(loar.balanceOf(address(bounties)), REWARD);
        assertEq(loar.balanceOf(poster), posterBalBefore - REWARD);
        assertEq(bounties.totalBounties(), 1);

        StoryBounties.Bounty memory b = bounties.getBounty(bountyId);
        assertEq(b.poster, poster);
        assertEq(b.reward, REWARD);
        assertEq(b.universeId, 1);
        assertEq(uint8(b.status), uint8(StoryBounties.BountyStatus.OPEN));
    }

    function test_createBounty_revert_amountTooLow() public {
        vm.prank(poster);
        vm.expectRevert(StoryBounties.AmountTooLow.selector);
        bounties.createBounty(1, 5e18, "Low", "QmHash", "story", block.timestamp + 30 days);
    }

    function test_createBounty_revert_invalidDeadline() public {
        // Deadline in the past
        vm.prank(poster);
        vm.expectRevert(StoryBounties.InvalidDeadline.selector);
        bounties.createBounty(1, REWARD, "Bad", "QmHash", "story", block.timestamp - 1);

        // Deadline too far in the future
        vm.prank(poster);
        vm.expectRevert(StoryBounties.InvalidDeadline.selector);
        bounties.createBounty(1, REWARD, "Bad", "QmHash", "story", block.timestamp + 366 days);
    }

    // ── Award Bounty ──

    function test_awardBounty() public {
        uint256 bountyId = _createDefaultBounty();

        uint256 expectedFee = (REWARD * 500) / 10_000; // 5%
        uint256 expectedWinner = REWARD - expectedFee;

        vm.prank(poster);
        bounties.awardBounty(bountyId, winner, bytes32("sub1"));

        assertEq(loar.balanceOf(winner), expectedWinner);
        assertEq(loar.balanceOf(treasury), expectedFee);
        assertEq(loar.balanceOf(address(bounties)), 0);

        StoryBounties.Bounty memory b = bounties.getBounty(bountyId);
        assertEq(uint8(b.status), uint8(StoryBounties.BountyStatus.CLAIMED));
        assertEq(b.claimedBy, winner);
    }

    function test_awardBounty_byPlatform() public {
        uint256 bountyId = _createDefaultBounty();

        vm.prank(platform);
        bounties.awardBounty(bountyId, winner, bytes32("sub1"));

        // Winner should have received 95%
        uint256 expectedWinner = REWARD - (REWARD * 500) / 10_000;
        assertEq(loar.balanceOf(winner), expectedWinner);
    }

    function test_awardBounty_revert_notPoster() public {
        uint256 bountyId = _createDefaultBounty();

        vm.prank(anyone);
        vm.expectRevert(StoryBounties.NotPoster.selector);
        bounties.awardBounty(bountyId, winner, bytes32("sub1"));
    }

    function test_awardBounty_revert_bountyNotOpen() public {
        uint256 bountyId = _createDefaultBounty();

        // Cancel first
        vm.prank(poster);
        bounties.cancelBounty(bountyId);

        // Try to award
        vm.prank(poster);
        vm.expectRevert(StoryBounties.BountyNotOpen.selector);
        bounties.awardBounty(bountyId, winner, bytes32("sub1"));
    }

    // ── Cancel Bounty ──

    function test_cancelBounty() public {
        uint256 bountyId = _createDefaultBounty();
        uint256 posterBalBefore = loar.balanceOf(poster);

        uint256 expectedFee = (REWARD * 200) / 10_000; // 2%
        uint256 expectedRefund = REWARD - expectedFee;

        vm.prank(poster);
        bounties.cancelBounty(bountyId);

        assertEq(loar.balanceOf(poster), posterBalBefore + expectedRefund);
        assertEq(loar.balanceOf(treasury), expectedFee);

        StoryBounties.Bounty memory b = bounties.getBounty(bountyId);
        assertEq(uint8(b.status), uint8(StoryBounties.BountyStatus.CANCELLED));
    }

    function test_cancelBounty_revert_notPoster() public {
        uint256 bountyId = _createDefaultBounty();

        vm.prank(anyone);
        vm.expectRevert(StoryBounties.NotPoster.selector);
        bounties.cancelBounty(bountyId);
    }

    // ── Expire Bounty ──

    function test_expireBounty() public {
        uint256 bountyId = _createDefaultBounty();
        uint256 posterBalBefore = loar.balanceOf(poster);

        StoryBounties.Bounty memory b = bounties.getBounty(bountyId);

        // Warp past deadline
        vm.warp(b.deadline + 1);

        vm.prank(anyone);
        bounties.expireBounty(bountyId);

        // Full refund to poster
        assertEq(loar.balanceOf(poster), posterBalBefore + REWARD);
        assertEq(loar.balanceOf(treasury), 0);

        b = bounties.getBounty(bountyId);
        assertEq(uint8(b.status), uint8(StoryBounties.BountyStatus.EXPIRED));
    }

    function test_expireBounty_revert_deadlineNotPassed() public {
        uint256 bountyId = _createDefaultBounty();

        vm.prank(anyone);
        vm.expectRevert(StoryBounties.DeadlineNotPassed.selector);
        bounties.expireBounty(bountyId);
    }
}
