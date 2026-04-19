// SPDX-License-Identifier: MIT
pragma solidity =0.8.30;

import {Test} from "forge-std/Test.sol";
import {LoarFeeLocker} from "../src/LoarFeeLocker.sol";
import {ILoarFeeLocker} from "../src/interfaces/ILoarFeeLocker.sol";
import {LoarToken} from "../src/LoarToken.sol";

contract LoarFeeLockerTest is Test {
    LoarFeeLocker public locker;
    LoarToken public token;

    address owner = makeAddr("owner");
    address depositor = makeAddr("depositor");
    address feeOwner = makeAddr("feeOwner");
    address treasury = makeAddr("treasury");
    address holder = makeAddr("holder");
    address alice = makeAddr("alice");

    function setUp() public {
        vm.startPrank(owner);
        locker = new LoarFeeLocker(owner);
        token = new LoarToken(treasury, holder);
        vm.stopPrank();

        // Give depositor some tokens (from treasury, fee-exempt)
        vm.prank(treasury);
        token.transfer(depositor, 100_000e18);

        // Depositor approves locker
        vm.prank(depositor);
        token.approve(address(locker), type(uint256).max);

        // Whitelist depositor
        vm.prank(owner);
        locker.addDepositor(depositor);
    }

    // ── Depositor management ──

    function test_addDepositor() public {
        address newDepositor = makeAddr("newDepositor");
        vm.prank(owner);
        locker.addDepositor(newDepositor);
        assertTrue(locker.allowedDepositors(newDepositor));
    }

    function test_removeDepositor() public {
        vm.prank(owner);
        locker.removeDepositor(depositor);
        assertFalse(locker.allowedDepositors(depositor));
    }

    // ── storeFees ──

    function test_storeFees() public {
        uint256 amount = 1_000e18;

        vm.prank(depositor);
        locker.storeFees(feeOwner, address(token), amount);

        assertEq(locker.availableFees(feeOwner, address(token)), amount);
        assertEq(token.balanceOf(address(locker)), amount);
    }

    function test_storeFees_revert_unauthorized() public {
        vm.prank(alice);
        vm.expectRevert(ILoarFeeLocker.Unauthorized.selector);
        locker.storeFees(feeOwner, address(token), 1_000e18);
    }

    function test_storeFees_multiple() public {
        vm.startPrank(depositor);
        locker.storeFees(feeOwner, address(token), 1_000e18);
        locker.storeFees(feeOwner, address(token), 2_000e18);
        vm.stopPrank();

        assertEq(locker.availableFees(feeOwner, address(token)), 3_000e18);
    }

    // ── claim ──

    function test_claim() public {
        uint256 amount = 5_000e18;
        vm.prank(depositor);
        locker.storeFees(feeOwner, address(token), amount);

        uint256 balBefore = token.balanceOf(feeOwner);

        vm.prank(feeOwner);
        locker.claim(address(token));

        assertEq(token.balanceOf(feeOwner), balBefore + amount);
        assertEq(locker.availableFees(feeOwner, address(token)), 0);
    }

    function test_claim_revert_noFees() public {
        vm.prank(alice);
        vm.expectRevert(ILoarFeeLocker.NoFeesToClaim.selector);
        locker.claim(address(token));
    }

    // ── availableFees ──

    function test_availableFees() public view {
        // Initially zero
        assertEq(locker.availableFees(feeOwner, address(token)), 0);
    }
}
