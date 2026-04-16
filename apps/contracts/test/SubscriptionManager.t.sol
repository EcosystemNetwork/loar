// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/proxy/ERC1967/ERC1967Proxy.sol";
import {SubscriptionManager} from "../src/revenue/SubscriptionManager.sol";
import {MockPaymentRouter} from "./mocks/MockPaymentRouter.sol";

contract SubscriptionManagerTest is Test {
    SubscriptionManager public sub;
    MockPaymentRouter public router;

    address platform = makeAddr("platform");
    address treasury = makeAddr("treasury");
    address creator = makeAddr("creator");
    address alice = makeAddr("alice");

    uint256 constant UNIVERSE_ID = 1;
    uint16 constant FEE_BPS = 500; // 5%
    uint256 constant PRICE_PER_MONTH = 0.01 ether;

    function setUp() public {
        vm.deal(treasury, 0);
        vm.deal(alice, 100 ether);

        router = new MockPaymentRouter(treasury);
        vm.deal(address(router), 0);

        SubscriptionManager impl = new SubscriptionManager();
        sub = SubscriptionManager(
            address(
                new ERC1967Proxy(
                    address(impl),
                    abi.encodeCall(SubscriptionManager.initialize, (platform, address(router), FEE_BPS))
                )
            )
        );

        // Register universe and configure BASIC tier
        vm.prank(platform);
        sub.registerUniverse(UNIVERSE_ID, creator);

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

    // ---- initialize ----

    function test_initialize() public view {
        assertEq(sub.platform(), platform);
        assertEq(address(sub.paymentRouter()), address(router));
        assertEq(sub.platformFeeBps(), FEE_BPS);
    }

    // ---- registerUniverse ----

    function test_registerUniverse() public view {
        assertEq(sub.universeCreators(UNIVERSE_ID), creator);
    }

    function test_registerUniverse_revert_notPlatform() public {
        vm.prank(alice);
        vm.expectRevert(SubscriptionManager.NotPlatform.selector);
        sub.registerUniverse(2, creator);
    }

    // ---- configureTier ----

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

    // ---- subscribe ----

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

    // ---- cancelSubscription ----

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

    // ---- hasAccess ----

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
}
