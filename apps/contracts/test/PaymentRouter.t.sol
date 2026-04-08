// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {PaymentRouter} from "../src/PaymentRouter.sol";

contract PaymentRouterTest is Test {
    PaymentRouter router;
    address treasury = address(0xTREASURY);
    address creator = address(0xCREATOR);
    address buyer = address(0xBUYER);

    function setUp() public {
        vm.deal(treasury, 0);
        vm.deal(buyer, 100 ether);
        router = new PaymentRouter(treasury, 1000); // 10% default fee
    }

    // ── Constructor ──

    function test_constructor_setsParams() public view {
        assertEq(router.treasury(), treasury);
        assertEq(router.defaultPlatformFeeBps(), 1000);
    }

    function test_constructor_revertsZeroTreasury() public {
        vm.expectRevert(PaymentRouter.ZeroAddress.selector);
        new PaymentRouter(address(0), 1000);
    }

    function test_constructor_revertsFeeTooHigh() public {
        vm.expectRevert(PaymentRouter.FeeTooHigh.selector);
        new PaymentRouter(treasury, 5001);
    }

    // ── route ──

    function test_route_splitsCorrectly() public {
        vm.prank(buyer);
        router.route{value: 1 ether}(creator, 1000); // 10%

        assertEq(treasury.balance, 0.1 ether);
        assertEq(router.claimable(creator), 0.9 ether);
    }

    function test_route_zeroFeeUsesDefault() public {
        vm.prank(buyer);
        router.route{value: 1 ether}(creator, 0); // uses default 10%

        assertEq(treasury.balance, 0.1 ether);
        assertEq(router.claimable(creator), 0.9 ether);
    }

    function test_route_zeroValueNoOp() public {
        vm.prank(buyer);
        router.route{value: 0}(creator, 1000);

        assertEq(treasury.balance, 0);
        assertEq(router.claimable(creator), 0);
    }

    function test_route_customFee() public {
        vm.prank(buyer);
        router.route{value: 1 ether}(creator, 2000); // 20%

        assertEq(treasury.balance, 0.2 ether);
        assertEq(router.claimable(creator), 0.8 ether);
    }

    // ── routeToTreasury ──

    function test_routeToTreasury_sendsAll() public {
        vm.prank(buyer);
        router.routeToTreasury{value: 1 ether}();

        assertEq(treasury.balance, 1 ether);
    }

    // ── claim ──

    function test_claim_transfersBalance() public {
        vm.prank(buyer);
        router.route{value: 1 ether}(creator, 1000);

        uint256 before = creator.balance;
        vm.prank(creator);
        router.claim();

        assertEq(creator.balance, before + 0.9 ether);
        assertEq(router.claimable(creator), 0);
    }

    function test_claim_revertsIfNothing() public {
        vm.prank(creator);
        vm.expectRevert(PaymentRouter.NothingToClaim.selector);
        router.claim();
    }

    // ── Admin ──

    function test_setTreasury_works() public {
        address newTreasury = address(0xNEW);
        router.setTreasury(newTreasury);
        assertEq(router.treasury(), newTreasury);
    }

    function test_setTreasury_revertsZero() public {
        vm.expectRevert(PaymentRouter.ZeroAddress.selector);
        router.setTreasury(address(0));
    }

    function test_setDefaultFee_works() public {
        router.setDefaultFee(2000);
        assertEq(router.defaultPlatformFeeBps(), 2000);
    }

    function test_setDefaultFee_revertsAbove5000() public {
        vm.expectRevert(PaymentRouter.FeeTooHigh.selector);
        router.setDefaultFee(5001);
    }

    function test_setDefaultFee_allows5000() public {
        router.setDefaultFee(5000);
        assertEq(router.defaultPlatformFeeBps(), 5000);
    }

    // ── Fee cap on route() ──

    function test_route_revertsAbove5000() public {
        vm.prank(buyer);
        vm.expectRevert(PaymentRouter.FeeTooHigh.selector);
        router.route{value: 1 ether}(creator, 5001);
    }

    function test_route_allows5000() public {
        vm.prank(buyer);
        router.route{value: 1 ether}(creator, 5000);
        assertEq(treasury.balance, 0.5 ether);
        assertEq(router.claimable(creator), 0.5 ether);
    }
}
