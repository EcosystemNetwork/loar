// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/proxy/ERC1967/ERC1967Proxy.sol";
import {AdPlacement} from "../src/revenue/AdPlacement.sol";
import {MockPaymentRouter} from "./mocks/MockPaymentRouter.sol";

contract AdPlacementTest is Test {
    AdPlacement public ad;
    MockPaymentRouter public router;

    address platform = makeAddr("platform");
    address treasury = makeAddr("treasury");
    address creator = makeAddr("creator");
    address bidder1 = makeAddr("bidder1");
    address bidder2 = makeAddr("bidder2");

    uint256 constant UNIVERSE_ID = 1;
    uint16 constant FEE_BPS = 500;
    uint256 constant MIN_BID = 0.1 ether;

    function setUp() public {
        vm.deal(treasury, 0);
        vm.deal(bidder1, 100 ether);
        vm.deal(bidder2, 100 ether);

        router = new MockPaymentRouter(treasury);

        AdPlacement impl = new AdPlacement();
        ad = AdPlacement(
            address(
                new ERC1967Proxy(
                    address(impl),
                    abi.encodeCall(AdPlacement.initialize, (platform, address(router), FEE_BPS))
                )
            )
        );

        vm.prank(platform);
        ad.registerUniverse(UNIVERSE_ID, creator);
    }

    // ---- initialize ----

    function test_initialize() public view {
        assertEq(ad.platform(), platform);
        assertEq(address(ad.paymentRouter()), address(router));
        assertEq(ad.platformFeeBps(), FEE_BPS);
    }

    // ---- createAdSlot ----

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

    // ---- bid ----

    function test_bid() public {
        vm.prank(creator);
        uint256 slotId = ad.createAdSlot(
            UNIVERSE_ID, AdPlacement.PlacementType.BILLBOARD, MIN_BID, 10, ""
        );

        vm.prank(bidder1);
        ad.bid{value: 0.2 ether}(slotId);

        (,,, , uint256 currentBid, address currentBidder,,,) = ad.adSlots(slotId);
        assertEq(currentBid, 0.2 ether);
        assertEq(currentBidder, bidder1);
    }

    function test_bid_revert_tooLow() public {
        vm.prank(creator);
        uint256 slotId = ad.createAdSlot(
            UNIVERSE_ID, AdPlacement.PlacementType.BILLBOARD, MIN_BID, 10, ""
        );

        vm.prank(bidder1);
        vm.expectRevert(AdPlacement.BidTooLow.selector);
        ad.bid{value: 0.05 ether}(slotId); // below minBid
    }

    function test_bid_outbidRefund() public {
        vm.prank(creator);
        uint256 slotId = ad.createAdSlot(
            UNIVERSE_ID, AdPlacement.PlacementType.BILLBOARD, MIN_BID, 10, ""
        );

        // First bid
        vm.prank(bidder1);
        ad.bid{value: 0.2 ether}(slotId);

        // Outbid
        vm.prank(bidder2);
        ad.bid{value: 0.3 ether}(slotId);

        // bidder1 should have pending withdrawal
        assertEq(ad.pendingWithdrawals(bidder1), 0.2 ether);
    }

    // ---- withdrawRefund ----

    function test_withdrawRefund() public {
        vm.prank(creator);
        uint256 slotId = ad.createAdSlot(
            UNIVERSE_ID, AdPlacement.PlacementType.BILLBOARD, MIN_BID, 10, ""
        );

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

    // ---- acceptBid ----

    function test_acceptBid() public {
        vm.prank(creator);
        uint256 slotId = ad.createAdSlot(
            UNIVERSE_ID, AdPlacement.PlacementType.BILLBOARD, MIN_BID, 10, ""
        );

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

    // ---- recordImpression ----

    function test_recordImpression() public {
        vm.prank(creator);
        uint256 slotId = ad.createAdSlot(
            UNIVERSE_ID, AdPlacement.PlacementType.BILLBOARD, MIN_BID, 3, ""
        );

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
        assertEq(episodesRemaining, 2);
    }
}
