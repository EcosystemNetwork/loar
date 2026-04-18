// SPDX-License-Identifier: UNLICENSED
pragma solidity =0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/proxy/ERC1967/ERC1967Proxy.sol";
import {AdPlacement} from "../src/revenue/AdPlacement.sol";
import {MockPaymentRouter} from "./mocks/MockPaymentRouter.sol";

/// @dev Minimal ERC721 mock that returns a configurable owner for ownerOf()
contract MockERC721Owner {
    mapping(uint256 => address) public owners;

    function setOwner(uint256 tokenId, address owner) external {
        owners[tokenId] = owner;
    }

    function ownerOf(uint256 tokenId) external view returns (address) {
        address o = owners[tokenId];
        require(o != address(0), "ERC721: invalid token ID");
        return o;
    }
}

contract AdPlacementTest is Test {
    AdPlacement public ad;
    MockPaymentRouter public router;
    MockERC721Owner public mockUniverse;

    address platform = makeAddr("platform");
    address treasury = makeAddr("treasury");
    address creator = makeAddr("creator");
    address bidder1 = makeAddr("bidder1");
    address bidder2 = makeAddr("bidder2");
    address bidder3 = makeAddr("bidder3");
    address stranger = makeAddr("stranger");

    uint256 constant UNIVERSE_ID = 1;
    uint16 constant FEE_BPS = 500;
    uint256 constant MIN_BID = 0.1 ether;

    function setUp() public {
        vm.deal(treasury, 0);
        vm.deal(bidder1, 100 ether);
        vm.deal(bidder2, 100 ether);
        vm.deal(bidder3, 100 ether);

        router = new MockPaymentRouter(treasury);
        mockUniverse = new MockERC721Owner();

        AdPlacement impl = new AdPlacement();
        ad = AdPlacement(
            address(
                new ERC1967Proxy(
                    address(impl),
                    abi.encodeCall(AdPlacement.initialize, (platform, address(router), FEE_BPS))
                )
            )
        );

        // Set up mock universe ownership and register
        ad.setUniverseManager(address(mockUniverse));
        mockUniverse.setOwner(UNIVERSE_ID, creator);

        vm.prank(platform);
        ad.registerUniverse(UNIVERSE_ID);
    }

    // =========================================================================
    //                          INITIALIZE
    // =========================================================================

    function test_initialize() public view {
        assertEq(ad.platform(), platform);
        assertEq(address(ad.paymentRouter()), address(router));
        assertEq(ad.platformFeeBps(), FEE_BPS);
    }

    function test_initialize_revert_zeroAddressPlatform() public {
        AdPlacement impl = new AdPlacement();
        vm.expectRevert(AdPlacement.ZeroAddress.selector);
        new ERC1967Proxy(
            address(impl),
            abi.encodeCall(AdPlacement.initialize, (address(0), address(router), FEE_BPS))
        );
    }

    function test_initialize_revert_zeroAddressRouter() public {
        AdPlacement impl = new AdPlacement();
        vm.expectRevert(AdPlacement.ZeroAddress.selector);
        new ERC1967Proxy(
            address(impl),
            abi.encodeCall(AdPlacement.initialize, (platform, address(0), FEE_BPS))
        );
    }

    function test_initialize_revert_feeTooHigh() public {
        AdPlacement impl = new AdPlacement();
        vm.expectRevert(AdPlacement.FeeTooHigh.selector);
        new ERC1967Proxy(
            address(impl),
            abi.encodeCall(AdPlacement.initialize, (platform, address(router), 5001))
        );
    }

    function test_initialize_maxFee() public {
        AdPlacement impl = new AdPlacement();
        AdPlacement ad2 = AdPlacement(address(new ERC1967Proxy(
            address(impl),
            abi.encodeCall(AdPlacement.initialize, (platform, address(router), 5000))
        )));
        assertEq(ad2.platformFeeBps(), 5000);
    }

    function test_cannotReinitialize() public {
        vm.expectRevert();
        ad.initialize(platform, address(router), FEE_BPS);
    }

    // =========================================================================
    //                          REGISTER UNIVERSE
    // =========================================================================

    function test_registerUniverse() public {
        mockUniverse.setOwner(99, creator);
        vm.prank(platform);
        ad.registerUniverse(99);
        assertEq(ad.universeCreators(99), creator);
    }

    function test_registerUniverse_revert_notPlatform() public {
        mockUniverse.setOwner(99, creator);
        vm.prank(stranger);
        vm.expectRevert(AdPlacement.NotPlatform.selector);
        ad.registerUniverse(99);
    }

    function test_registerUniverse_revert_unknownUniverse() public {
        // Universe 99 has no owner set in mock, so ownerOf reverts
        vm.prank(platform);
        vm.expectRevert();
        ad.registerUniverse(99);
    }

    // =========================================================================
    //                          CREATE AD SLOT
    // =========================================================================

    function test_createAdSlot() public {
        vm.prank(creator);
        uint256 slotId = ad.createAdSlot(
            UNIVERSE_ID,
            AdPlacement.PlacementType.BILLBOARD,
            MIN_BID,
            10,
            "billboard-meta"
        );

        (
            uint256 id,
            uint256 universeId,
            AdPlacement.PlacementType placementType,
            uint256 minBid,
            uint256 currentBid,
            address currentBidder,
            , // metadata
            uint256 episodesRemaining,
            bool active
        ) = ad.adSlots(slotId);

        assertEq(id, slotId);
        assertEq(universeId, UNIVERSE_ID);
        assertEq(uint8(placementType), uint8(AdPlacement.PlacementType.BILLBOARD));
        assertEq(minBid, MIN_BID);
        assertEq(currentBid, 0);
        assertEq(currentBidder, address(0));
        assertEq(episodesRemaining, 10);
        assertTrue(active);
    }

    function test_createAdSlot_platformCanCreate() public {
        vm.prank(platform);
        uint256 slotId = ad.createAdSlot(
            UNIVERSE_ID,
            AdPlacement.PlacementType.PRODUCT,
            MIN_BID,
            5,
            "product-meta"
        );
        (,, AdPlacement.PlacementType pt,,,,,,) = ad.adSlots(slotId);
        assertEq(uint8(pt), uint8(AdPlacement.PlacementType.PRODUCT));
    }

    function test_createAdSlot_allPlacementTypes() public {
        vm.startPrank(creator);

        uint256 s0 = ad.createAdSlot(UNIVERSE_ID, AdPlacement.PlacementType.BILLBOARD, MIN_BID, 1, "");
        uint256 s1 = ad.createAdSlot(UNIVERSE_ID, AdPlacement.PlacementType.PRODUCT, MIN_BID, 1, "");
        uint256 s2 = ad.createAdSlot(UNIVERSE_ID, AdPlacement.PlacementType.SPONSORED_CHARACTER, MIN_BID, 1, "");
        uint256 s3 = ad.createAdSlot(UNIVERSE_ID, AdPlacement.PlacementType.AUDIO_MENTION, MIN_BID, 1, "");

        vm.stopPrank();

        (,, AdPlacement.PlacementType pt0,,,,,,) = ad.adSlots(s0);
        (,, AdPlacement.PlacementType pt1,,,,,,) = ad.adSlots(s1);
        (,, AdPlacement.PlacementType pt2,,,,,,) = ad.adSlots(s2);
        (,, AdPlacement.PlacementType pt3,,,,,,) = ad.adSlots(s3);

        assertEq(uint8(pt0), uint8(AdPlacement.PlacementType.BILLBOARD));
        assertEq(uint8(pt1), uint8(AdPlacement.PlacementType.PRODUCT));
        assertEq(uint8(pt2), uint8(AdPlacement.PlacementType.SPONSORED_CHARACTER));
        assertEq(uint8(pt3), uint8(AdPlacement.PlacementType.AUDIO_MENTION));
    }

    function test_createAdSlot_revert_strangerCannotCreate() public {
        vm.prank(stranger);
        vm.expectRevert("Not authorized");
        ad.createAdSlot(UNIVERSE_ID, AdPlacement.PlacementType.BILLBOARD, MIN_BID, 10, "");
    }

    function test_createAdSlot_revert_universeNotRegistered() public {
        vm.prank(creator);
        vm.expectRevert("Universe not registered");
        ad.createAdSlot(999, AdPlacement.PlacementType.BILLBOARD, MIN_BID, 10, "");
    }

    function test_createAdSlot_revert_whenPaused() public {
        ad.pause();
        vm.prank(creator);
        vm.expectRevert();
        ad.createAdSlot(UNIVERSE_ID, AdPlacement.PlacementType.BILLBOARD, MIN_BID, 10, "");
    }

    function test_createAdSlot_incrementsNextSlotId() public {
        vm.startPrank(creator);
        uint256 s0 = ad.createAdSlot(UNIVERSE_ID, AdPlacement.PlacementType.BILLBOARD, MIN_BID, 1, "");
        uint256 s1 = ad.createAdSlot(UNIVERSE_ID, AdPlacement.PlacementType.BILLBOARD, MIN_BID, 1, "");
        vm.stopPrank();

        assertEq(s0, 0);
        assertEq(s1, 1);
        assertEq(ad.nextSlotId(), 2);
    }

    function test_createAdSlot_tracksUniverseSlots() public {
        vm.startPrank(creator);
        ad.createAdSlot(UNIVERSE_ID, AdPlacement.PlacementType.BILLBOARD, MIN_BID, 1, "");
        ad.createAdSlot(UNIVERSE_ID, AdPlacement.PlacementType.PRODUCT, MIN_BID, 1, "");
        vm.stopPrank();

        uint256[] memory slots = ad.getUniverseSlots(UNIVERSE_ID);
        assertEq(slots.length, 2);
        assertEq(slots[0], 0);
        assertEq(slots[1], 1);
    }

    // =========================================================================
    //                              BID
    // =========================================================================

    function _createSlot() internal returns (uint256) {
        vm.prank(creator);
        return ad.createAdSlot(UNIVERSE_ID, AdPlacement.PlacementType.BILLBOARD, MIN_BID, 10, "");
    }

    function test_bid() public {
        uint256 slotId = _createSlot();

        vm.prank(bidder1);
        ad.bid{value: 0.2 ether}(slotId);

        (,,, , uint256 currentBid, address currentBidder,,,) = ad.adSlots(slotId);
        assertEq(currentBid, 0.2 ether);
        assertEq(currentBidder, bidder1);
    }

    function test_bid_exactMinBid() public {
        uint256 slotId = _createSlot();

        vm.prank(bidder1);
        ad.bid{value: MIN_BID}(slotId);

        (,,,,uint256 currentBid, address currentBidder,,,) = ad.adSlots(slotId);
        assertEq(currentBid, MIN_BID);
        assertEq(currentBidder, bidder1);
    }

    function test_bid_revert_tooLow() public {
        uint256 slotId = _createSlot();

        vm.prank(bidder1);
        vm.expectRevert(AdPlacement.BidTooLow.selector);
        ad.bid{value: 0.05 ether}(slotId); // below minBid
    }

    function test_bid_revert_zeroBid() public {
        uint256 slotId = _createSlot();

        vm.prank(bidder1);
        vm.expectRevert(AdPlacement.BidTooLow.selector);
        ad.bid{value: 0}(slotId);
    }

    function test_bid_revert_equalToCurrentBid() public {
        uint256 slotId = _createSlot();

        vm.prank(bidder1);
        ad.bid{value: 0.2 ether}(slotId);

        // Equal bid should fail (must be strictly greater)
        vm.prank(bidder2);
        vm.expectRevert(AdPlacement.BidTooLow.selector);
        ad.bid{value: 0.2 ether}(slotId);
    }

    function test_bid_revert_slotNotActive() public {
        // Bid on a slot ID that was never created (default active = false)
        vm.prank(bidder1);
        vm.expectRevert(AdPlacement.SlotNotActive.selector);
        ad.bid{value: 1 ether}(999);
    }

    function test_bid_revert_whenPaused() public {
        uint256 slotId = _createSlot();
        ad.pause();

        vm.prank(bidder1);
        vm.expectRevert();
        ad.bid{value: 0.2 ether}(slotId);
    }

    function test_bid_outbidRefund() public {
        uint256 slotId = _createSlot();

        // First bid
        vm.prank(bidder1);
        ad.bid{value: 0.2 ether}(slotId);

        // Outbid
        vm.prank(bidder2);
        ad.bid{value: 0.3 ether}(slotId);

        // bidder1 should have pending withdrawal
        assertEq(ad.pendingWithdrawals(bidder1), 0.2 ether);

        // Slot state updated
        (,,,,uint256 currentBid, address currentBidder,,,) = ad.adSlots(slotId);
        assertEq(currentBid, 0.3 ether);
        assertEq(currentBidder, bidder2);
    }

    function test_bid_multipleOutbids_accumulateWithdrawals() public {
        uint256 slotId = _createSlot();

        // bidder1 bids, gets outbid twice on different slots
        vm.prank(bidder1);
        ad.bid{value: 0.2 ether}(slotId);

        vm.prank(bidder2);
        ad.bid{value: 0.3 ether}(slotId);

        // bidder1 bids again, gets outbid again
        vm.prank(bidder1);
        ad.bid{value: 0.4 ether}(slotId);

        vm.prank(bidder3);
        ad.bid{value: 0.5 ether}(slotId);

        // bidder1 has accumulated refunds: 0.2 + 0.4 = 0.6
        assertEq(ad.pendingWithdrawals(bidder1), 0.6 ether);
        // bidder2 has 0.3
        assertEq(ad.pendingWithdrawals(bidder2), 0.3 ether);
    }

    function test_bid_sameBidderCanRebid() public {
        uint256 slotId = _createSlot();

        vm.prank(bidder1);
        ad.bid{value: 0.2 ether}(slotId);

        // bidder1 outbids themselves — their old bid goes to pending
        vm.prank(bidder1);
        ad.bid{value: 0.3 ether}(slotId);

        assertEq(ad.pendingWithdrawals(bidder1), 0.2 ether);
        (,,,,uint256 currentBid, address currentBidder,,,) = ad.adSlots(slotId);
        assertEq(currentBid, 0.3 ether);
        assertEq(currentBidder, bidder1);
    }

    // =========================================================================
    //                          WITHDRAW REFUND
    // =========================================================================

    function test_withdrawRefund() public {
        uint256 slotId = _createSlot();

        vm.prank(bidder1);
        ad.bid{value: 0.2 ether}(slotId);

        vm.prank(bidder2);
        ad.bid{value: 0.3 ether}(slotId);

        uint256 balBefore = bidder1.balance;

        vm.prank(bidder1);
        ad.withdrawRefund();

        assertEq(bidder1.balance, balBefore + 0.2 ether);
        assertEq(ad.pendingWithdrawals(bidder1), 0);
    }

    function test_withdrawRefund_revert_noPending() public {
        vm.prank(bidder1);
        vm.expectRevert(AdPlacement.NoPendingWithdrawal.selector);
        ad.withdrawRefund();
    }

    function test_withdrawRefund_doubleWithdraw_reverts() public {
        uint256 slotId = _createSlot();

        vm.prank(bidder1);
        ad.bid{value: 0.2 ether}(slotId);

        vm.prank(bidder2);
        ad.bid{value: 0.3 ether}(slotId);

        vm.prank(bidder1);
        ad.withdrawRefund();

        // Second attempt should revert
        vm.prank(bidder1);
        vm.expectRevert(AdPlacement.NoPendingWithdrawal.selector);
        ad.withdrawRefund();
    }

    // =========================================================================
    //                          ACCEPT BID
    // =========================================================================

    function test_acceptBid() public {
        uint256 slotId = _createSlot();

        vm.prank(bidder1);
        ad.bid{value: 0.5 ether}(slotId);

        vm.prank(creator);
        uint256 sponsorshipId = ad.acceptBid(slotId);

        // Sponsorship created
        (
            uint256 id,
            uint256 adSlotId,
            address sponsor,
            uint256 totalPaid,
            uint256 impressions,
            ,  // startedAt
            bool active
        ) = ad.sponsorships(sponsorshipId);

        assertEq(id, sponsorshipId);
        assertEq(adSlotId, slotId);
        assertEq(sponsor, bidder1);
        assertEq(totalPaid, 0.5 ether);
        assertEq(impressions, 0);
        assertTrue(active);

        // Payment routed
        uint256 expectedCreatorCut = 0.5 ether - (0.5 ether * uint256(FEE_BPS) / 10000);
        assertEq(router._claimable(creator), expectedCreatorCut);
    }

    function test_acceptBid_platformCanAccept() public {
        uint256 slotId = _createSlot();

        vm.prank(bidder1);
        ad.bid{value: 0.5 ether}(slotId);

        vm.prank(platform);
        uint256 sponsorshipId = ad.acceptBid(slotId);

        (,, address sponsor,,,,) = ad.sponsorships(sponsorshipId);
        assertEq(sponsor, bidder1);
    }

    function test_acceptBid_clearsSlotBidState() public {
        uint256 slotId = _createSlot();

        vm.prank(bidder1);
        ad.bid{value: 0.5 ether}(slotId);

        vm.prank(creator);
        ad.acceptBid(slotId);

        // Slot bid state should be cleared
        (,,,,uint256 currentBid, address currentBidder,,,) = ad.adSlots(slotId);
        assertEq(currentBid, 0);
        assertEq(currentBidder, address(0));
    }

    function test_acceptBid_revert_noBids() public {
        uint256 slotId = _createSlot();

        vm.prank(creator);
        vm.expectRevert("No bids");
        ad.acceptBid(slotId);
    }

    function test_acceptBid_revert_notAuthorized() public {
        uint256 slotId = _createSlot();

        vm.prank(bidder1);
        ad.bid{value: 0.5 ether}(slotId);

        vm.prank(stranger);
        vm.expectRevert("Not authorized");
        ad.acceptBid(slotId);
    }

    function test_acceptBid_revert_whenPaused() public {
        uint256 slotId = _createSlot();

        vm.prank(bidder1);
        ad.bid{value: 0.5 ether}(slotId);

        ad.pause();

        vm.prank(creator);
        vm.expectRevert();
        ad.acceptBid(slotId);
    }

    function test_acceptBid_newBidAfterAccept() public {
        uint256 slotId = _createSlot();

        vm.prank(bidder1);
        ad.bid{value: 0.5 ether}(slotId);

        vm.prank(creator);
        ad.acceptBid(slotId);

        // Slot is still active, new bids should work
        vm.prank(bidder2);
        ad.bid{value: 0.2 ether}(slotId);

        (,,,,uint256 currentBid, address currentBidder,,,) = ad.adSlots(slotId);
        assertEq(currentBid, 0.2 ether);
        assertEq(currentBidder, bidder2);
    }

    function test_acceptBid_incrementsSponsorshipId() public {
        uint256 slotId = _createSlot();

        vm.prank(bidder1);
        ad.bid{value: 0.5 ether}(slotId);
        vm.prank(creator);
        uint256 sp0 = ad.acceptBid(slotId);

        vm.prank(bidder2);
        ad.bid{value: 0.2 ether}(slotId);
        vm.prank(creator);
        uint256 sp1 = ad.acceptBid(slotId);

        assertEq(sp0, 0);
        assertEq(sp1, 1);
    }

    function test_acceptBid_treasuryReceivesFee() public {
        uint256 slotId = _createSlot();

        vm.prank(bidder1);
        ad.bid{value: 1 ether}(slotId);

        uint256 treasuryBefore = treasury.balance;

        vm.prank(creator);
        ad.acceptBid(slotId);

        uint256 expectedFee = (1 ether * uint256(FEE_BPS)) / 10000; // 5% = 0.05 ether
        assertEq(treasury.balance - treasuryBefore, expectedFee);
    }

    // =========================================================================
    //                          RECORD IMPRESSION
    // =========================================================================

    function test_recordImpression() public {
        uint256 slotId = _createSlot();

        vm.prank(bidder1);
        ad.bid{value: 0.5 ether}(slotId);

        vm.prank(creator);
        uint256 sponsorshipId = ad.acceptBid(slotId);

        vm.prank(platform);
        ad.recordImpression(sponsorshipId);

        (,,,, uint256 impressions,,) = ad.sponsorships(sponsorshipId);
        assertEq(impressions, 1);

        // Check episodes remaining decreased
        (,,,,,,,uint256 episodesRemaining,) = ad.adSlots(slotId);
        assertEq(episodesRemaining, 9);
    }

    function test_recordImpression_revert_notPlatform() public {
        uint256 slotId = _createSlot();

        vm.prank(bidder1);
        ad.bid{value: 0.5 ether}(slotId);

        vm.prank(creator);
        uint256 sponsorshipId = ad.acceptBid(slotId);

        vm.prank(stranger);
        vm.expectRevert(AdPlacement.NotPlatform.selector);
        ad.recordImpression(sponsorshipId);
    }

    function test_recordImpression_deactivatesAtZeroEpisodes() public {
        // Create slot with only 2 episodes
        vm.prank(creator);
        uint256 slotId = ad.createAdSlot(
            UNIVERSE_ID, AdPlacement.PlacementType.BILLBOARD, MIN_BID, 2, ""
        );

        vm.prank(bidder1);
        ad.bid{value: 0.5 ether}(slotId);

        vm.prank(creator);
        uint256 sponsorshipId = ad.acceptBid(slotId);

        // First impression: 2 -> 1
        vm.prank(platform);
        ad.recordImpression(sponsorshipId);
        (,,,,,, bool active1) = ad.sponsorships(sponsorshipId);
        assertTrue(active1);

        // Second impression: 1 -> 0, deactivates sponsorship
        vm.prank(platform);
        ad.recordImpression(sponsorshipId);
        (,,,, uint256 impressions,, bool active2) = ad.sponsorships(sponsorshipId);
        assertEq(impressions, 2);
        assertFalse(active2);

        (,,,,,,,uint256 remaining,) = ad.adSlots(slotId);
        assertEq(remaining, 0);
    }

    function test_recordImpression_multipleImpressions() public {
        vm.prank(creator);
        uint256 slotId = ad.createAdSlot(
            UNIVERSE_ID, AdPlacement.PlacementType.BILLBOARD, MIN_BID, 100, ""
        );

        vm.prank(bidder1);
        ad.bid{value: 0.5 ether}(slotId);

        vm.prank(creator);
        uint256 sponsorshipId = ad.acceptBid(slotId);

        for (uint256 i = 0; i < 5; i++) {
            vm.prank(platform);
            ad.recordImpression(sponsorshipId);
        }

        (,,,, uint256 impressions,,) = ad.sponsorships(sponsorshipId);
        assertEq(impressions, 5);

        (,,,,,,,uint256 remaining,) = ad.adSlots(slotId);
        assertEq(remaining, 95);
    }

    // =========================================================================
    //                          PAUSE / UNPAUSE
    // =========================================================================

    function test_pause_onlyOwner() public {
        ad.pause(); // deployer is owner
        assertTrue(ad.paused());
    }

    function test_unpause_onlyOwner() public {
        ad.pause();
        ad.unpause();
        assertFalse(ad.paused());
    }

    function test_pause_revert_notOwner() public {
        vm.prank(stranger);
        vm.expectRevert();
        ad.pause();
    }

    function test_unpause_revert_notOwner() public {
        ad.pause();
        vm.prank(stranger);
        vm.expectRevert();
        ad.unpause();
    }

    // =========================================================================
    //                          VIEW FUNCTIONS
    // =========================================================================

    function test_getUniverseSlots_empty() public view {
        uint256[] memory slots = ad.getUniverseSlots(999);
        assertEq(slots.length, 0);
    }

    function test_getSlotCount() public {
        vm.startPrank(creator);
        ad.createAdSlot(UNIVERSE_ID, AdPlacement.PlacementType.BILLBOARD, MIN_BID, 1, "");
        ad.createAdSlot(UNIVERSE_ID, AdPlacement.PlacementType.PRODUCT, MIN_BID, 1, "");
        ad.createAdSlot(UNIVERSE_ID, AdPlacement.PlacementType.AUDIO_MENTION, MIN_BID, 1, "");
        vm.stopPrank();

        assertEq(ad.getSlotCount(UNIVERSE_ID), 3);
        assertEq(ad.getSlotCount(999), 0);
    }

    function test_getUniverseSlotsPaginated() public {
        vm.startPrank(creator);
        for (uint256 i = 0; i < 5; i++) {
            ad.createAdSlot(UNIVERSE_ID, AdPlacement.PlacementType.BILLBOARD, MIN_BID, 1, "");
        }
        vm.stopPrank();

        // Page 1: offset=0, limit=2
        (uint256[] memory ids1, uint256 total1) = ad.getUniverseSlotsPaginated(UNIVERSE_ID, 0, 2);
        assertEq(total1, 5);
        assertEq(ids1.length, 2);
        assertEq(ids1[0], 0);
        assertEq(ids1[1], 1);

        // Page 2: offset=2, limit=2
        (uint256[] memory ids2, uint256 total2) = ad.getUniverseSlotsPaginated(UNIVERSE_ID, 2, 2);
        assertEq(total2, 5);
        assertEq(ids2.length, 2);
        assertEq(ids2[0], 2);
        assertEq(ids2[1], 3);

        // Page 3: offset=4, limit=2 (only 1 remaining)
        (uint256[] memory ids3, uint256 total3) = ad.getUniverseSlotsPaginated(UNIVERSE_ID, 4, 2);
        assertEq(total3, 5);
        assertEq(ids3.length, 1);
        assertEq(ids3[0], 4);

        // Beyond end: offset=10
        (uint256[] memory ids4, uint256 total4) = ad.getUniverseSlotsPaginated(UNIVERSE_ID, 10, 2);
        assertEq(total4, 5);
        assertEq(ids4.length, 0);
    }

    // =========================================================================
    //                          EVENT EMISSION
    // =========================================================================

    function test_event_AdSlotCreated() public {
        vm.prank(creator);
        vm.expectEmit(true, false, false, true);
        emit AdPlacement.AdSlotCreated(0, UNIVERSE_ID, AdPlacement.PlacementType.BILLBOARD, MIN_BID);
        ad.createAdSlot(UNIVERSE_ID, AdPlacement.PlacementType.BILLBOARD, MIN_BID, 10, "");
    }

    function test_event_BidPlaced() public {
        uint256 slotId = _createSlot();

        vm.prank(bidder1);
        vm.expectEmit(true, false, false, true);
        emit AdPlacement.BidPlaced(slotId, bidder1, 0.2 ether);
        ad.bid{value: 0.2 ether}(slotId);
    }

    function test_event_SponsorshipActivated() public {
        uint256 slotId = _createSlot();

        vm.prank(bidder1);
        ad.bid{value: 0.5 ether}(slotId);

        vm.prank(creator);
        vm.expectEmit(true, false, false, true);
        emit AdPlacement.SponsorshipActivated(0, slotId, bidder1);
        ad.acceptBid(slotId);
    }

    function test_event_RefundWithdrawn() public {
        uint256 slotId = _createSlot();

        vm.prank(bidder1);
        ad.bid{value: 0.2 ether}(slotId);

        vm.prank(bidder2);
        ad.bid{value: 0.3 ether}(slotId);

        vm.prank(bidder1);
        vm.expectEmit(true, false, false, true);
        emit AdPlacement.RefundWithdrawn(bidder1, 0.2 ether);
        ad.withdrawRefund();
    }

    function test_event_UniverseRegistered() public {
        mockUniverse.setOwner(77, creator);
        vm.prank(platform);
        vm.expectEmit(true, false, false, true);
        emit AdPlacement.UniverseRegistered(77, creator);
        ad.registerUniverse(77);
    }

    function test_event_ImpressionRecorded() public {
        uint256 slotId = _createSlot();

        vm.prank(bidder1);
        ad.bid{value: 0.5 ether}(slotId);

        vm.prank(creator);
        uint256 sponsorshipId = ad.acceptBid(slotId);

        vm.prank(platform);
        vm.expectEmit(true, false, false, true);
        emit AdPlacement.ImpressionRecorded(sponsorshipId, 1);
        ad.recordImpression(sponsorshipId);
    }

    // =========================================================================
    //                     EDGE CASES / INTEGRATION
    // =========================================================================

    function test_multipleSlotsPerUniverse() public {
        mockUniverse.setOwner(2, creator);
        vm.prank(platform);
        ad.registerUniverse(2);

        vm.startPrank(creator);
        ad.createAdSlot(UNIVERSE_ID, AdPlacement.PlacementType.BILLBOARD, MIN_BID, 10, "");
        ad.createAdSlot(UNIVERSE_ID, AdPlacement.PlacementType.PRODUCT, 0.05 ether, 5, "");
        ad.createAdSlot(2, AdPlacement.PlacementType.AUDIO_MENTION, 0.01 ether, 20, "");
        vm.stopPrank();

        assertEq(ad.getSlotCount(UNIVERSE_ID), 2);
        assertEq(ad.getSlotCount(2), 1);
    }

    function test_fullLifecycle() public {
        // Create slot
        vm.prank(creator);
        uint256 slotId = ad.createAdSlot(
            UNIVERSE_ID, AdPlacement.PlacementType.SPONSORED_CHARACTER, MIN_BID, 3, "char-meta"
        );

        // Multiple bids
        vm.prank(bidder1);
        ad.bid{value: 0.2 ether}(slotId);

        vm.prank(bidder2);
        ad.bid{value: 0.5 ether}(slotId);

        // bidder1 withdraws refund
        vm.prank(bidder1);
        ad.withdrawRefund();

        // Accept bid
        vm.prank(creator);
        uint256 sponsorshipId = ad.acceptBid(slotId);

        // Record all impressions until expiry
        for (uint256 i = 0; i < 3; i++) {
            vm.prank(platform);
            ad.recordImpression(sponsorshipId);
        }

        // Sponsorship deactivated
        (,,,,,, bool active) = ad.sponsorships(sponsorshipId);
        assertFalse(active);

        (,,,,,,,uint256 remaining,) = ad.adSlots(slotId);
        assertEq(remaining, 0);
    }
}
