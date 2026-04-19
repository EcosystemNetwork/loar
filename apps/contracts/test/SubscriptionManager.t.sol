// SPDX-License-Identifier: MIT
pragma solidity =0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/proxy/ERC1967/ERC1967Proxy.sol";
import {SubscriptionManager} from "../src/revenue/SubscriptionManager.sol";
import {MockPaymentRouter} from "./mocks/MockPaymentRouter.sol";
import {MockUniverseManager} from "./mocks/MockUniverseManager.sol";

contract SubscriptionManagerTest is Test {
    SubscriptionManager public sub;
    MockPaymentRouter public router;
    MockUniverseManager public universeManager;

    address platform = makeAddr("platform");
    address treasury = makeAddr("treasury");
    address creator = makeAddr("creator");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    uint256 constant UNIVERSE_ID = 1;
    uint256 constant UNIVERSE_ID_2 = 2;
    uint16 constant FEE_BPS = 500; // 5%
    uint256 constant PRICE_PER_MONTH = 0.01 ether;

    function setUp() public {
        vm.deal(treasury, 0);
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);

        router = new MockPaymentRouter(treasury);
        vm.deal(address(router), 0);

        universeManager = new MockUniverseManager();
        universeManager.setOwner(UNIVERSE_ID, creator);

        SubscriptionManager impl = new SubscriptionManager();
        sub = SubscriptionManager(
            address(
                new ERC1967Proxy(
                    address(impl),
                    abi.encodeCall(SubscriptionManager.initialize, (platform, address(router), FEE_BPS))
                )
            )
        );

        sub.setUniverseManager(address(universeManager));

        // Register universe and configure BASIC tier
        vm.prank(platform);
        sub.registerUniverse(UNIVERSE_ID);

        vm.prank(creator);
        sub.configureTier(
            UNIVERSE_ID,
            SubscriptionManager.SubscriptionTier.BASIC,
            PRICE_PER_MONTH,
            true,  // earlyAccess
            false, // votingBoost
            true,  // premiumContent
            false, // behindTheScenes
            10     // creditBonus
        );
    }

    // =========================================================================
    //                           1. INITIALIZATION
    // =========================================================================

    function test_initialize() public view {
        assertEq(sub.platform(), platform);
        assertEq(address(sub.paymentRouter()), address(router));
        assertEq(sub.platformFeeBps(), FEE_BPS);
        assertEq(sub.owner(), address(this));
    }

    function test_initialize_revert_zeroAddress_platform() public {
        SubscriptionManager impl = new SubscriptionManager();
        vm.expectRevert(SubscriptionManager.ZeroAddress.selector);
        new ERC1967Proxy(
            address(impl),
            abi.encodeCall(SubscriptionManager.initialize, (address(0), address(router), FEE_BPS))
        );
    }

    function test_initialize_revert_zeroAddress_router() public {
        SubscriptionManager impl = new SubscriptionManager();
        vm.expectRevert(SubscriptionManager.ZeroAddress.selector);
        new ERC1967Proxy(
            address(impl),
            abi.encodeCall(SubscriptionManager.initialize, (platform, address(0), FEE_BPS))
        );
    }

    function test_initialize_revert_feeTooHigh() public {
        SubscriptionManager impl = new SubscriptionManager();
        vm.expectRevert(SubscriptionManager.FeeTooHigh.selector);
        new ERC1967Proxy(
            address(impl),
            abi.encodeCall(SubscriptionManager.initialize, (platform, address(router), 5001))
        );
    }

    function test_initialize_maxFee() public {
        SubscriptionManager impl = new SubscriptionManager();
        SubscriptionManager sub2 = SubscriptionManager(
            address(
                new ERC1967Proxy(
                    address(impl),
                    abi.encodeCall(SubscriptionManager.initialize, (platform, address(router), 5000))
                )
            )
        );
        assertEq(sub2.platformFeeBps(), 5000);
    }

    function test_initialize_revert_doubleInit() public {
        vm.expectRevert();
        sub.initialize(platform, address(router), FEE_BPS);
    }

    // =========================================================================
    //                        2. CREATING SUBSCRIPTION TIERS
    // =========================================================================

    function test_configureTier() public view {
        (
            uint256 pricePerMonth,
            bool earlyAccess,
            bool votingBoost,
            bool premiumContent,
            bool behindTheScenes,
            uint16 creditBonus,
            bool active
        ) = sub.tierConfigs(UNIVERSE_ID, SubscriptionManager.SubscriptionTier.BASIC);

        assertEq(pricePerMonth, PRICE_PER_MONTH);
        assertTrue(earlyAccess);
        assertFalse(votingBoost);
        assertTrue(premiumContent);
        assertFalse(behindTheScenes);
        assertEq(creditBonus, 10);
        assertTrue(active);
    }

    function test_configureTier_platform() public {
        vm.prank(platform);
        sub.configureTier(
            UNIVERSE_ID,
            SubscriptionManager.SubscriptionTier.PREMIUM,
            0.05 ether,
            true, true, true, true, 50
        );

        (uint256 price,,,,,, bool active) =
            sub.tierConfigs(UNIVERSE_ID, SubscriptionManager.SubscriptionTier.PREMIUM);
        assertEq(price, 0.05 ether);
        assertTrue(active);
    }

    function test_configureTier_emitsEvent() public {
        vm.expectEmit(true, false, false, true);
        emit SubscriptionManager.TierConfigured(
            UNIVERSE_ID, SubscriptionManager.SubscriptionTier.VIP, 1 ether
        );

        vm.prank(creator);
        sub.configureTier(
            UNIVERSE_ID,
            SubscriptionManager.SubscriptionTier.VIP,
            1 ether,
            true, true, true, true, 100
        );
    }

    function test_configureTier_revert_notAuthorized() public {
        vm.prank(alice);
        vm.expectRevert(SubscriptionManager.NotAuthorized.selector);
        sub.configureTier(
            UNIVERSE_ID,
            SubscriptionManager.SubscriptionTier.PREMIUM,
            0.05 ether,
            true, true, true, true, 50
        );
    }

    function test_configureTier_zeroPriceTier() public {
        vm.prank(creator);
        sub.configureTier(
            UNIVERSE_ID,
            SubscriptionManager.SubscriptionTier.FREE,
            0,
            false, false, false, false, 0
        );

        (uint256 price,,,,,, bool active) =
            sub.tierConfigs(UNIVERSE_ID, SubscriptionManager.SubscriptionTier.FREE);
        assertEq(price, 0);
        assertTrue(active);
    }

    function test_configureTier_overwrite() public {
        vm.prank(creator);
        sub.configureTier(
            UNIVERSE_ID,
            SubscriptionManager.SubscriptionTier.BASIC,
            0.02 ether,
            false, true, false, true, 20
        );

        (uint256 price, bool ea, bool vb, bool pc, bool bts, uint16 cb, bool active) =
            sub.tierConfigs(UNIVERSE_ID, SubscriptionManager.SubscriptionTier.BASIC);
        assertEq(price, 0.02 ether);
        assertFalse(ea);
        assertTrue(vb);
        assertFalse(pc);
        assertTrue(bts);
        assertEq(cb, 20);
        assertTrue(active);
    }

    // =========================================================================
    //                     3. SUBSCRIBING: ETH, TIER, EXPIRY
    // =========================================================================

    function test_subscribe() public {
        uint256 months = 3;
        uint256 totalPrice = PRICE_PER_MONTH * months;

        vm.prank(alice);
        sub.subscribe{value: totalPrice}(
            UNIVERSE_ID, SubscriptionManager.SubscriptionTier.BASIC, months
        );

        (
            SubscriptionManager.SubscriptionTier tier,
            uint256 expiresAt,
            bool active,
            bool autoRenew
        ) = sub.getSubscription(alice, UNIVERSE_ID);

        assertEq(uint8(tier), uint8(SubscriptionManager.SubscriptionTier.BASIC));
        assertEq(expiresAt, block.timestamp + (months * 30 days));
        assertTrue(active);
        assertTrue(autoRenew);

        // Verify payment was routed
        uint256 expectedCreatorCut = totalPrice - (totalPrice * uint256(FEE_BPS) / 10000);
        assertEq(router._claimable(creator), expectedCreatorCut);
    }

    function test_subscribe_emitsEvent() public {
        uint256 months = 1;
        uint256 expectedExpiry = block.timestamp + (months * 30 days);

        vm.expectEmit(true, true, false, true);
        emit SubscriptionManager.Subscribed(
            alice, UNIVERSE_ID, SubscriptionManager.SubscriptionTier.BASIC, expectedExpiry
        );

        vm.prank(alice);
        sub.subscribe{value: PRICE_PER_MONTH}(
            UNIVERSE_ID, SubscriptionManager.SubscriptionTier.BASIC, months
        );
    }

    function test_subscribe_revert_insufficientPayment() public {
        vm.prank(alice);
        vm.expectRevert(SubscriptionManager.InsufficientPayment.selector);
        sub.subscribe{value: 0.001 ether}(
            UNIVERSE_ID, SubscriptionManager.SubscriptionTier.BASIC, 1
        );
    }

    function test_subscribe_revert_tierNotActive() public {
        vm.prank(alice);
        vm.expectRevert(SubscriptionManager.TierNotActive.selector);
        sub.subscribe{value: 1 ether}(
            UNIVERSE_ID, SubscriptionManager.SubscriptionTier.PREMIUM, 1
        );
    }

    function test_subscribe_revert_zeroMonths() public {
        vm.prank(alice);
        vm.expectRevert(SubscriptionManager.MonthsTooHigh.selector);
        sub.subscribe{value: PRICE_PER_MONTH}(
            UNIVERSE_ID, SubscriptionManager.SubscriptionTier.BASIC, 0
        );
    }

    function test_subscribe_revert_monthsTooHigh() public {
        vm.prank(alice);
        vm.expectRevert(SubscriptionManager.MonthsTooHigh.selector);
        sub.subscribe{value: PRICE_PER_MONTH * 121}(
            UNIVERSE_ID, SubscriptionManager.SubscriptionTier.BASIC, 121
        );
    }

    function test_subscribe_maxMonths() public {
        uint256 months = 120;
        uint256 totalPrice = PRICE_PER_MONTH * months;

        vm.prank(alice);
        sub.subscribe{value: totalPrice}(
            UNIVERSE_ID, SubscriptionManager.SubscriptionTier.BASIC, months
        );

        (, uint256 expiresAt,,) = sub.getSubscription(alice, UNIVERSE_ID);
        assertEq(expiresAt, block.timestamp + (120 * 30 days));
    }

    function test_subscribe_revert_creatorNotRegistered() public {
        // Configure a tier on an unregistered universe via platform
        vm.prank(platform);
        sub.configureTier(
            999,
            SubscriptionManager.SubscriptionTier.BASIC,
            PRICE_PER_MONTH,
            true, false, true, false, 10
        );

        vm.prank(alice);
        vm.expectRevert(SubscriptionManager.CreatorNotRegistered.selector);
        sub.subscribe{value: PRICE_PER_MONTH}(
            999, SubscriptionManager.SubscriptionTier.BASIC, 1
        );
    }

    function test_subscribe_overpaymentRefunded() public {
        uint256 totalPrice = PRICE_PER_MONTH;
        uint256 overpayment = 0.5 ether;
        uint256 aliceBefore = alice.balance;

        vm.prank(alice);
        sub.subscribe{value: totalPrice + overpayment}(
            UNIVERSE_ID, SubscriptionManager.SubscriptionTier.BASIC, 1
        );

        // Alice should only have paid totalPrice, not the overpayment
        assertEq(alice.balance, aliceBefore - totalPrice);
    }

    function test_subscribe_subscriberCountIncremented() public {
        vm.prank(alice);
        sub.subscribe{value: PRICE_PER_MONTH}(
            UNIVERSE_ID, SubscriptionManager.SubscriptionTier.BASIC, 1
        );

        assertEq(sub.subscriberCount(UNIVERSE_ID, SubscriptionManager.SubscriptionTier.BASIC), 1);

        vm.prank(bob);
        sub.subscribe{value: PRICE_PER_MONTH}(
            UNIVERSE_ID, SubscriptionManager.SubscriptionTier.BASIC, 1
        );

        assertEq(sub.subscriberCount(UNIVERSE_ID, SubscriptionManager.SubscriptionTier.BASIC), 2);
    }

    function test_subscribe_zeroPriceTier() public {
        vm.prank(creator);
        sub.configureTier(
            UNIVERSE_ID,
            SubscriptionManager.SubscriptionTier.FREE,
            0,
            false, false, false, false, 0
        );

        vm.prank(alice);
        sub.subscribe{value: 0}(
            UNIVERSE_ID, SubscriptionManager.SubscriptionTier.FREE, 1
        );

        (, uint256 expiresAt, bool active,) = sub.getSubscription(alice, UNIVERSE_ID);
        assertEq(expiresAt, block.timestamp + 30 days);
        assertTrue(active);
    }

    // =========================================================================
    //                 4. RENEWAL: EXTENDING SUBSCRIPTIONS
    // =========================================================================

    function test_subscribe_extension() public {
        uint256 totalPrice = PRICE_PER_MONTH;

        // Subscribe for 1 month
        vm.prank(alice);
        sub.subscribe{value: totalPrice}(
            UNIVERSE_ID, SubscriptionManager.SubscriptionTier.BASIC, 1
        );

        (, uint256 firstExpiry,,) = sub.getSubscription(alice, UNIVERSE_ID);

        // Extend by 2 more months
        vm.prank(alice);
        sub.subscribe{value: PRICE_PER_MONTH * 2}(
            UNIVERSE_ID, SubscriptionManager.SubscriptionTier.BASIC, 2
        );

        (, uint256 newExpiry,,) = sub.getSubscription(alice, UNIVERSE_ID);

        // New expiry should be firstExpiry + 2 months (extending from old expiry)
        assertEq(newExpiry, firstExpiry + (2 * 30 days));
    }

    function test_subscribe_extension_preservesStartedAt() public {
        vm.prank(alice);
        sub.subscribe{value: PRICE_PER_MONTH}(
            UNIVERSE_ID, SubscriptionManager.SubscriptionTier.BASIC, 1
        );

        // Read the recorded startedAt from the contract
        (,, uint256 originalStartedAt,,) = sub.subscriptions(alice, UNIVERSE_ID);

        // Advance 10 days and extend
        vm.warp(block.timestamp + 10 days);

        vm.prank(alice);
        sub.subscribe{value: PRICE_PER_MONTH}(
            UNIVERSE_ID, SubscriptionManager.SubscriptionTier.BASIC, 1
        );

        // startedAt should remain the original timestamp
        (uint256 uid,, uint256 startedAt,,) = sub.subscriptions(alice, UNIVERSE_ID);
        assertEq(uid, UNIVERSE_ID);
        assertEq(startedAt, originalStartedAt);
    }

    function test_subscribe_extension_sameTier_subscriberCountUnchanged() public {
        vm.prank(alice);
        sub.subscribe{value: PRICE_PER_MONTH}(
            UNIVERSE_ID, SubscriptionManager.SubscriptionTier.BASIC, 1
        );

        assertEq(sub.subscriberCount(UNIVERSE_ID, SubscriptionManager.SubscriptionTier.BASIC), 1);

        // Extend same tier while still active
        vm.prank(alice);
        sub.subscribe{value: PRICE_PER_MONTH}(
            UNIVERSE_ID, SubscriptionManager.SubscriptionTier.BASIC, 1
        );

        // Count should remain 1, not double
        assertEq(sub.subscriberCount(UNIVERSE_ID, SubscriptionManager.SubscriptionTier.BASIC), 1);
    }

    function test_subscribe_tierChange_countsUpdated() public {
        // Configure PREMIUM tier
        vm.prank(creator);
        sub.configureTier(
            UNIVERSE_ID,
            SubscriptionManager.SubscriptionTier.PREMIUM,
            0.05 ether,
            true, true, true, true, 50
        );

        // Subscribe to BASIC
        vm.prank(alice);
        sub.subscribe{value: PRICE_PER_MONTH}(
            UNIVERSE_ID, SubscriptionManager.SubscriptionTier.BASIC, 1
        );

        assertEq(sub.subscriberCount(UNIVERSE_ID, SubscriptionManager.SubscriptionTier.BASIC), 1);
        assertEq(sub.subscriberCount(UNIVERSE_ID, SubscriptionManager.SubscriptionTier.PREMIUM), 0);

        // Upgrade to PREMIUM while BASIC is still active
        vm.prank(alice);
        sub.subscribe{value: 0.05 ether}(
            UNIVERSE_ID, SubscriptionManager.SubscriptionTier.PREMIUM, 1
        );

        // BASIC count decremented, PREMIUM incremented
        assertEq(sub.subscriberCount(UNIVERSE_ID, SubscriptionManager.SubscriptionTier.BASIC), 0);
        assertEq(sub.subscriberCount(UNIVERSE_ID, SubscriptionManager.SubscriptionTier.PREMIUM), 1);
    }

    function test_subscribe_afterExpiry_countsUpdated() public {
        vm.prank(alice);
        sub.subscribe{value: PRICE_PER_MONTH}(
            UNIVERSE_ID, SubscriptionManager.SubscriptionTier.BASIC, 1
        );

        assertEq(sub.subscriberCount(UNIVERSE_ID, SubscriptionManager.SubscriptionTier.BASIC), 1);

        // Warp past expiry
        vm.warp(block.timestamp + 31 days);

        // Re-subscribe (expired path)
        vm.prank(alice);
        sub.subscribe{value: PRICE_PER_MONTH}(
            UNIVERSE_ID, SubscriptionManager.SubscriptionTier.BASIC, 1
        );

        // Count should still be 1 (old decremented, new incremented)
        assertEq(sub.subscriberCount(UNIVERSE_ID, SubscriptionManager.SubscriptionTier.BASIC), 1);
    }

    function test_subscribe_afterExpiry_startsFromNow() public {
        vm.prank(alice);
        sub.subscribe{value: PRICE_PER_MONTH}(
            UNIVERSE_ID, SubscriptionManager.SubscriptionTier.BASIC, 1
        );

        // Warp well past expiry
        vm.warp(block.timestamp + 60 days);
        uint256 resubTime = block.timestamp;

        vm.prank(alice);
        sub.subscribe{value: PRICE_PER_MONTH}(
            UNIVERSE_ID, SubscriptionManager.SubscriptionTier.BASIC, 1
        );

        (, uint256 expiresAt,,) = sub.getSubscription(alice, UNIVERSE_ID);
        // Should start from now, not from old expiry
        assertEq(expiresAt, resubTime + 30 days);
    }

    // =========================================================================
    //                        5. CANCELLATION
    // =========================================================================

    function test_cancelSubscription() public {
        vm.prank(alice);
        sub.subscribe{value: PRICE_PER_MONTH}(
            UNIVERSE_ID, SubscriptionManager.SubscriptionTier.BASIC, 1
        );

        vm.prank(alice);
        sub.cancelSubscription(UNIVERSE_ID);

        (,,, bool autoRenew) = sub.getSubscription(alice, UNIVERSE_ID);
        assertFalse(autoRenew);
    }

    function test_cancelSubscription_emitsEvent() public {
        vm.prank(alice);
        sub.subscribe{value: PRICE_PER_MONTH}(
            UNIVERSE_ID, SubscriptionManager.SubscriptionTier.BASIC, 1
        );

        vm.expectEmit(true, true, false, false);
        emit SubscriptionManager.SubscriptionCancelled(alice, UNIVERSE_ID);

        vm.prank(alice);
        sub.cancelSubscription(UNIVERSE_ID);
    }

    function test_cancelSubscription_revert_noActiveSubscription() public {
        vm.prank(alice);
        vm.expectRevert(SubscriptionManager.NoActiveSubscription.selector);
        sub.cancelSubscription(UNIVERSE_ID);
    }

    function test_cancelSubscription_accessStillValidUntilExpiry() public {
        vm.prank(alice);
        sub.subscribe{value: PRICE_PER_MONTH}(
            UNIVERSE_ID, SubscriptionManager.SubscriptionTier.BASIC, 1
        );

        vm.prank(alice);
        sub.cancelSubscription(UNIVERSE_ID);

        // Still has access until expiry
        assertTrue(sub.hasAccess(alice, UNIVERSE_ID, SubscriptionManager.SubscriptionTier.BASIC));

        // No access after expiry
        vm.warp(block.timestamp + 31 days);
        assertFalse(sub.hasAccess(alice, UNIVERSE_ID, SubscriptionManager.SubscriptionTier.BASIC));
    }

    // =========================================================================
    //                     6. FEE ROUTING VIA PAYMENTROUTER
    // =========================================================================

    function test_subscribe_feeRouting() public {
        uint256 months = 2;
        uint256 totalPrice = PRICE_PER_MONTH * months;
        uint256 expectedPlatformCut = (totalPrice * uint256(FEE_BPS)) / 10000;
        uint256 expectedCreatorCut = totalPrice - expectedPlatformCut;

        vm.prank(alice);
        sub.subscribe{value: totalPrice}(
            UNIVERSE_ID, SubscriptionManager.SubscriptionTier.BASIC, months
        );

        assertEq(router._claimable(creator), expectedCreatorCut);
        assertEq(treasury.balance, expectedPlatformCut);
    }

    function test_subscribe_zeroPriceTier_noRouting() public {
        vm.prank(creator);
        sub.configureTier(
            UNIVERSE_ID,
            SubscriptionManager.SubscriptionTier.FREE,
            0,
            false, false, false, false, 0
        );

        uint256 routerBalBefore = address(router).balance;

        vm.prank(alice);
        sub.subscribe{value: 0}(
            UNIVERSE_ID, SubscriptionManager.SubscriptionTier.FREE, 1
        );

        // Router should not have received anything
        assertEq(address(router).balance, routerBalBefore);
    }

    // =========================================================================
    //                     7. ACCESS CONTROL (OWNER, PLATFORM)
    // =========================================================================

    // -- registerUniverse --

    function test_registerUniverse() public view {
        assertEq(sub.universeCreators(UNIVERSE_ID), creator);
    }

    function test_registerUniverse_revert_notPlatform() public {
        universeManager.setOwner(2, creator);
        vm.prank(alice);
        vm.expectRevert(SubscriptionManager.NotPlatform.selector);
        sub.registerUniverse(2);
    }

    function test_registerUniverse_revert_zeroCreator() public {
        // universeManager has no owner set for id 2, so ownerOf reverts
        vm.prank(platform);
        vm.expectRevert("ERC721: invalid token ID");
        sub.registerUniverse(2);
    }

    function test_registerUniverse_emitsEvent() public {
        universeManager.setOwner(42, bob);
        vm.expectEmit(true, false, false, true);
        emit SubscriptionManager.UniverseRegistered(42, bob);

        vm.prank(platform);
        sub.registerUniverse(42);
    }

    // -- owner-only functions --

    function test_pause_revert_notOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        sub.pause();
    }

    function test_unpause_revert_notOwner() public {
        sub.pause();
        vm.prank(alice);
        vm.expectRevert();
        sub.unpause();
    }

    // =========================================================================
    //                 8. TIER MANAGEMENT (UPDATE, DEACTIVATE)
    // =========================================================================

    function test_deactivateTier_byCreator() public {
        vm.prank(creator);
        sub.deactivateTier(UNIVERSE_ID, SubscriptionManager.SubscriptionTier.BASIC);

        (,,,,,, bool active) =
            sub.tierConfigs(UNIVERSE_ID, SubscriptionManager.SubscriptionTier.BASIC);
        assertFalse(active);
    }

    function test_deactivateTier_byPlatform() public {
        vm.prank(platform);
        sub.deactivateTier(UNIVERSE_ID, SubscriptionManager.SubscriptionTier.BASIC);

        (,,,,,, bool active) =
            sub.tierConfigs(UNIVERSE_ID, SubscriptionManager.SubscriptionTier.BASIC);
        assertFalse(active);
    }

    function test_deactivateTier_emitsEvent() public {
        vm.expectEmit(true, false, false, true);
        emit SubscriptionManager.TierDeactivated(UNIVERSE_ID, SubscriptionManager.SubscriptionTier.BASIC);

        vm.prank(creator);
        sub.deactivateTier(UNIVERSE_ID, SubscriptionManager.SubscriptionTier.BASIC);
    }

    function test_deactivateTier_revert_notAuthorized() public {
        vm.prank(alice);
        vm.expectRevert(SubscriptionManager.NotAuthorized.selector);
        sub.deactivateTier(UNIVERSE_ID, SubscriptionManager.SubscriptionTier.BASIC);
    }

    function test_deactivateTier_preventsNewSubscriptions() public {
        vm.prank(creator);
        sub.deactivateTier(UNIVERSE_ID, SubscriptionManager.SubscriptionTier.BASIC);

        vm.prank(alice);
        vm.expectRevert(SubscriptionManager.TierNotActive.selector);
        sub.subscribe{value: PRICE_PER_MONTH}(
            UNIVERSE_ID, SubscriptionManager.SubscriptionTier.BASIC, 1
        );
    }

    function test_deactivateTier_existingSubscriptionsStillValid() public {
        // Subscribe first
        vm.prank(alice);
        sub.subscribe{value: PRICE_PER_MONTH}(
            UNIVERSE_ID, SubscriptionManager.SubscriptionTier.BASIC, 1
        );

        // Deactivate tier
        vm.prank(creator);
        sub.deactivateTier(UNIVERSE_ID, SubscriptionManager.SubscriptionTier.BASIC);

        // Existing subscription should still be active
        assertTrue(sub.hasAccess(alice, UNIVERSE_ID, SubscriptionManager.SubscriptionTier.BASIC));
    }

    function test_reactivateTier() public {
        vm.prank(creator);
        sub.deactivateTier(UNIVERSE_ID, SubscriptionManager.SubscriptionTier.BASIC);

        // Re-configure re-activates
        vm.prank(creator);
        sub.configureTier(
            UNIVERSE_ID,
            SubscriptionManager.SubscriptionTier.BASIC,
            0.02 ether,
            true, true, true, true, 20
        );

        (uint256 price,,,,,, bool active) =
            sub.tierConfigs(UNIVERSE_ID, SubscriptionManager.SubscriptionTier.BASIC);
        assertEq(price, 0.02 ether);
        assertTrue(active);
    }

    // =========================================================================
    //                          9. EDGE CASES
    // =========================================================================

    function test_hasAccess() public {
        vm.prank(alice);
        sub.subscribe{value: PRICE_PER_MONTH}(
            UNIVERSE_ID, SubscriptionManager.SubscriptionTier.BASIC, 1
        );

        // BASIC (1) >= FREE (0)
        assertTrue(sub.hasAccess(alice, UNIVERSE_ID, SubscriptionManager.SubscriptionTier.FREE));
        // BASIC (1) >= BASIC (1)
        assertTrue(sub.hasAccess(alice, UNIVERSE_ID, SubscriptionManager.SubscriptionTier.BASIC));
        // BASIC (1) < PREMIUM (2)
        assertFalse(sub.hasAccess(alice, UNIVERSE_ID, SubscriptionManager.SubscriptionTier.PREMIUM));
    }

    function test_hasAccess_expired() public {
        vm.prank(alice);
        sub.subscribe{value: PRICE_PER_MONTH}(
            UNIVERSE_ID, SubscriptionManager.SubscriptionTier.BASIC, 1
        );

        // Warp past expiry
        vm.warp(block.timestamp + 31 days);

        assertFalse(sub.hasAccess(alice, UNIVERSE_ID, SubscriptionManager.SubscriptionTier.FREE));
    }

    function test_hasAccess_noSubscription() public view {
        assertFalse(sub.hasAccess(alice, UNIVERSE_ID, SubscriptionManager.SubscriptionTier.FREE));
    }

    function test_getSubscription_noSubscription() public view {
        (
            SubscriptionManager.SubscriptionTier tier,
            uint256 expiresAt,
            bool active,
            bool autoRenew
        ) = sub.getSubscription(alice, UNIVERSE_ID);

        assertEq(uint8(tier), uint8(SubscriptionManager.SubscriptionTier.FREE));
        assertEq(expiresAt, 0);
        assertFalse(active);
        assertFalse(autoRenew);
    }

    function test_subscribe_multipleUniverses() public {
        // Register second universe
        universeManager.setOwner(UNIVERSE_ID_2, bob);
        vm.prank(platform);
        sub.registerUniverse(UNIVERSE_ID_2);

        vm.prank(bob);
        sub.configureTier(
            UNIVERSE_ID_2,
            SubscriptionManager.SubscriptionTier.BASIC,
            0.02 ether,
            true, false, true, false, 5
        );

        // Alice subscribes to both
        vm.startPrank(alice);
        sub.subscribe{value: PRICE_PER_MONTH}(
            UNIVERSE_ID, SubscriptionManager.SubscriptionTier.BASIC, 1
        );
        sub.subscribe{value: 0.02 ether}(
            UNIVERSE_ID_2, SubscriptionManager.SubscriptionTier.BASIC, 1
        );
        vm.stopPrank();

        assertTrue(sub.hasAccess(alice, UNIVERSE_ID, SubscriptionManager.SubscriptionTier.BASIC));
        assertTrue(sub.hasAccess(alice, UNIVERSE_ID_2, SubscriptionManager.SubscriptionTier.BASIC));
    }

    function test_subscribe_multipleUsers() public {
        vm.prank(alice);
        sub.subscribe{value: PRICE_PER_MONTH}(
            UNIVERSE_ID, SubscriptionManager.SubscriptionTier.BASIC, 1
        );

        vm.prank(bob);
        sub.subscribe{value: PRICE_PER_MONTH}(
            UNIVERSE_ID, SubscriptionManager.SubscriptionTier.BASIC, 1
        );

        assertTrue(sub.hasAccess(alice, UNIVERSE_ID, SubscriptionManager.SubscriptionTier.BASIC));
        assertTrue(sub.hasAccess(bob, UNIVERSE_ID, SubscriptionManager.SubscriptionTier.BASIC));
        assertEq(sub.subscriberCount(UNIVERSE_ID, SubscriptionManager.SubscriptionTier.BASIC), 2);
    }

    function test_subscribe_afterExpiry_differentTier_countsCorrect() public {
        // Configure PREMIUM
        vm.prank(creator);
        sub.configureTier(
            UNIVERSE_ID,
            SubscriptionManager.SubscriptionTier.PREMIUM,
            0.05 ether,
            true, true, true, true, 50
        );

        // Subscribe to BASIC
        vm.prank(alice);
        sub.subscribe{value: PRICE_PER_MONTH}(
            UNIVERSE_ID, SubscriptionManager.SubscriptionTier.BASIC, 1
        );

        // Warp past expiry
        vm.warp(block.timestamp + 31 days);

        // Re-subscribe to PREMIUM
        vm.prank(alice);
        sub.subscribe{value: 0.05 ether}(
            UNIVERSE_ID, SubscriptionManager.SubscriptionTier.PREMIUM, 1
        );

        // BASIC should have 0, PREMIUM should have 1
        assertEq(sub.subscriberCount(UNIVERSE_ID, SubscriptionManager.SubscriptionTier.BASIC), 0);
        assertEq(sub.subscriberCount(UNIVERSE_ID, SubscriptionManager.SubscriptionTier.PREMIUM), 1);
    }

    function test_cancelSubscription_canResubscribeAfterExpiry() public {
        vm.prank(alice);
        sub.subscribe{value: PRICE_PER_MONTH}(
            UNIVERSE_ID, SubscriptionManager.SubscriptionTier.BASIC, 1
        );

        vm.prank(alice);
        sub.cancelSubscription(UNIVERSE_ID);

        // Warp past expiry
        vm.warp(block.timestamp + 31 days);

        // Re-subscribe should work
        vm.prank(alice);
        sub.subscribe{value: PRICE_PER_MONTH}(
            UNIVERSE_ID, SubscriptionManager.SubscriptionTier.BASIC, 1
        );

        assertTrue(sub.hasAccess(alice, UNIVERSE_ID, SubscriptionManager.SubscriptionTier.BASIC));
    }

    // =========================================================================
    //                     10. PAUSE FUNCTIONALITY
    // =========================================================================

    function test_pause_blocksSubscribe() public {
        sub.pause();

        vm.prank(alice);
        vm.expectRevert();
        sub.subscribe{value: PRICE_PER_MONTH}(
            UNIVERSE_ID, SubscriptionManager.SubscriptionTier.BASIC, 1
        );
    }

    function test_unpause_allowsSubscribe() public {
        sub.pause();
        sub.unpause();

        vm.prank(alice);
        sub.subscribe{value: PRICE_PER_MONTH}(
            UNIVERSE_ID, SubscriptionManager.SubscriptionTier.BASIC, 1
        );

        assertTrue(sub.hasAccess(alice, UNIVERSE_ID, SubscriptionManager.SubscriptionTier.BASIC));
    }

    function test_pause_doesNotBlockViewFunctions() public {
        // Subscribe first
        vm.prank(alice);
        sub.subscribe{value: PRICE_PER_MONTH}(
            UNIVERSE_ID, SubscriptionManager.SubscriptionTier.BASIC, 1
        );

        sub.pause();

        // View functions should still work
        assertTrue(sub.hasAccess(alice, UNIVERSE_ID, SubscriptionManager.SubscriptionTier.BASIC));
        sub.getSubscription(alice, UNIVERSE_ID);
    }

    function test_pause_doesNotBlockCancel() public {
        vm.prank(alice);
        sub.subscribe{value: PRICE_PER_MONTH}(
            UNIVERSE_ID, SubscriptionManager.SubscriptionTier.BASIC, 1
        );

        sub.pause();

        // cancelSubscription is NOT whenNotPaused guarded, should work
        vm.prank(alice);
        sub.cancelSubscription(UNIVERSE_ID);

        (,,, bool autoRenew) = sub.getSubscription(alice, UNIVERSE_ID);
        assertFalse(autoRenew);
    }

    function test_pause_doesNotBlockTierConfig() public {
        sub.pause();

        // configureTier is NOT whenNotPaused guarded
        vm.prank(creator);
        sub.configureTier(
            UNIVERSE_ID,
            SubscriptionManager.SubscriptionTier.VIP,
            1 ether,
            true, true, true, true, 100
        );

        (uint256 price,,,,,, bool active) =
            sub.tierConfigs(UNIVERSE_ID, SubscriptionManager.SubscriptionTier.VIP);
        assertEq(price, 1 ether);
        assertTrue(active);
    }

    // =========================================================================
    //                     11. UPGRADE AUTHORIZATION
    // =========================================================================

    function test_upgradeToAndCall_onlyOwner() public {
        SubscriptionManager newImpl = new SubscriptionManager();

        // Owner can upgrade
        sub.upgradeToAndCall(address(newImpl), "");

        // Non-owner cannot upgrade
        SubscriptionManager newerImpl = new SubscriptionManager();
        vm.prank(alice);
        vm.expectRevert();
        sub.upgradeToAndCall(address(newerImpl), "");
    }

    function test_upgrade_preservesState() public {
        // Subscribe first
        vm.prank(alice);
        sub.subscribe{value: PRICE_PER_MONTH}(
            UNIVERSE_ID, SubscriptionManager.SubscriptionTier.BASIC, 1
        );

        // Upgrade
        SubscriptionManager newImpl = new SubscriptionManager();
        sub.upgradeToAndCall(address(newImpl), "");

        // State should be preserved
        assertTrue(sub.hasAccess(alice, UNIVERSE_ID, SubscriptionManager.SubscriptionTier.BASIC));
        assertEq(sub.platform(), platform);
        assertEq(sub.universeCreators(UNIVERSE_ID), creator);
    }
}
