// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/proxy/ERC1967/ERC1967Proxy.sol";
import {StoryBounties} from "../src/revenue/StoryBounties.sol";
import {MockLoarToken} from "./mocks/MockLoarToken.sol";
import {MockPaymentRouter} from "./mocks/MockPaymentRouter.sol";

contract StoryBountiesTest is Test {
    StoryBounties public sb;
    MockLoarToken public loar;
    MockPaymentRouter public router;

    address deployer = makeAddr("deployer");
    address treasury = makeAddr("treasury");
    address platform = makeAddr("platform");
    address poster = makeAddr("poster");
    address poster2 = makeAddr("poster2");
    address winner = makeAddr("winner");
    address anyone = makeAddr("anyone");

    uint256 constant REWARD = 100e18;
    uint256 constant MIN_BOUNTY = 10e18;

    event BountyCreated(uint256 indexed bountyId, address indexed poster, uint256 universeId, uint256 reward, string contentType);
    event BountyClaimed(uint256 indexed bountyId, address indexed winner, uint256 reward, uint256 platformFee);
    event BountyCancelled(uint256 indexed bountyId, uint256 refund, uint256 fee);
    event BountyExpired(uint256 indexed bountyId);

    function setUp() public {
        loar = new MockLoarToken();

        vm.deal(treasury, 1 ether);
        router = new MockPaymentRouter(treasury);

        vm.startPrank(deployer);
        StoryBounties impl = new StoryBounties();
        sb = StoryBounties(address(new ERC1967Proxy(
            address(impl),
            abi.encodeCall(StoryBounties.initialize, (address(loar), treasury, platform))
        )));
        vm.stopPrank();

        // Fund poster and approve
        loar.mint(poster, 100_000e18);
        vm.prank(poster);
        loar.approve(address(sb), type(uint256).max);

        // Fund poster2
        loar.mint(poster2, 100_000e18);
        vm.prank(poster2);
        loar.approve(address(sb), type(uint256).max);
    }

    // ── Helpers ──

    function _createDefaultBounty() internal returns (uint256) {
        vm.prank(poster);
        return sb.createBounty(
            1, REWARD, "Test Bounty", "QmHash", "story", block.timestamp + 30 days
        );
    }

    function _createBounty(address _poster, uint256 universeId, uint256 reward, uint256 deadline)
        internal returns (uint256)
    {
        vm.prank(_poster);
        return sb.createBounty(universeId, reward, "Bounty", "QmHash", "story", deadline);
    }

    // ═══════════════════════════════════════════════════════════
    // ── Initialization
    // ═══════════════════════════════════════════════════════════

    function test_initialize() public view {
        assertEq(address(sb.loarToken()), address(loar));
        assertEq(sb.treasury(), treasury);
        assertEq(sb.platform(), platform);
        assertEq(sb.platformFeeBps(), 500);
        assertEq(sb.cancellationFeeBps(), 200);
        assertEq(sb.minBountyAmount(), MIN_BOUNTY);
        assertEq(sb.owner(), deployer);
        assertEq(sb.nextBountyId(), 0);
        assertEq(sb.totalBounties(), 0);
        assertEq(sb.totalDistributed(), 0);
    }

    function test_initialize_revert_zeroLoarToken() public {
        StoryBounties impl = new StoryBounties();
        vm.expectRevert(StoryBounties.ZeroAddress.selector);
        new ERC1967Proxy(
            address(impl),
            abi.encodeCall(StoryBounties.initialize, (address(0), treasury, platform))
        );
    }

    function test_initialize_revert_zeroTreasury() public {
        StoryBounties impl = new StoryBounties();
        vm.expectRevert(StoryBounties.ZeroAddress.selector);
        new ERC1967Proxy(
            address(impl),
            abi.encodeCall(StoryBounties.initialize, (address(loar), address(0), platform))
        );
    }

    function test_initialize_revert_doubleInit() public {
        vm.expectRevert();
        sb.initialize(address(loar), treasury, platform);
    }

    // ═══════════════════════════════════════════════════════════
    // ── Creating Bounties
    // ═══════════════════════════════════════════════════════════

    function test_createBounty() public {
        uint256 posterBalBefore = loar.balanceOf(poster);

        uint256 bountyId = _createDefaultBounty();

        assertEq(bountyId, 0);
        assertEq(loar.balanceOf(address(sb)), REWARD);
        assertEq(loar.balanceOf(poster), posterBalBefore - REWARD);
        assertEq(sb.totalBounties(), 1);
        assertEq(sb.nextBountyId(), 1);

        StoryBounties.Bounty memory b = sb.getBounty(bountyId);
        assertEq(b.id, 0);
        assertEq(b.poster, poster);
        assertEq(b.reward, REWARD);
        assertEq(b.universeId, 1);
        assertEq(uint8(b.status), uint8(StoryBounties.BountyStatus.OPEN));
        assertEq(b.claimedBy, address(0));
        assertEq(b.submissionHash, bytes32(0));
        assertEq(b.createdAt, block.timestamp);
        assertEq(keccak256(bytes(b.title)), keccak256("Test Bounty"));
        assertEq(keccak256(bytes(b.descriptionHash)), keccak256("QmHash"));
        assertEq(keccak256(bytes(b.contentType)), keccak256("story"));
    }

    function test_createBounty_emitsEvent() public {
        vm.expectEmit(true, true, false, true);
        emit BountyCreated(0, poster, 1, REWARD, "story");

        _createDefaultBounty();
    }

    function test_createBounty_platformWideBounty() public {
        // universeId = 0 means platform-wide
        uint256 bountyId = _createBounty(poster, 0, REWARD, block.timestamp + 30 days);

        StoryBounties.Bounty memory b = sb.getBounty(bountyId);
        assertEq(b.universeId, 0);
    }

    function test_createBounty_exactMinimum() public {
        uint256 bountyId = _createBounty(poster, 1, MIN_BOUNTY, block.timestamp + 30 days);
        StoryBounties.Bounty memory b = sb.getBounty(bountyId);
        assertEq(b.reward, MIN_BOUNTY);
    }

    function test_createBounty_revert_amountTooLow() public {
        vm.prank(poster);
        vm.expectRevert(StoryBounties.AmountTooLow.selector);
        sb.createBounty(1, MIN_BOUNTY - 1, "Low", "QmHash", "story", block.timestamp + 30 days);
    }

    function test_createBounty_revert_deadlineInPast() public {
        vm.prank(poster);
        vm.expectRevert(StoryBounties.InvalidDeadline.selector);
        sb.createBounty(1, REWARD, "Bad", "QmHash", "story", block.timestamp - 1);
    }

    function test_createBounty_revert_deadlineAtCurrentTimestamp() public {
        vm.prank(poster);
        vm.expectRevert(StoryBounties.InvalidDeadline.selector);
        sb.createBounty(1, REWARD, "Bad", "QmHash", "story", block.timestamp);
    }

    function test_createBounty_revert_deadlineTooFar() public {
        vm.prank(poster);
        vm.expectRevert(StoryBounties.InvalidDeadline.selector);
        sb.createBounty(1, REWARD, "Bad", "QmHash", "story", block.timestamp + 366 days);
    }

    function test_createBounty_deadlineAtMaximum() public {
        uint256 bountyId = _createBounty(poster, 1, REWARD, block.timestamp + 365 days);
        StoryBounties.Bounty memory b = sb.getBounty(bountyId);
        assertEq(b.deadline, block.timestamp + 365 days);
    }

    function test_createBounty_revert_insufficientBalance() public {
        address poor = makeAddr("poor");
        loar.mint(poor, 5e18);
        vm.prank(poor);
        loar.approve(address(sb), type(uint256).max);

        vm.prank(poor);
        vm.expectRevert();
        sb.createBounty(1, REWARD, "Need", "QmHash", "story", block.timestamp + 30 days);
    }

    function test_createBounty_tracksUniverseBounties() public {
        uint256 id0 = _createDefaultBounty();
        uint256 id1 = _createDefaultBounty();

        uint256[] memory ids = sb.getUniverseBounties(1);
        assertEq(ids.length, 2);
        assertEq(ids[0], id0);
        assertEq(ids[1], id1);
    }

    // ═══════════════════════════════════════════════════════════
    // ── Awarding Bounties (payout to winner)
    // ═══════════════════════════════════════════════════════════

    function test_awardBounty() public {
        uint256 bountyId = _createDefaultBounty();

        uint256 expectedFee = (REWARD * 500) / 10_000; // 5%
        uint256 expectedWinner = REWARD - expectedFee;

        vm.prank(poster);
        sb.awardBounty(bountyId, winner, bytes32("sub1"));

        assertEq(loar.balanceOf(winner), expectedWinner);
        assertEq(loar.balanceOf(treasury), expectedFee);
        assertEq(loar.balanceOf(address(sb)), 0);
        assertEq(sb.totalDistributed(), expectedWinner);

        StoryBounties.Bounty memory b = sb.getBounty(bountyId);
        assertEq(uint8(b.status), uint8(StoryBounties.BountyStatus.CLAIMED));
        assertEq(b.claimedBy, winner);
        assertEq(b.submissionHash, bytes32("sub1"));
    }

    function test_awardBounty_emitsEvent() public {
        uint256 bountyId = _createDefaultBounty();

        uint256 expectedFee = (REWARD * 500) / 10_000;
        uint256 expectedWinner = REWARD - expectedFee;

        vm.expectEmit(true, true, false, true);
        emit BountyClaimed(bountyId, winner, expectedWinner, expectedFee);

        vm.prank(poster);
        sb.awardBounty(bountyId, winner, bytes32("sub1"));
    }

    function test_awardBounty_byPlatform() public {
        uint256 bountyId = _createDefaultBounty();

        vm.prank(platform);
        sb.awardBounty(bountyId, winner, bytes32("sub1"));

        uint256 expectedWinner = REWARD - (REWARD * 500) / 10_000;
        assertEq(loar.balanceOf(winner), expectedWinner);
    }

    function test_awardBounty_revert_notPoster() public {
        uint256 bountyId = _createDefaultBounty();

        vm.prank(anyone);
        vm.expectRevert(StoryBounties.NotPoster.selector);
        sb.awardBounty(bountyId, winner, bytes32("sub1"));
    }

    function test_awardBounty_revert_zeroWinner() public {
        uint256 bountyId = _createDefaultBounty();

        vm.prank(poster);
        vm.expectRevert(StoryBounties.ZeroAddress.selector);
        sb.awardBounty(bountyId, address(0), bytes32("sub1"));
    }

    function test_awardBounty_revert_bountyNotOpen_cancelled() public {
        uint256 bountyId = _createDefaultBounty();

        vm.prank(poster);
        sb.cancelBounty(bountyId);

        vm.prank(poster);
        vm.expectRevert(StoryBounties.BountyNotOpen.selector);
        sb.awardBounty(bountyId, winner, bytes32("sub1"));
    }

    function test_awardBounty_revert_bountyNotOpen_alreadyClaimed() public {
        uint256 bountyId = _createDefaultBounty();

        vm.prank(poster);
        sb.awardBounty(bountyId, winner, bytes32("sub1"));

        vm.prank(poster);
        vm.expectRevert(StoryBounties.BountyNotOpen.selector);
        sb.awardBounty(bountyId, makeAddr("another"), bytes32("sub2"));
    }

    function test_awardBounty_revert_bountyNotOpen_expired() public {
        uint256 bountyId = _createDefaultBounty();

        StoryBounties.Bounty memory b = sb.getBounty(bountyId);
        vm.warp(b.deadline + 1);

        vm.prank(anyone);
        sb.expireBounty(bountyId);

        vm.prank(poster);
        vm.expectRevert(StoryBounties.BountyNotOpen.selector);
        sb.awardBounty(bountyId, winner, bytes32("sub1"));
    }

    // ── Fee deduction accuracy ─────────────────────────────────

    function test_awardBounty_feeDeduction_accuracy() public {
        // Use a reward that produces non-trivial rounding
        uint256 reward = 333e18;
        uint256 bountyId = _createBounty(poster, 1, reward, block.timestamp + 30 days);

        uint256 expectedFee = (reward * 500) / 10_000;  // 16.65e18
        uint256 expectedWinner = reward - expectedFee;    // 316.35e18

        vm.prank(poster);
        sb.awardBounty(bountyId, winner, bytes32("x"));

        assertEq(loar.balanceOf(winner), expectedWinner);
        assertEq(loar.balanceOf(treasury), expectedFee);
        // No dust left in contract
        assertEq(loar.balanceOf(address(sb)), 0);
    }

    function test_awardBounty_zeroPlatformFee() public {
        vm.prank(deployer);
        sb.setPlatformFee(0);

        uint256 bountyId = _createDefaultBounty();

        vm.prank(poster);
        sb.awardBounty(bountyId, winner, bytes32("sub1"));

        assertEq(loar.balanceOf(winner), REWARD);
        assertEq(loar.balanceOf(treasury), 0);
    }

    // ═══════════════════════════════════════════════════════════
    // ── Cancellation / Refund
    // ═══════════════════════════════════════════════════════════

    function test_cancelBounty() public {
        uint256 bountyId = _createDefaultBounty();
        uint256 posterBalBefore = loar.balanceOf(poster);

        uint256 expectedFee = (REWARD * 200) / 10_000; // 2%
        uint256 expectedRefund = REWARD - expectedFee;

        vm.prank(poster);
        sb.cancelBounty(bountyId);

        assertEq(loar.balanceOf(poster), posterBalBefore + expectedRefund);
        assertEq(loar.balanceOf(treasury), expectedFee);
        assertEq(loar.balanceOf(address(sb)), 0);

        StoryBounties.Bounty memory b = sb.getBounty(bountyId);
        assertEq(uint8(b.status), uint8(StoryBounties.BountyStatus.CANCELLED));
    }

    function test_cancelBounty_emitsEvent() public {
        uint256 bountyId = _createDefaultBounty();

        uint256 expectedFee = (REWARD * 200) / 10_000;
        uint256 expectedRefund = REWARD - expectedFee;

        vm.expectEmit(true, false, false, true);
        emit BountyCancelled(bountyId, expectedRefund, expectedFee);

        vm.prank(poster);
        sb.cancelBounty(bountyId);
    }

    function test_cancelBounty_zeroCancellationFee() public {
        vm.prank(deployer);
        sb.setCancellationFee(0);

        uint256 bountyId = _createDefaultBounty();
        uint256 posterBalBefore = loar.balanceOf(poster);

        vm.prank(poster);
        sb.cancelBounty(bountyId);

        assertEq(loar.balanceOf(poster), posterBalBefore + REWARD);
        assertEq(loar.balanceOf(treasury), 0);
    }

    function test_cancelBounty_revert_notPoster() public {
        uint256 bountyId = _createDefaultBounty();

        vm.prank(anyone);
        vm.expectRevert(StoryBounties.NotPoster.selector);
        sb.cancelBounty(bountyId);
    }

    function test_cancelBounty_revert_alreadyCancelled() public {
        uint256 bountyId = _createDefaultBounty();

        vm.prank(poster);
        sb.cancelBounty(bountyId);

        vm.prank(poster);
        vm.expectRevert(StoryBounties.BountyNotOpen.selector);
        sb.cancelBounty(bountyId);
    }

    function test_cancelBounty_revert_alreadyClaimed() public {
        uint256 bountyId = _createDefaultBounty();

        vm.prank(poster);
        sb.awardBounty(bountyId, winner, bytes32("sub1"));

        vm.prank(poster);
        vm.expectRevert(StoryBounties.BountyNotOpen.selector);
        sb.cancelBounty(bountyId);
    }

    // ═══════════════════════════════════════════════════════════
    // ── Expiry (time-based logic)
    // ═══════════════════════════════════════════════════════════

    function test_expireBounty() public {
        uint256 bountyId = _createDefaultBounty();
        uint256 posterBalBefore = loar.balanceOf(poster);

        StoryBounties.Bounty memory b = sb.getBounty(bountyId);
        vm.warp(b.deadline + 1);

        vm.prank(anyone);
        sb.expireBounty(bountyId);

        // Full refund — no fee on expiry
        assertEq(loar.balanceOf(poster), posterBalBefore + REWARD);
        assertEq(loar.balanceOf(treasury), 0);
        assertEq(loar.balanceOf(address(sb)), 0);

        b = sb.getBounty(bountyId);
        assertEq(uint8(b.status), uint8(StoryBounties.BountyStatus.EXPIRED));
    }

    function test_expireBounty_emitsEvent() public {
        uint256 bountyId = _createDefaultBounty();
        StoryBounties.Bounty memory b = sb.getBounty(bountyId);
        vm.warp(b.deadline + 1);

        vm.expectEmit(true, false, false, false);
        emit BountyExpired(bountyId);

        vm.prank(anyone);
        sb.expireBounty(bountyId);
    }

    function test_expireBounty_exactlyAtDeadline_reverts() public {
        uint256 bountyId = _createDefaultBounty();

        StoryBounties.Bounty memory b = sb.getBounty(bountyId);
        vm.warp(b.deadline); // exactly at deadline, not past it

        vm.prank(anyone);
        vm.expectRevert(StoryBounties.DeadlineNotPassed.selector);
        sb.expireBounty(bountyId);
    }

    function test_expireBounty_revert_deadlineNotPassed() public {
        uint256 bountyId = _createDefaultBounty();

        vm.prank(anyone);
        vm.expectRevert(StoryBounties.DeadlineNotPassed.selector);
        sb.expireBounty(bountyId);
    }

    function test_expireBounty_revert_alreadyExpired() public {
        uint256 bountyId = _createDefaultBounty();

        StoryBounties.Bounty memory b = sb.getBounty(bountyId);
        vm.warp(b.deadline + 1);

        sb.expireBounty(bountyId);

        vm.expectRevert(StoryBounties.BountyNotOpen.selector);
        sb.expireBounty(bountyId);
    }

    function test_expireBounty_anyoneCanCall() public {
        uint256 bountyId = _createDefaultBounty();

        StoryBounties.Bounty memory b = sb.getBounty(bountyId);
        vm.warp(b.deadline + 1);

        // Random address can expire it
        address randomUser = makeAddr("random");
        vm.prank(randomUser);
        sb.expireBounty(bountyId);

        b = sb.getBounty(bountyId);
        assertEq(uint8(b.status), uint8(StoryBounties.BountyStatus.EXPIRED));
    }

    function test_awardBounty_allowedBeforeDeadline() public {
        uint256 bountyId = _createDefaultBounty();

        // Award before deadline — should work
        vm.prank(poster);
        sb.awardBounty(bountyId, winner, bytes32("sub1"));

        assertGt(loar.balanceOf(winner), 0);
    }

    function test_awardBounty_allowedAfterDeadline_ifStillOpen() public {
        // The contract does not check deadline on award — poster can still award after deadline
        // as long as status is OPEN (not expired by someone)
        uint256 bountyId = _createDefaultBounty();
        StoryBounties.Bounty memory b = sb.getBounty(bountyId);

        vm.warp(b.deadline + 100);

        // Nobody called expireBounty, so poster can still award
        vm.prank(poster);
        sb.awardBounty(bountyId, winner, bytes32("sub1"));

        assertGt(loar.balanceOf(winner), 0);
    }

    // ═══════════════════════════════════════════════════════════
    // ── Multiple Bounties
    // ═══════════════════════════════════════════════════════════

    function test_multipleBounties_incrementIds() public {
        uint256 id0 = _createDefaultBounty();
        uint256 id1 = _createDefaultBounty();
        uint256 id2 = _createDefaultBounty();

        assertEq(id0, 0);
        assertEq(id1, 1);
        assertEq(id2, 2);
        assertEq(sb.nextBountyId(), 3);
        assertEq(sb.totalBounties(), 3);
    }

    function test_multipleBounties_independentLifecycles() public {
        uint256 id0 = _createDefaultBounty();
        uint256 id1 = _createDefaultBounty();
        uint256 id2 = _createDefaultBounty();

        // Award #0
        vm.prank(poster);
        sb.awardBounty(id0, winner, bytes32("s0"));

        // Cancel #1
        vm.prank(poster);
        sb.cancelBounty(id1);

        // Expire #2
        StoryBounties.Bounty memory b2 = sb.getBounty(id2);
        vm.warp(b2.deadline + 1);
        sb.expireBounty(id2);

        assertEq(uint8(sb.getBounty(id0).status), uint8(StoryBounties.BountyStatus.CLAIMED));
        assertEq(uint8(sb.getBounty(id1).status), uint8(StoryBounties.BountyStatus.CANCELLED));
        assertEq(uint8(sb.getBounty(id2).status), uint8(StoryBounties.BountyStatus.EXPIRED));
    }

    function test_multipleBounties_differentUniverses() public {
        _createBounty(poster, 1, REWARD, block.timestamp + 30 days);
        _createBounty(poster, 1, REWARD, block.timestamp + 30 days);
        _createBounty(poster, 2, REWARD, block.timestamp + 30 days);
        _createBounty(poster, 0, REWARD, block.timestamp + 30 days); // platform-wide

        assertEq(sb.getUniverseBounties(1).length, 2);
        assertEq(sb.getUniverseBounties(2).length, 1);
        assertEq(sb.getUniverseBounties(0).length, 1);
    }

    function test_multipleBounties_differentPosters() public {
        _createBounty(poster, 1, REWARD, block.timestamp + 30 days);
        _createBounty(poster2, 1, REWARD, block.timestamp + 30 days);

        assertEq(sb.getBounty(0).poster, poster);
        assertEq(sb.getBounty(1).poster, poster2);
    }

    function test_multipleBounties_totalDistributed_accumulates() public {
        uint256 id0 = _createDefaultBounty();
        uint256 id1 = _createDefaultBounty();

        uint256 expectedWinner = REWARD - (REWARD * 500) / 10_000;

        vm.startPrank(poster);
        sb.awardBounty(id0, winner, bytes32("s0"));
        sb.awardBounty(id1, winner, bytes32("s1"));
        vm.stopPrank();

        assertEq(sb.totalDistributed(), expectedWinner * 2);
    }

    // ═══════════════════════════════════════════════════════════
    // ── Views — Pagination
    // ═══════════════════════════════════════════════════════════

    function test_getUniverseBountiesPaginated() public {
        // Create 5 bounties in universe 1
        for (uint256 i = 0; i < 5; i++) {
            _createDefaultBounty();
        }

        (uint256[] memory ids, uint256 total) = sb.getUniverseBountiesPaginated(1, 0, 3);
        assertEq(total, 5);
        assertEq(ids.length, 3);
        assertEq(ids[0], 0);
        assertEq(ids[1], 1);
        assertEq(ids[2], 2);

        (ids, total) = sb.getUniverseBountiesPaginated(1, 3, 3);
        assertEq(total, 5);
        assertEq(ids.length, 2); // only 2 remaining
        assertEq(ids[0], 3);
        assertEq(ids[1], 4);
    }

    function test_getUniverseBountiesPaginated_offsetBeyondTotal() public {
        _createDefaultBounty();

        (uint256[] memory ids, uint256 total) = sb.getUniverseBountiesPaginated(1, 100, 10);
        assertEq(total, 1);
        assertEq(ids.length, 0);
    }

    function test_getUniverseBountiesPaginated_emptyUniverse() public view {
        (uint256[] memory ids, uint256 total) = sb.getUniverseBountiesPaginated(999, 0, 10);
        assertEq(total, 0);
        assertEq(ids.length, 0);
    }

    // ═══════════════════════════════════════════════════════════
    // ── PaymentRouter Integration
    // ═══════════════════════════════════════════════════════════

    function test_awardBounty_withPaymentRouter() public {
        vm.prank(deployer);
        sb.setPaymentRouter(address(router));

        uint256 bountyId = _createDefaultBounty();

        // The MockPaymentRouter.routeLoar is a no-op that accepts the call.
        // Tokens are approved to router via forceApprove.
        // In the mock, routeLoar does nothing with the tokens — so they stay
        // in the StoryBounties contract (mock doesn't transfer). This tests
        // that the code path executes without reverting.
        vm.prank(poster);
        sb.awardBounty(bountyId, winner, bytes32("sub1"));

        StoryBounties.Bounty memory b = sb.getBounty(bountyId);
        assertEq(uint8(b.status), uint8(StoryBounties.BountyStatus.CLAIMED));
        assertEq(b.claimedBy, winner);
    }

    // ═══════════════════════════════════════════════════════════
    // ── Admin Functions
    // ═══════════════════════════════════════════════════════════

    function test_setPlatformFee() public {
        vm.prank(deployer);
        sb.setPlatformFee(1000); // 10%

        assertEq(sb.platformFeeBps(), 1000);
    }

    function test_setPlatformFee_zero() public {
        vm.prank(deployer);
        sb.setPlatformFee(0);

        assertEq(sb.platformFeeBps(), 0);
    }

    function test_setPlatformFee_max() public {
        vm.prank(deployer);
        sb.setPlatformFee(2000); // 20% max

        assertEq(sb.platformFeeBps(), 2000);
    }

    function test_setPlatformFee_revert_tooHigh() public {
        vm.prank(deployer);
        vm.expectRevert("Max 20%");
        sb.setPlatformFee(2001);
    }

    function test_setPlatformFee_revert_notOwner() public {
        vm.prank(anyone);
        vm.expectRevert();
        sb.setPlatformFee(1000);
    }

    function test_setCancellationFee() public {
        vm.prank(deployer);
        sb.setCancellationFee(500); // 5%

        assertEq(sb.cancellationFeeBps(), 500);
    }

    function test_setCancellationFee_max() public {
        vm.prank(deployer);
        sb.setCancellationFee(1000); // 10% max

        assertEq(sb.cancellationFeeBps(), 1000);
    }

    function test_setCancellationFee_revert_tooHigh() public {
        vm.prank(deployer);
        vm.expectRevert("Max 10%");
        sb.setCancellationFee(1001);
    }

    function test_setCancellationFee_revert_notOwner() public {
        vm.prank(anyone);
        vm.expectRevert();
        sb.setCancellationFee(500);
    }

    function test_setMinBountyAmount() public {
        vm.prank(deployer);
        sb.setMinBountyAmount(50e18);

        assertEq(sb.minBountyAmount(), 50e18);
    }

    function test_setMinBountyAmount_revert_notOwner() public {
        vm.prank(anyone);
        vm.expectRevert();
        sb.setMinBountyAmount(50e18);
    }

    function test_setTreasury() public {
        address newTreasury = makeAddr("newTreasury");

        vm.prank(deployer);
        sb.setTreasury(newTreasury);

        assertEq(sb.treasury(), newTreasury);
    }

    function test_setTreasury_revert_zeroAddress() public {
        vm.prank(deployer);
        vm.expectRevert(StoryBounties.ZeroAddress.selector);
        sb.setTreasury(address(0));
    }

    function test_setTreasury_revert_notOwner() public {
        vm.prank(anyone);
        vm.expectRevert();
        sb.setTreasury(makeAddr("x"));
    }

    function test_setPlatform() public {
        address newPlatform = makeAddr("newPlatform");

        vm.prank(deployer);
        sb.setPlatform(newPlatform);

        assertEq(sb.platform(), newPlatform);
    }

    function test_setPlatform_revert_notOwner() public {
        vm.prank(anyone);
        vm.expectRevert();
        sb.setPlatform(makeAddr("x"));
    }

    function test_setPaymentRouter() public {
        vm.prank(deployer);
        sb.setPaymentRouter(address(router));

        assertEq(address(sb.paymentRouter()), address(router));
    }

    function test_setPaymentRouter_revert_notOwner() public {
        vm.prank(anyone);
        vm.expectRevert();
        sb.setPaymentRouter(address(router));
    }

    // ═══════════════════════════════════════════════════════════
    // ── Edge Cases
    // ═══════════════════════════════════════════════════════════

    function test_cancelBounty_afterDeadline_stillWorks() public {
        // The cancel function does not check deadline — poster can cancel
        // even after the deadline (as long as nobody called expire first)
        uint256 bountyId = _createDefaultBounty();

        StoryBounties.Bounty memory b = sb.getBounty(bountyId);
        vm.warp(b.deadline + 100);

        vm.prank(poster);
        sb.cancelBounty(bountyId);

        assertEq(uint8(sb.getBounty(bountyId).status), uint8(StoryBounties.BountyStatus.CANCELLED));
    }

    function test_getBounty_nonExistentId() public view {
        // Returns default struct values for non-existent bounty
        StoryBounties.Bounty memory b = sb.getBounty(9999);
        assertEq(b.poster, address(0));
        assertEq(b.reward, 0);
        assertEq(uint8(b.status), uint8(StoryBounties.BountyStatus.OPEN)); // 0 is OPEN
    }

    function test_contractHoldsCorrectBalance_multipleOpenBounties() public {
        _createBounty(poster, 1, 100e18, block.timestamp + 30 days);
        _createBounty(poster, 1, 200e18, block.timestamp + 30 days);
        _createBounty(poster, 1, 300e18, block.timestamp + 30 days);

        assertEq(loar.balanceOf(address(sb)), 600e18);
    }

    function test_contractBalance_afterMixedOperations() public {
        uint256 id0 = _createBounty(poster, 1, 100e18, block.timestamp + 30 days);
        uint256 id1 = _createBounty(poster, 1, 200e18, block.timestamp + 30 days);
        uint256 id2 = _createBounty(poster, 1, 300e18, block.timestamp + 30 days);

        // Award #0 (100 LOAR out)
        vm.prank(poster);
        sb.awardBounty(id0, winner, bytes32("x"));

        // Cancel #1 (200 LOAR out, minus 2% fee)
        vm.prank(poster);
        sb.cancelBounty(id1);

        // #2 still locked
        assertEq(loar.balanceOf(address(sb)), 300e18);
    }

    function test_largeBountyAmount() public {
        uint256 largeBounty = 1_000_000e18;
        loar.mint(poster, largeBounty);

        uint256 bountyId = _createBounty(poster, 1, largeBounty, block.timestamp + 30 days);

        uint256 expectedFee = (largeBounty * 500) / 10_000;
        uint256 expectedWinner = largeBounty - expectedFee;

        vm.prank(poster);
        sb.awardBounty(bountyId, winner, bytes32("big"));

        assertEq(loar.balanceOf(winner), expectedWinner);
        assertEq(loar.balanceOf(treasury), expectedFee);
    }

    // ── UUPS Upgrade access control ────────────────────────────

    function test_upgradeToAndCall_revert_notOwner() public {
        StoryBounties newImpl = new StoryBounties();

        vm.prank(anyone);
        vm.expectRevert();
        sb.upgradeToAndCall(address(newImpl), "");
    }

    function test_upgradeToAndCall_owner() public {
        StoryBounties newImpl = new StoryBounties();

        vm.prank(deployer);
        sb.upgradeToAndCall(address(newImpl), "");
    }
}
