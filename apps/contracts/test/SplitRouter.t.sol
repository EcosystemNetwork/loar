// SPDX-License-Identifier: MIT
pragma solidity =0.8.30;

import {Test} from "forge-std/Test.sol";
import {SplitRouter} from "../src/SplitRouter.sol";
import {MockPaymentRouter} from "./mocks/MockPaymentRouter.sol";

contract SplitRouterTest is Test {
    SplitRouter public splitRouter;
    MockPaymentRouter public router;

    address owner = makeAddr("owner");
    address treasury = makeAddr("treasury");
    address registrar = makeAddr("registrar");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");
    address sender = makeAddr("sender");

    bytes32 constant ENTITY_HASH = keccak256("universe:1");

    function setUp() public {
        vm.deal(treasury, 0);
        vm.deal(sender, 100 ether);

        vm.startPrank(owner);
        router = new MockPaymentRouter(treasury);
        splitRouter = new SplitRouter(address(router));
        splitRouter.setRegistrar(registrar, true);
        vm.stopPrank();
    }

    // ---- Constructor ----

    function test_constructor() public view {
        assertEq(address(splitRouter.paymentRouter()), address(router));
        assertEq(splitRouter.owner(), owner);
    }

    // ---- Registrar management ----

    function test_setRegistrar() public {
        address newRegistrar = makeAddr("newRegistrar");
        vm.prank(owner);
        splitRouter.setRegistrar(newRegistrar, true);
        assertTrue(splitRouter.registrars(newRegistrar));

        vm.prank(owner);
        splitRouter.setRegistrar(newRegistrar, false);
        assertFalse(splitRouter.registrars(newRegistrar));
    }

    // ---- Split ownership ----

    function test_registerSplitOwner() public {
        vm.prank(registrar);
        splitRouter.registerSplitOwner(ENTITY_HASH, alice);
        assertEq(splitRouter.splitOwner(ENTITY_HASH), alice);
    }

    function test_registerSplitOwner_revert_notRegistrar() public {
        vm.prank(alice);
        vm.expectRevert(SplitRouter.NotRegistrar.selector);
        splitRouter.registerSplitOwner(ENTITY_HASH, alice);
    }

    // ---- setSplits ----

    function test_setSplits() public {
        _registerAndSetSplits();

        SplitRouter.Split[] memory splits = splitRouter.getSplits(ENTITY_HASH);
        assertEq(splits.length, 2);
        assertEq(splits[0].recipient, alice);
        assertEq(splits[0].bps, 7000);
        assertEq(splits[1].recipient, bob);
        assertEq(splits[1].bps, 3000);
    }

    function test_setSplits_revert_invalidTotal() public {
        vm.prank(registrar);
        splitRouter.registerSplitOwner(ENTITY_HASH, alice);

        SplitRouter.Split[] memory splits = new SplitRouter.Split[](2);
        splits[0] = SplitRouter.Split(alice, 5000);
        splits[1] = SplitRouter.Split(bob, 4000); // total 9000 != 10000

        vm.prank(alice);
        vm.expectRevert(SplitRouter.InvalidSplitTotal.selector);
        splitRouter.setSplits(ENTITY_HASH, splits);
    }

    function test_setSplits_revert_tooManyRecipients() public {
        vm.prank(registrar);
        splitRouter.registerSplitOwner(ENTITY_HASH, alice);

        // 11 recipients — over the MAX_RECIPIENTS (10) limit
        SplitRouter.Split[] memory splits = new SplitRouter.Split[](11);
        for (uint256 i = 0; i < 11; i++) {
            splits[i] = SplitRouter.Split(makeAddr(string(abi.encodePacked("r", i))), 909);
        }

        vm.prank(alice);
        vm.expectRevert(SplitRouter.TooManyRecipients.selector);
        splitRouter.setSplits(ENTITY_HASH, splits);
    }

    function test_setSplits_revert_notOwner() public {
        vm.prank(registrar);
        splitRouter.registerSplitOwner(ENTITY_HASH, alice);

        SplitRouter.Split[] memory splits = new SplitRouter.Split[](1);
        splits[0] = SplitRouter.Split(bob, 10000);

        vm.prank(bob); // bob is not the split owner
        vm.expectRevert(SplitRouter.NotSplitOwner.selector);
        splitRouter.setSplits(ENTITY_HASH, splits);
    }

    // ---- routeWithSplits ----

    function test_routeWithSplits() public {
        _registerAndSetSplits();

        uint256 payment = 1 ether;
        uint16 feeBps = 500; // 5%

        vm.prank(sender);
        splitRouter.routeWithSplits{value: payment}(ENTITY_HASH, feeBps);

        // Platform cut: 1 ether * 500 / 10000 = 0.05 ether
        uint256 expectedPlatformCut = (payment * feeBps) / 10000;
        assertEq(treasury.balance, expectedPlatformCut);

        // Distributable: 1 ether - 0.05 ether = 0.95 ether
        uint256 distributable = payment - expectedPlatformCut;

        // Alice: 70% of 0.95 = 0.665 ether
        uint256 aliceShare = (distributable * 7000) / 10000;
        assertEq(router._claimable(alice), aliceShare);

        // Bob gets remainder (distributable - aliceShare) to collect dust
        uint256 bobShare = distributable - aliceShare;
        assertEq(router._claimable(bob), bobShare);
    }

    function test_routeWithSplits_dustToLastRecipient() public {
        // Use 3 recipients with splits that cause rounding
        vm.prank(registrar);
        splitRouter.registerSplitOwner(ENTITY_HASH, alice);

        SplitRouter.Split[] memory splits = new SplitRouter.Split[](3);
        splits[0] = SplitRouter.Split(alice, 3333);
        splits[1] = SplitRouter.Split(bob, 3333);
        splits[2] = SplitRouter.Split(carol, 3334);

        vm.prank(alice);
        splitRouter.setSplits(ENTITY_HASH, splits);

        uint256 payment = 1 ether;
        vm.prank(sender);
        splitRouter.routeWithSplits{value: payment}(ENTITY_HASH, 0); // no platform fee for simpler math

        uint256 aliceShare = (payment * 3333) / 10000;
        uint256 bobShare = (payment * 3333) / 10000;
        uint256 carolShare = payment - aliceShare - bobShare; // remainder

        assertEq(router._claimable(alice), aliceShare);
        assertEq(router._claimable(bob), bobShare);
        assertEq(router._claimable(carol), carolShare);

        // Verify total distributed == payment (no ETH stuck)
        assertEq(aliceShare + bobShare + carolShare, payment);
    }

    // ---- Transfer ownership ----

    function test_transferSplitOwnership() public {
        vm.prank(registrar);
        splitRouter.registerSplitOwner(ENTITY_HASH, alice);

        vm.prank(alice);
        splitRouter.transferSplitOwnership(ENTITY_HASH, bob);

        assertEq(splitRouter.splitOwner(ENTITY_HASH), bob);
    }

    // ---- Helpers ----

    function _registerAndSetSplits() internal {
        vm.prank(registrar);
        splitRouter.registerSplitOwner(ENTITY_HASH, alice);

        SplitRouter.Split[] memory splits = new SplitRouter.Split[](2);
        splits[0] = SplitRouter.Split(alice, 7000);
        splits[1] = SplitRouter.Split(bob, 3000);

        vm.prank(alice);
        splitRouter.setSplits(ENTITY_HASH, splits);
    }
}
