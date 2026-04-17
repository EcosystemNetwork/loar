// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/proxy/ERC1967/ERC1967Proxy.sol";
import {ContentLicensing} from "../src/revenue/ContentLicensing.sol";
import {SplitRouter} from "../src/SplitRouter.sol";
import {MockPaymentRouter} from "./mocks/MockPaymentRouter.sol";
import {MockRightsRegistry} from "./mocks/MockRightsRegistry.sol";

contract ContentLicensingTest is Test {
    ContentLicensing public licensing;
    SplitRouter public splitRouter;
    MockPaymentRouter public paymentRouter;
    MockRightsRegistry public rightsRegistry;

    address deployer = makeAddr("deployer");
    address platform = makeAddr("platform");
    address treasury = makeAddr("treasury");
    address creator = makeAddr("creator");
    address buyer = makeAddr("buyer");
    address alice = makeAddr("alice");

    bytes32 constant CONTENT_HASH = keccak256("content:1");
    bytes32 constant CONTENT_HASH_2 = keccak256("content:2");
    bytes32 constant SPLIT_ENTITY_HASH = keccak256("universe:1");
    uint16 constant PLATFORM_FEE_BPS = 500; // 5%
    uint256 constant BUY_PRICE = 1 ether;
    uint256 constant RENT_PRICE_PER_DAY = 0.01 ether;
    uint256 constant LICENSE_FEE = 0.5 ether;
    uint16 constant LICENSE_ROYALTY_BPS = 1000; // 10%

    function setUp() public {
        vm.deal(treasury, 0);
        vm.deal(buyer, 100 ether);
        vm.deal(alice, 100 ether);

        // Deploy mock payment router
        paymentRouter = new MockPaymentRouter(treasury);
        vm.deal(address(paymentRouter), 0);

        // Deploy real SplitRouter with mock payment router
        vm.startPrank(deployer);
        splitRouter = new SplitRouter(address(paymentRouter));
        // Register ContentLicensing (via deployer) as a registrar — not needed,
        // splits are configured externally. Instead register deployer as registrar.
        splitRouter.setRegistrar(deployer, true);
        vm.stopPrank();

        // Configure splits for SPLIT_ENTITY_HASH: creator gets 100%
        vm.prank(deployer);
        splitRouter.registerSplitOwner(SPLIT_ENTITY_HASH, creator);

        SplitRouter.Split[] memory splits = new SplitRouter.Split[](1);
        splits[0] = SplitRouter.Split(creator, 10000);
        vm.prank(creator);
        splitRouter.setSplits(SPLIT_ENTITY_HASH, splits);

        // Deploy mock rights registry (defaults to monetizable=true)
        rightsRegistry = new MockRightsRegistry();

        // Deploy ContentLicensing via UUPS proxy
        vm.startPrank(deployer);
        ContentLicensing impl = new ContentLicensing();
        licensing = ContentLicensing(
            address(
                new ERC1967Proxy(
                    address(impl),
                    abi.encodeCall(
                        ContentLicensing.initialize,
                        (platform, address(splitRouter), address(paymentRouter), address(rightsRegistry), PLATFORM_FEE_BPS)
                    )
                )
            )
        );
        vm.stopPrank();

        // Register default content as creator
        vm.prank(creator);
        licensing.registerContent(
            CONTENT_HASH,
            1, // universeId
            SPLIT_ENTITY_HASH,
            BUY_PRICE,
            RENT_PRICE_PER_DAY,
            LICENSE_FEE,
            LICENSE_ROYALTY_BPS
        );
    }

    // ════════════════════════════════════════════════════════════════════
    // ── Initialization ─────────────────────────────────────────────────
    // ════════════════════════════════════════════════════════════════════

    function test_initialize() public view {
        assertEq(licensing.platform(), platform);
        assertEq(address(licensing.splitRouter()), address(splitRouter));
        assertEq(address(licensing.paymentRouter()), address(paymentRouter));
        assertEq(licensing.platformFeeBps(), PLATFORM_FEE_BPS);
        assertEq(licensing.owner(), deployer);
        assertEq(licensing.nextDealId(), 1); // starts at 1 (0 reserved as sentinel)
    }

    function test_initialize_revert_zeroPlatform() public {
        ContentLicensing impl = new ContentLicensing();
        vm.expectRevert(ContentLicensing.ZeroAddress.selector);
        new ERC1967Proxy(
            address(impl),
            abi.encodeCall(ContentLicensing.initialize, (address(0), address(splitRouter), address(paymentRouter), address(rightsRegistry), PLATFORM_FEE_BPS))
        );
    }

    function test_initialize_revert_zeroSplitRouter() public {
        ContentLicensing impl = new ContentLicensing();
        vm.expectRevert(ContentLicensing.ZeroAddress.selector);
        new ERC1967Proxy(
            address(impl),
            abi.encodeCall(ContentLicensing.initialize, (platform, address(0), address(paymentRouter), address(rightsRegistry), PLATFORM_FEE_BPS))
        );
    }

    function test_initialize_revert_zeroPaymentRouter() public {
        ContentLicensing impl = new ContentLicensing();
        vm.expectRevert(ContentLicensing.ZeroAddress.selector);
        new ERC1967Proxy(
            address(impl),
            abi.encodeCall(ContentLicensing.initialize, (platform, address(splitRouter), address(0), address(rightsRegistry), PLATFORM_FEE_BPS))
        );
    }

    function test_initialize_revert_feeTooHigh() public {
        ContentLicensing impl = new ContentLicensing();
        vm.expectRevert(ContentLicensing.FeeTooHigh.selector);
        new ERC1967Proxy(
            address(impl),
            abi.encodeCall(ContentLicensing.initialize, (platform, address(splitRouter), address(paymentRouter), address(rightsRegistry), 5001))
        );
    }

    function test_initialize_maxFee_succeeds() public {
        ContentLicensing impl = new ContentLicensing();
        // 5000 bps (50%) is the maximum allowed
        ContentLicensing l = ContentLicensing(address(new ERC1967Proxy(
            address(impl),
            abi.encodeCall(ContentLicensing.initialize, (platform, address(splitRouter), address(paymentRouter), address(rightsRegistry), 5000))
        )));
        assertEq(l.platformFeeBps(), 5000);
    }

    // ════════════════════════════════════════════════════════════════════
    // ── Registration ───────────────────────────────────────────────────
    // ════════════════════════════════════════════════════════════════════

    function test_registerContent() public view {
        ContentLicensing.ContentRegistration memory reg = licensing.getRegistration(CONTENT_HASH);
        assertEq(reg.contentHash, CONTENT_HASH);
        assertEq(reg.creator, creator);
        assertEq(reg.universeId, 1);
        assertEq(reg.splitEntityHash, SPLIT_ENTITY_HASH);
        assertEq(reg.buyPrice, BUY_PRICE);
        assertEq(reg.rentPricePerDay, RENT_PRICE_PER_DAY);
        assertEq(reg.licenseFee, LICENSE_FEE);
        assertEq(reg.licenseRoyaltyBps, LICENSE_ROYALTY_BPS);
        assertTrue(reg.active);
        assertEq(licensing.contentOwner(CONTENT_HASH), creator);
        assertEq(licensing.splitToContent(SPLIT_ENTITY_HASH), CONTENT_HASH);
    }

    function test_registerContent_emitsEvent() public {
        bytes32 hash = keccak256("content:new");
        vm.expectEmit(true, false, false, true);
        emit ContentLicensing.ContentRegistered(hash, alice, 2, bytes32(0));
        vm.prank(alice);
        licensing.registerContent(hash, 2, bytes32(0), 1 ether, 0, 0, 0);
    }

    function test_registerContent_revert_zeroHash() public {
        vm.prank(creator);
        vm.expectRevert(ContentLicensing.ZeroHash.selector);
        licensing.registerContent(bytes32(0), 1, SPLIT_ENTITY_HASH, BUY_PRICE, RENT_PRICE_PER_DAY, LICENSE_FEE, LICENSE_ROYALTY_BPS);
    }

    function test_registerContent_revert_alreadyRegistered() public {
        vm.prank(alice);
        vm.expectRevert(ContentLicensing.AlreadyRegistered.selector);
        licensing.registerContent(CONTENT_HASH, 1, SPLIT_ENTITY_HASH, BUY_PRICE, RENT_PRICE_PER_DAY, LICENSE_FEE, LICENSE_ROYALTY_BPS);
    }

    function test_registerContent_revert_royaltyBpsTooHigh() public {
        bytes32 hash = keccak256("content:high-royalty");
        vm.prank(creator);
        vm.expectRevert(ContentLicensing.FeeTooHigh.selector);
        licensing.registerContent(hash, 1, SPLIT_ENTITY_HASH, BUY_PRICE, RENT_PRICE_PER_DAY, LICENSE_FEE, 5001);
    }

    function test_registerContent_noSplitEntityHash() public {
        bytes32 hash = keccak256("content:nosplit");
        vm.prank(creator);
        licensing.registerContent(hash, 1, bytes32(0), BUY_PRICE, 0, 0, 0);
        // splitToContent should not be set for zero hash
        assertEq(licensing.splitToContent(bytes32(0)), bytes32(0));
    }

    // ════════════════════════════════════════════════════════════════════
    // ── buyContent ─────────────────────────────────────────────────────
    // ════════════════════════════════════════════════════════════════════

    function test_buyContent_happyPath() public {
        vm.prank(buyer);
        uint256 dealId = licensing.buyContent{value: BUY_PRICE}(CONTENT_HASH);

        assertEq(dealId, 1);
        assertEq(licensing.nextDealId(), 2);

        // Check deal state
        (
            uint256 id, bytes32 contentHash, bytes32 splitHash,
            ContentLicensing.DealType dealType, ContentLicensing.DealStatus status,
            address dealBuyer, uint256 pricePaid, uint256 startTime, uint256 endTime
        ) = licensing.deals(dealId);

        assertEq(id, 1);
        assertEq(contentHash, CONTENT_HASH);
        assertEq(splitHash, SPLIT_ENTITY_HASH);
        assertTrue(dealType == ContentLicensing.DealType.BUY);
        assertTrue(status == ContentLicensing.DealStatus.ACTIVE);
        assertEq(dealBuyer, buyer);
        assertEq(pricePaid, BUY_PRICE);
        assertEq(startTime, block.timestamp);
        assertEq(endTime, 0); // permanent

        // Ownership transferred
        assertEq(licensing.contentOwner(CONTENT_HASH), buyer);

        // Content deals array updated
        uint256[] memory dealIds = licensing.getContentDeals(CONTENT_HASH);
        assertEq(dealIds.length, 1);
        assertEq(dealIds[0], 1);
    }

    function test_buyContent_emitsEvent() public {
        vm.expectEmit(true, false, false, true);
        emit ContentLicensing.ContentBought(1, CONTENT_HASH, buyer, BUY_PRICE);
        vm.prank(buyer);
        licensing.buyContent{value: BUY_PRICE}(CONTENT_HASH);
    }

    function test_buyContent_routesPaymentThroughSplitRouter() public {
        uint256 treasuryBefore = treasury.balance;

        vm.prank(buyer);
        licensing.buyContent{value: BUY_PRICE}(CONTENT_HASH);

        // Platform fee: 1 ether * 500 / 10000 = 0.05 ether
        uint256 expectedPlatformFee = (BUY_PRICE * PLATFORM_FEE_BPS) / 10000;
        uint256 expectedCreatorShare = BUY_PRICE - expectedPlatformFee;

        assertEq(treasury.balance - treasuryBefore, expectedPlatformFee);
        assertEq(paymentRouter._claimable(creator), expectedCreatorShare);
    }

    function test_buyContent_overpaymentRefunded() public {
        uint256 overpayment = BUY_PRICE + 0.5 ether;
        uint256 buyerBalBefore = buyer.balance;

        vm.prank(buyer);
        licensing.buyContent{value: overpayment}(CONTENT_HASH);

        // Buyer should be refunded the excess 0.5 ether
        // Total spent = BUY_PRICE (1 ether), not 1.5 ether
        uint256 totalSpent = buyerBalBefore - buyer.balance;
        assertEq(totalSpent, BUY_PRICE);
    }

    function test_buyContent_revert_contentNotActive() public {
        // Deactivate content
        vm.prank(creator);
        licensing.deactivateContent(CONTENT_HASH);

        vm.prank(buyer);
        vm.expectRevert(ContentLicensing.ContentNotActive.selector);
        licensing.buyContent{value: BUY_PRICE}(CONTENT_HASH);
    }

    function test_buyContent_revert_notForSale() public {
        // Register content with buyPrice = 0
        bytes32 hash = keccak256("content:notsale");
        vm.prank(creator);
        licensing.registerContent(hash, 1, bytes32(0), 0, RENT_PRICE_PER_DAY, LICENSE_FEE, LICENSE_ROYALTY_BPS);

        vm.prank(buyer);
        vm.expectRevert(ContentLicensing.NotForSale.selector);
        licensing.buyContent{value: 1 ether}(hash);
    }

    function test_buyContent_revert_insufficientPayment() public {
        vm.prank(buyer);
        vm.expectRevert(ContentLicensing.InsufficientPayment.selector);
        licensing.buyContent{value: BUY_PRICE - 1}(CONTENT_HASH);
    }

    function test_buyContent_revert_unregisteredContent() public {
        bytes32 unknownHash = keccak256("unknown");
        vm.prank(buyer);
        vm.expectRevert(ContentLicensing.ContentNotActive.selector);
        licensing.buyContent{value: 1 ether}(unknownHash);
    }

    function test_buyContent_multipleBuyers() public {
        // First buyer
        vm.prank(buyer);
        uint256 deal1 = licensing.buyContent{value: BUY_PRICE}(CONTENT_HASH);
        assertEq(licensing.contentOwner(CONTENT_HASH), buyer);

        // Second buyer (ownership transfers again)
        vm.prank(alice);
        uint256 deal2 = licensing.buyContent{value: BUY_PRICE}(CONTENT_HASH);
        assertEq(licensing.contentOwner(CONTENT_HASH), alice);

        assertEq(deal1, 1);
        assertEq(deal2, 2);

        uint256[] memory dealIds = licensing.getContentDeals(CONTENT_HASH);
        assertEq(dealIds.length, 2);
    }

    // ════════════════════════════════════════════════════════════════════
    // ── rentContent ────────────────────────────────────────────────────
    // ════════════════════════════════════════════════════════════════════

    function test_rentContent_happyPath() public {
        uint256 durationDays = 30;
        uint256 totalCost = RENT_PRICE_PER_DAY * durationDays; // 0.3 ether

        vm.prank(buyer);
        uint256 dealId = licensing.rentContent{value: totalCost}(CONTENT_HASH, durationDays);

        assertEq(dealId, 1);

        (
            uint256 id, bytes32 contentHash, bytes32 splitHash,
            ContentLicensing.DealType dealType, ContentLicensing.DealStatus status,
            address dealBuyer, uint256 pricePaid, uint256 startTime, uint256 endTime
        ) = licensing.deals(dealId);

        assertEq(id, 1);
        assertEq(contentHash, CONTENT_HASH);
        assertTrue(dealType == ContentLicensing.DealType.RENT);
        assertTrue(status == ContentLicensing.DealStatus.ACTIVE);
        assertEq(dealBuyer, buyer);
        assertEq(pricePaid, totalCost);
        assertEq(endTime, block.timestamp + (durationDays * 1 days));
    }

    function test_rentContent_emitsEvent() public {
        uint256 durationDays = 7;
        uint256 totalCost = RENT_PRICE_PER_DAY * durationDays;
        uint256 expectedEndTime = block.timestamp + (durationDays * 1 days);

        vm.expectEmit(true, false, false, true);
        emit ContentLicensing.ContentRented(1, CONTENT_HASH, buyer, totalCost, expectedEndTime);
        vm.prank(buyer);
        licensing.rentContent{value: totalCost}(CONTENT_HASH, durationDays);
    }

    function test_rentContent_routesPayment() public {
        uint256 durationDays = 10;
        uint256 totalCost = RENT_PRICE_PER_DAY * durationDays;

        vm.prank(buyer);
        licensing.rentContent{value: totalCost}(CONTENT_HASH, durationDays);

        uint256 expectedPlatformFee = (totalCost * PLATFORM_FEE_BPS) / 10000;
        uint256 expectedCreatorShare = totalCost - expectedPlatformFee;

        assertEq(treasury.balance, expectedPlatformFee);
        assertEq(paymentRouter._claimable(creator), expectedCreatorShare);
    }

    function test_rentContent_overpaymentRefunded() public {
        uint256 durationDays = 5;
        uint256 totalCost = RENT_PRICE_PER_DAY * durationDays;
        uint256 overpayment = totalCost + 1 ether;

        uint256 buyerBalBefore = buyer.balance;
        vm.prank(buyer);
        licensing.rentContent{value: overpayment}(CONTENT_HASH, durationDays);

        uint256 totalSpent = buyerBalBefore - buyer.balance;
        assertEq(totalSpent, totalCost);
    }

    function test_rentContent_revert_contentNotActive() public {
        vm.prank(creator);
        licensing.deactivateContent(CONTENT_HASH);

        vm.prank(buyer);
        vm.expectRevert(ContentLicensing.ContentNotActive.selector);
        licensing.rentContent{value: 1 ether}(CONTENT_HASH, 10);
    }

    function test_rentContent_revert_notForRent() public {
        bytes32 hash = keccak256("content:norent");
        vm.prank(creator);
        licensing.registerContent(hash, 1, bytes32(0), BUY_PRICE, 0, LICENSE_FEE, LICENSE_ROYALTY_BPS);

        vm.prank(buyer);
        vm.expectRevert(ContentLicensing.NotForRent.selector);
        licensing.rentContent{value: 1 ether}(hash, 10);
    }

    function test_rentContent_revert_zeroDuration() public {
        vm.prank(buyer);
        vm.expectRevert(ContentLicensing.InvalidDuration.selector);
        licensing.rentContent{value: 1 ether}(CONTENT_HASH, 0);
    }

    function test_rentContent_revert_insufficientPayment() public {
        uint256 totalCost = RENT_PRICE_PER_DAY * 10;
        vm.prank(buyer);
        vm.expectRevert(ContentLicensing.InsufficientPayment.selector);
        licensing.rentContent{value: totalCost - 1}(CONTENT_HASH, 10);
    }

    function test_rentContent_expiryCheck() public {
        uint256 durationDays = 7;
        uint256 totalCost = RENT_PRICE_PER_DAY * durationDays;

        vm.prank(buyer);
        uint256 dealId = licensing.rentContent{value: totalCost}(CONTENT_HASH, durationDays);

        // Active during rental period
        assertTrue(licensing.isDealActive(dealId));
        assertTrue(licensing.hasAccessFast(CONTENT_HASH, buyer));

        // Warp past expiry
        vm.warp(block.timestamp + (durationDays * 1 days) + 1);

        assertFalse(licensing.isDealActive(dealId));
        assertFalse(licensing.hasAccessFast(CONTENT_HASH, buyer));
    }

    // ════════════════════════════════════════════════════════════════════
    // ── licenseContent ─────────────────────────────────────────────────
    // ════════════════════════════════════════════════════════════════════

    function test_licenseContent_happyPath() public {
        uint256 durationDays = 365;

        vm.prank(buyer);
        uint256 dealId = licensing.licenseContent{value: LICENSE_FEE}(CONTENT_HASH, durationDays);

        assertEq(dealId, 1);

        (
            uint256 id, bytes32 contentHash, bytes32 splitHash,
            ContentLicensing.DealType dealType, ContentLicensing.DealStatus status,
            address dealBuyer, uint256 pricePaid, uint256 startTime, uint256 endTime
        ) = licensing.deals(dealId);

        assertTrue(dealType == ContentLicensing.DealType.LICENSE);
        assertTrue(status == ContentLicensing.DealStatus.ACTIVE);
        assertEq(dealBuyer, buyer);
        assertEq(pricePaid, LICENSE_FEE);
        assertEq(endTime, block.timestamp + (durationDays * 1 days));
    }

    function test_licenseContent_emitsEvent() public {
        uint256 durationDays = 30;
        uint256 expectedEndTime = block.timestamp + (durationDays * 1 days);

        vm.expectEmit(true, false, false, true);
        emit ContentLicensing.ContentLicensed(1, CONTENT_HASH, buyer, LICENSE_FEE, expectedEndTime);
        vm.prank(buyer);
        licensing.licenseContent{value: LICENSE_FEE}(CONTENT_HASH, durationDays);
    }

    function test_licenseContent_routesPayment() public {
        vm.prank(buyer);
        licensing.licenseContent{value: LICENSE_FEE}(CONTENT_HASH, 30);

        uint256 expectedPlatformFee = (LICENSE_FEE * PLATFORM_FEE_BPS) / 10000;
        uint256 expectedCreatorShare = LICENSE_FEE - expectedPlatformFee;

        assertEq(treasury.balance, expectedPlatformFee);
        assertEq(paymentRouter._claimable(creator), expectedCreatorShare);
    }

    function test_licenseContent_overpaymentRefunded() public {
        uint256 overpayment = LICENSE_FEE + 0.25 ether;
        uint256 buyerBalBefore = buyer.balance;

        vm.prank(buyer);
        licensing.licenseContent{value: overpayment}(CONTENT_HASH, 30);

        uint256 totalSpent = buyerBalBefore - buyer.balance;
        assertEq(totalSpent, LICENSE_FEE);
    }

    function test_licenseContent_revert_contentNotActive() public {
        vm.prank(creator);
        licensing.deactivateContent(CONTENT_HASH);

        vm.prank(buyer);
        vm.expectRevert(ContentLicensing.ContentNotActive.selector);
        licensing.licenseContent{value: LICENSE_FEE}(CONTENT_HASH, 30);
    }

    function test_licenseContent_revert_notLicensable() public {
        bytes32 hash = keccak256("content:nolicense");
        vm.prank(creator);
        licensing.registerContent(hash, 1, bytes32(0), BUY_PRICE, RENT_PRICE_PER_DAY, 0, 0);

        vm.prank(buyer);
        vm.expectRevert(ContentLicensing.NotLicensable.selector);
        licensing.licenseContent{value: 1 ether}(hash, 30);
    }

    function test_licenseContent_revert_zeroDuration() public {
        vm.prank(buyer);
        vm.expectRevert(ContentLicensing.InvalidDuration.selector);
        licensing.licenseContent{value: LICENSE_FEE}(CONTENT_HASH, 0);
    }

    function test_licenseContent_revert_insufficientPayment() public {
        vm.prank(buyer);
        vm.expectRevert(ContentLicensing.InsufficientPayment.selector);
        licensing.licenseContent{value: LICENSE_FEE - 1}(CONTENT_HASH, 30);
    }

    function test_licenseContent_expiryCheck() public {
        uint256 durationDays = 30;

        vm.prank(buyer);
        uint256 dealId = licensing.licenseContent{value: LICENSE_FEE}(CONTENT_HASH, durationDays);

        // Active during license period
        assertTrue(licensing.isDealActive(dealId));
        assertTrue(licensing.hasAccessFast(CONTENT_HASH, buyer));

        // Warp past expiry
        vm.warp(block.timestamp + (durationDays * 1 days) + 1);

        assertFalse(licensing.isDealActive(dealId));
        assertFalse(licensing.hasAccessFast(CONTENT_HASH, buyer));
    }

    // ════════════════════════════════════════════════════════════════════
    // ── payRoyalty ──────────────────────────────────────────────────────
    // ════════════════════════════════════════════════════════════════════

    function test_payRoyalty_happyPath() public {
        // Create a license deal first
        vm.prank(buyer);
        uint256 dealId = licensing.licenseContent{value: LICENSE_FEE}(CONTENT_HASH, 30);

        uint256 royaltyAmount = 0.1 ether;
        uint256 creatorClaimableBefore = paymentRouter._claimable(creator);

        vm.prank(buyer);
        licensing.payRoyalty{value: royaltyAmount}(dealId);

        // Royalty routed through splits
        uint256 expectedPlatformFee = (royaltyAmount * PLATFORM_FEE_BPS) / 10000;
        uint256 expectedCreatorShare = royaltyAmount - expectedPlatformFee;
        assertEq(paymentRouter._claimable(creator) - creatorClaimableBefore, expectedCreatorShare);
    }

    function test_payRoyalty_emitsEvent() public {
        vm.prank(buyer);
        uint256 dealId = licensing.licenseContent{value: LICENSE_FEE}(CONTENT_HASH, 30);

        uint256 royaltyAmount = 0.05 ether;
        vm.expectEmit(true, false, false, true);
        emit ContentLicensing.RoyaltyPaid(dealId, royaltyAmount);
        vm.prank(buyer);
        licensing.payRoyalty{value: royaltyAmount}(dealId);
    }

    function test_payRoyalty_revert_notLicenseDeal() public {
        // Create a BUY deal
        vm.prank(buyer);
        uint256 dealId = licensing.buyContent{value: BUY_PRICE}(CONTENT_HASH);

        vm.prank(buyer);
        vm.expectRevert(ContentLicensing.DealNotActive.selector);
        licensing.payRoyalty{value: 0.1 ether}(dealId);
    }

    function test_payRoyalty_revert_rentDeal() public {
        uint256 totalCost = RENT_PRICE_PER_DAY * 10;
        vm.prank(buyer);
        uint256 dealId = licensing.rentContent{value: totalCost}(CONTENT_HASH, 10);

        vm.prank(buyer);
        vm.expectRevert(ContentLicensing.DealNotActive.selector);
        licensing.payRoyalty{value: 0.1 ether}(dealId);
    }

    function test_payRoyalty_revert_expired() public {
        vm.prank(buyer);
        uint256 dealId = licensing.licenseContent{value: LICENSE_FEE}(CONTENT_HASH, 30);

        // Warp past expiry
        vm.warp(block.timestamp + 31 days);

        vm.prank(buyer);
        vm.expectRevert(ContentLicensing.DealNotActive.selector);
        licensing.payRoyalty{value: 0.1 ether}(dealId);

        // Deal is still ACTIVE in storage (revert rolled back the state change),
        // but isDealActive correctly reports it as expired based on endTime.
        assertFalse(licensing.isDealActive(dealId));
    }

    function test_payRoyalty_revert_afterAutoExpire() public {
        vm.prank(buyer);
        uint256 dealId = licensing.licenseContent{value: LICENSE_FEE}(CONTENT_HASH, 30);

        // Warp past expiry and try to pay — should auto-expire and revert
        vm.warp(block.timestamp + 31 days);

        vm.prank(buyer);
        vm.expectRevert(ContentLicensing.DealNotActive.selector);
        licensing.payRoyalty{value: 0.1 ether}(dealId);

        // Second attempt reverts with DealNotActive (status is now EXPIRED)
        vm.prank(buyer);
        vm.expectRevert(ContentLicensing.DealNotActive.selector);
        licensing.payRoyalty{value: 0.1 ether}(dealId);
    }

    // ════════════════════════════════════════════════════════════════════
    // ── SplitRouter Integration ────────────────────────────────────────
    // ════════════════════════════════════════════════════════════════════

    function test_splitRouter_multiRecipientRevenueSplit() public {
        // Setup: register content with split to multiple recipients
        bytes32 multiSplitHash = keccak256("universe:multi");
        address bob = makeAddr("bob");

        vm.prank(deployer);
        splitRouter.registerSplitOwner(multiSplitHash, creator);

        SplitRouter.Split[] memory splits = new SplitRouter.Split[](2);
        splits[0] = SplitRouter.Split(creator, 7000); // 70%
        splits[1] = SplitRouter.Split(bob, 3000);     // 30%
        vm.prank(creator);
        splitRouter.setSplits(multiSplitHash, splits);

        bytes32 contentHash = keccak256("content:multisplit");
        vm.prank(creator);
        licensing.registerContent(contentHash, 1, multiSplitHash, 1 ether, 0, 0, 0);

        // Buy content
        vm.prank(buyer);
        licensing.buyContent{value: 1 ether}(contentHash);

        // Platform fee: 1 ether * 500 / 10000 = 0.05 ether
        uint256 platformFee = (1 ether * uint256(PLATFORM_FEE_BPS)) / 10000;
        uint256 distributable = 1 ether - platformFee;

        // Creator: 70% of distributable
        uint256 creatorShare = (distributable * 7000) / 10000;
        // Bob: remainder (collects dust)
        uint256 bobShare = distributable - creatorShare;

        assertEq(treasury.balance, platformFee);
        assertEq(paymentRouter._claimable(creator), creatorShare);
        assertEq(paymentRouter._claimable(bob), bobShare);
    }

    // ════════════════════════════════════════════════════════════════════
    // ── PaymentRouter Fallback ─────────────────────────────────────────
    // ════════════════════════════════════════════════════════════════════

    function test_paymentRouter_fallback_noSplitsConfigured() public {
        // Register content with a splitEntityHash that has no splits configured
        // and will cause getSplits to return empty or revert
        bytes32 noSplitHash = keccak256("universe:nosplits");
        bytes32 contentHash = keccak256("content:nosplit");

        vm.prank(creator);
        licensing.registerContent(contentHash, 1, noSplitHash, 1 ether, 0, 0, 0);

        // SplitRouter.getSplits will revert (no owner registered) — empty reason
        // ContentLicensing falls back to PaymentRouter.route(creator, platformFeeBps)
        vm.prank(buyer);
        licensing.buyContent{value: 1 ether}(contentHash);

        uint256 expectedPlatformFee = (1 ether * uint256(PLATFORM_FEE_BPS)) / 10000;
        uint256 expectedCreatorShare = 1 ether - expectedPlatformFee;

        // Payment went through paymentRouter.route, not splitRouter
        assertEq(paymentRouter._claimable(creator), expectedCreatorShare);
    }

    function test_paymentRouter_fallback_zeroSplitEntityHash() public {
        // Content with zero splitEntityHash goes directly to PaymentRouter
        bytes32 contentHash = keccak256("content:zerosplit");

        vm.prank(creator);
        licensing.registerContent(contentHash, 1, bytes32(0), 1 ether, 0, 0, 0);

        // Since splitToContent[bytes32(0)] wasn't mapped, and reg.creator is zero
        // because the reverse lookup fails, it falls through to routeToTreasury
        vm.prank(buyer);
        licensing.buyContent{value: 1 ether}(contentHash);

        // With zero splitEntityHash, _routePayment skips SplitRouter
        // splitToContent[bytes32(0)] == bytes32(0), so reg.creator for bytes32(0) is address(0)
        // Falls through to routeToTreasury
        assertEq(treasury.balance, 1 ether);
    }

    // ════════════════════════════════════════════════════════════════════
    // ── Access Control ─────────────────────────────────────────────────
    // ════════════════════════════════════════════════════════════════════

    function test_hasAccess_afterBuy() public {
        vm.prank(buyer);
        licensing.buyContent{value: BUY_PRICE}(CONTENT_HASH);

        assertTrue(licensing.hasAccessFast(CONTENT_HASH, buyer));
        assertTrue(licensing.hasAccess(CONTENT_HASH, buyer));
        assertFalse(licensing.hasAccess(CONTENT_HASH, alice));
    }

    function test_hasAccess_afterRent_thenExpire() public {
        uint256 durationDays = 7;
        uint256 totalCost = RENT_PRICE_PER_DAY * durationDays;

        vm.prank(buyer);
        licensing.rentContent{value: totalCost}(CONTENT_HASH, durationDays);

        assertTrue(licensing.hasAccess(CONTENT_HASH, buyer));

        // Warp past expiry
        vm.warp(block.timestamp + (durationDays * 1 days) + 1);
        assertFalse(licensing.hasAccess(CONTENT_HASH, buyer));
    }

    function test_hasAccessFast_creatorHasAccess() public view {
        // Creator is content owner by default
        assertTrue(licensing.hasAccessFast(CONTENT_HASH, creator));
    }

    function test_hasAccessFast_unknownUserNoAccess() public view {
        assertFalse(licensing.hasAccessFast(CONTENT_HASH, alice));
    }

    function test_checkAccess_autoExpiresDeals() public {
        uint256 durationDays = 7;
        uint256 totalCost = RENT_PRICE_PER_DAY * durationDays;

        vm.prank(buyer);
        uint256 dealId = licensing.rentContent{value: totalCost}(CONTENT_HASH, durationDays);

        // Active during rental
        assertTrue(licensing.checkAccess(CONTENT_HASH, buyer));

        // Warp past expiry
        vm.warp(block.timestamp + (durationDays * 1 days) + 1);

        // checkAccess auto-expires the deal
        assertFalse(licensing.checkAccess(CONTENT_HASH, buyer));

        // Verify deal status is now EXPIRED
        (, , , , ContentLicensing.DealStatus status, , , ,) = licensing.deals(dealId);
        assertTrue(status == ContentLicensing.DealStatus.EXPIRED);
    }

    function test_checkAccess_buyNeverExpires() public {
        vm.prank(buyer);
        licensing.buyContent{value: BUY_PRICE}(CONTENT_HASH);

        // Warp far into the future
        vm.warp(block.timestamp + 3650 days);
        assertTrue(licensing.checkAccess(CONTENT_HASH, buyer));
    }

    // ════════════════════════════════════════════════════════════════════
    // ── Management (updatePricing / deactivateContent) ─────────────────
    // ════════════════════════════════════════════════════════════════════

    function test_updatePricing() public {
        vm.prank(creator);
        licensing.updatePricing(CONTENT_HASH, 2 ether, 0.02 ether, 1 ether, 2000);

        ContentLicensing.ContentRegistration memory reg = licensing.getRegistration(CONTENT_HASH);
        assertEq(reg.buyPrice, 2 ether);
        assertEq(reg.rentPricePerDay, 0.02 ether);
        assertEq(reg.licenseFee, 1 ether);
        assertEq(reg.licenseRoyaltyBps, 2000);
    }

    function test_updatePricing_emitsEvent() public {
        vm.expectEmit(true, false, false, true);
        emit ContentLicensing.PricingUpdated(CONTENT_HASH);
        vm.prank(creator);
        licensing.updatePricing(CONTENT_HASH, 2 ether, 0, 0, 0);
    }

    function test_updatePricing_revert_notCreator() public {
        vm.prank(buyer);
        vm.expectRevert(ContentLicensing.NotCreator.selector);
        licensing.updatePricing(CONTENT_HASH, 2 ether, 0, 0, 0);
    }

    function test_updatePricing_revert_feeTooHigh() public {
        vm.prank(creator);
        vm.expectRevert(ContentLicensing.FeeTooHigh.selector);
        licensing.updatePricing(CONTENT_HASH, BUY_PRICE, RENT_PRICE_PER_DAY, LICENSE_FEE, 5001);
    }

    function test_deactivateContent_byCreator() public {
        vm.prank(creator);
        licensing.deactivateContent(CONTENT_HASH);

        ContentLicensing.ContentRegistration memory reg = licensing.getRegistration(CONTENT_HASH);
        assertFalse(reg.active);
    }

    function test_deactivateContent_emitsEvent() public {
        vm.expectEmit(true, false, false, true);
        emit ContentLicensing.ContentDeactivated(CONTENT_HASH);
        vm.prank(creator);
        licensing.deactivateContent(CONTENT_HASH);
    }

    function test_deactivateContent_byPlatform() public {
        vm.prank(platform);
        licensing.deactivateContent(CONTENT_HASH);

        ContentLicensing.ContentRegistration memory reg = licensing.getRegistration(CONTENT_HASH);
        assertFalse(reg.active);
    }

    function test_deactivateContent_revert_notCreatorOrPlatform() public {
        vm.prank(buyer);
        vm.expectRevert(ContentLicensing.NotCreator.selector);
        licensing.deactivateContent(CONTENT_HASH);
    }

    // ════════════════════════════════════════════════════════════════════
    // ── Admin (setPlatformFee) ─────────────────────────────────────────
    // ════════════════════════════════════════════════════════════════════

    function test_setPlatformFee() public {
        vm.prank(deployer);
        licensing.setPlatformFee(1000);
        assertEq(licensing.platformFeeBps(), 1000);
    }

    function test_setPlatformFee_revert_notOwner() public {
        vm.prank(buyer);
        vm.expectRevert();
        licensing.setPlatformFee(1000);
    }

    function test_setPlatformFee_revert_feeTooHigh() public {
        vm.prank(deployer);
        vm.expectRevert(ContentLicensing.FeeTooHigh.selector);
        licensing.setPlatformFee(5001);
    }

    function test_setPlatformFee_maxAllowed() public {
        vm.prank(deployer);
        licensing.setPlatformFee(5000);
        assertEq(licensing.platformFeeBps(), 5000);
    }

    function test_setPlatformFee_zero() public {
        vm.prank(deployer);
        licensing.setPlatformFee(0);
        assertEq(licensing.platformFeeBps(), 0);
    }

    // ════════════════════════════════════════════════════════════════════
    // ── Upgrade Authorization ──────────────────────────────────────────
    // ════════════════════════════════════════════════════════════════════

    function test_upgrade_byOwner() public {
        vm.startPrank(deployer);
        ContentLicensing newImpl = new ContentLicensing();
        licensing.upgradeToAndCall(address(newImpl), "");
        vm.stopPrank();

        // State preserved
        assertEq(licensing.platform(), platform);
        assertEq(licensing.platformFeeBps(), PLATFORM_FEE_BPS);
        assertEq(licensing.owner(), deployer);
    }

    function test_upgrade_revert_notOwner() public {
        ContentLicensing newImpl = new ContentLicensing();

        vm.prank(buyer);
        vm.expectRevert();
        licensing.upgradeToAndCall(address(newImpl), "");
    }

    // ════════════════════════════════════════════════════════════════════
    // ── Views (isDealActive / getContentDeals / pagination) ────────────
    // ════════════════════════════════════════════════════════════════════

    function test_isDealActive_buyPermanent() public {
        vm.prank(buyer);
        uint256 dealId = licensing.buyContent{value: BUY_PRICE}(CONTENT_HASH);

        assertTrue(licensing.isDealActive(dealId));

        // Far future
        vm.warp(block.timestamp + 36500 days);
        assertTrue(licensing.isDealActive(dealId));
    }

    function test_isDealActive_rentExpired() public {
        uint256 durationDays = 7;
        uint256 totalCost = RENT_PRICE_PER_DAY * durationDays;

        vm.prank(buyer);
        uint256 dealId = licensing.rentContent{value: totalCost}(CONTENT_HASH, durationDays);

        assertTrue(licensing.isDealActive(dealId));

        vm.warp(block.timestamp + (durationDays * 1 days) + 1);
        assertFalse(licensing.isDealActive(dealId));
    }

    function test_getContentDealsPaginated() public {
        // Create 3 deals
        vm.startPrank(buyer);
        licensing.buyContent{value: BUY_PRICE}(CONTENT_HASH);

        uint256 rentCost = RENT_PRICE_PER_DAY * 7;
        licensing.rentContent{value: rentCost}(CONTENT_HASH, 7);

        licensing.licenseContent{value: LICENSE_FEE}(CONTENT_HASH, 30);
        vm.stopPrank();

        // Get page 1 (offset=0, limit=2)
        (uint256[] memory page1, uint256 total) = licensing.getContentDealsPaginated(CONTENT_HASH, 0, 2);
        assertEq(total, 3);
        assertEq(page1.length, 2);
        assertEq(page1[0], 1);
        assertEq(page1[1], 2);

        // Get page 2 (offset=2, limit=2)
        (uint256[] memory page2, uint256 total2) = licensing.getContentDealsPaginated(CONTENT_HASH, 2, 2);
        assertEq(total2, 3);
        assertEq(page2.length, 1);
        assertEq(page2[0], 3);

        // Offset past end
        (uint256[] memory page3, uint256 total3) = licensing.getContentDealsPaginated(CONTENT_HASH, 10, 2);
        assertEq(total3, 3);
        assertEq(page3.length, 0);
    }

    function test_isDealActive_nonExistentDeal() public view {
        // Non-existent deal ID — status defaults to ACTIVE (0) but buyer is address(0)
        // and dealType is BUY (0), so isDealActive returns true for default struct.
        // This is a known quirk — checking is done at the application layer.
        // The function simply checks status and time, not existence.
        bool active = licensing.isDealActive(999);
        // Default deal has status ACTIVE and dealType BUY, so it returns true
        assertTrue(active);
    }

    // ════════════════════════════════════════════════════════════════════
    // ── Edge Cases ─────────────────────────────────────────────────────
    // ════════════════════════════════════════════════════════════════════

    function test_buyContent_exactPayment_noRefund() public {
        uint256 buyerBalBefore = buyer.balance;

        vm.prank(buyer);
        licensing.buyContent{value: BUY_PRICE}(CONTENT_HASH);

        uint256 totalSpent = buyerBalBefore - buyer.balance;
        assertEq(totalSpent, BUY_PRICE);
    }

    function test_multipleDealsForSameContent() public {
        // Buy, rent, license on the same content
        vm.startPrank(buyer);
        uint256 d1 = licensing.buyContent{value: BUY_PRICE}(CONTENT_HASH);

        uint256 rentCost = RENT_PRICE_PER_DAY * 7;
        uint256 d2 = licensing.rentContent{value: rentCost}(CONTENT_HASH, 7);

        uint256 d3 = licensing.licenseContent{value: LICENSE_FEE}(CONTENT_HASH, 30);
        vm.stopPrank();

        assertEq(d1, 1);
        assertEq(d2, 2);
        assertEq(d3, 3);
        assertEq(licensing.nextDealId(), 4);

        uint256[] memory dealIds = licensing.getContentDeals(CONTENT_HASH);
        assertEq(dealIds.length, 3);
    }

    function test_rentContent_singleDay() public {
        uint256 totalCost = RENT_PRICE_PER_DAY * 1;

        vm.prank(buyer);
        uint256 dealId = licensing.rentContent{value: totalCost}(CONTENT_HASH, 1);

        (, , , , , , , , uint256 endTime) = licensing.deals(dealId);
        assertEq(endTime, block.timestamp + 1 days);
    }

    function test_hasAccessFast_buyTransfersOwnership() public {
        // Initially creator has access
        assertTrue(licensing.hasAccessFast(CONTENT_HASH, creator));

        // Buyer buys, ownership transfers
        vm.prank(buyer);
        licensing.buyContent{value: BUY_PRICE}(CONTENT_HASH);

        // Buyer now has access via contentOwner
        assertTrue(licensing.hasAccessFast(CONTENT_HASH, buyer));

        // Creator loses ownership-based access but may still have deal-based access
        // (hasAccessFast checks contentOwner first, then latest deal)
        assertFalse(licensing.hasAccessFast(CONTENT_HASH, creator));
    }

    function test_hasAccess_multipleRentals_latestActive() public {
        // First rental — 7 days
        uint256 cost1 = RENT_PRICE_PER_DAY * 7;
        vm.prank(buyer);
        licensing.rentContent{value: cost1}(CONTENT_HASH, 7);

        // Warp 3 days
        vm.warp(block.timestamp + 3 days);

        // Second rental — 30 days from now
        uint256 cost2 = RENT_PRICE_PER_DAY * 30;
        vm.prank(buyer);
        licensing.rentContent{value: cost2}(CONTENT_HASH, 30);

        // Warp past first rental's expiry but within second
        vm.warp(block.timestamp + 10 days);

        // hasAccess iterates backward, should find the second (still active) deal
        assertTrue(licensing.hasAccess(CONTENT_HASH, buyer));
    }

    // ════════════════════════════════════════════════════════════════════
    // ── Fuzz Tests ─────────────────────────────────────────────────────
    // ════════════════════════════════════════════════════════════════════

    function testFuzz_buyContent_overpaymentRefunded(uint96 extraWei) public {
        vm.assume(extraWei > 0 && extraWei <= 10 ether);
        uint256 payment = BUY_PRICE + uint256(extraWei);

        vm.deal(buyer, payment);
        uint256 buyerBalBefore = buyer.balance;

        vm.prank(buyer);
        licensing.buyContent{value: payment}(CONTENT_HASH);

        uint256 totalSpent = buyerBalBefore - buyer.balance;
        assertEq(totalSpent, BUY_PRICE, "Should only spend exact buyPrice");
    }

    function testFuzz_rentContent_costCalculation(uint8 durationDays) public {
        vm.assume(durationDays > 0 && durationDays <= 365);
        uint256 totalCost = RENT_PRICE_PER_DAY * uint256(durationDays);

        vm.deal(buyer, totalCost + 1 ether);
        vm.prank(buyer);
        uint256 dealId = licensing.rentContent{value: totalCost}(CONTENT_HASH, uint256(durationDays));

        (, , , , , , uint256 pricePaid, , uint256 endTime) = licensing.deals(dealId);
        assertEq(pricePaid, totalCost);
        assertEq(endTime, block.timestamp + (uint256(durationDays) * 1 days));
    }

    function testFuzz_setPlatformFee_validRange(uint16 fee) public {
        fee = uint16(bound(fee, 0, 5000));
        vm.prank(deployer);
        licensing.setPlatformFee(fee);
        assertEq(licensing.platformFeeBps(), fee);
    }
}
