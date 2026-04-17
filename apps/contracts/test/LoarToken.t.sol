// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {LoarToken} from "../src/LoarToken.sol";

contract LoarTokenTest is Test {
    LoarToken public token;

    address owner = makeAddr("owner");
    address treasury = makeAddr("treasury");
    address holder = makeAddr("holder");
    address lp = makeAddr("lp");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address minter = makeAddr("minter");

    uint256 constant MAX_SUPPLY = 1_000_000_000 * 1e18;

    function setUp() public {
        vm.prank(owner);
        token = new LoarToken(treasury, holder);
    }

    // ── Constructor ──

    function test_constructor_distribution() public view {
        // 70% to treasury (40% + 20% community + 10% reserve)
        uint256 treasuryExpected = (MAX_SUPPLY * 40) / 100 + (MAX_SUPPLY * 20) / 100
            + (MAX_SUPPLY - (MAX_SUPPLY * 40) / 100 - (MAX_SUPPLY * 30) / 100 - (MAX_SUPPLY * 20) / 100);
        uint256 holderExpected = (MAX_SUPPLY * 30) / 100;

        assertEq(token.balanceOf(treasury), treasuryExpected);
        assertEq(token.balanceOf(holder), holderExpected);
        assertEq(token.totalSupply(), MAX_SUPPLY);
    }

    function test_constructor_feeExemptions() public view {
        assertTrue(token.feeExempt(treasury));
        assertTrue(token.feeExempt(holder));
        assertTrue(token.feeExempt(address(token)));
    }

    function test_constructor_revert_zeroAddress() public {
        vm.startPrank(owner);
        vm.expectRevert(LoarToken.ZeroAddress.selector);
        new LoarToken(address(0), holder);

        vm.expectRevert(LoarToken.ZeroAddress.selector);
        new LoarToken(treasury, address(0));
        vm.stopPrank();
    }

    // ── Minting ──

    function test_mint_byOwner_reverts_afterFullDistribution() public {
        // Constructor distributes MAX_SUPPLY and sets totalMinted = MAX_SUPPLY.
        // Burns reduce totalSupply() but NOT totalMinted, so mint headroom
        // can never be reopened — this is the correct C2 fix behavior.
        vm.prank(treasury);
        token.burn(1000e18);

        // Even after burn, owner cannot mint because totalMinted is still MAX_SUPPLY
        vm.prank(owner);
        vm.expectRevert(LoarToken.ExceedsMaxSupply.selector);
        token.mint(alice, 1000e18);
    }

    function test_mint_byMinter_reverts_afterFullDistribution() public {
        vm.prank(owner);
        token.setMinter(minter, true);

        vm.prank(treasury);
        token.burn(500e18);

        // Even after burn, minter cannot mint — totalMinted is permanent
        vm.prank(minter);
        vm.expectRevert(LoarToken.ExceedsMaxSupply.selector);
        token.mint(alice, 500e18);
    }

    function test_mint_revert_notMinter() public {
        vm.prank(alice);
        vm.expectRevert(LoarToken.NotMinter.selector);
        token.mint(alice, 100e18);
    }

    function test_mint_revert_exceedsMaxSupply() public {
        // Total supply is already MAX_SUPPLY, so any mint should revert
        vm.prank(owner);
        vm.expectRevert(LoarToken.ExceedsMaxSupply.selector);
        token.mint(alice, 1);
    }

    // ── Minter management ──

    function test_setMinter() public {
        vm.prank(owner);
        token.setMinter(minter, true);
        assertTrue(token.minters(minter));

        vm.prank(owner);
        token.setMinter(minter, false);
        assertFalse(token.minters(minter));
    }

    function test_setMinter_revert_zeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(LoarToken.ZeroAddress.selector);
        token.setMinter(address(0), true);
    }

    // ── Transfer fees ──

    function test_transferFee() public {
        // Set up LP so fees get routed there
        vm.prank(owner);
        token.setLiquidityPool(lp);

        // Transfer tokens to alice (from treasury, which is exempt)
        vm.prank(treasury);
        token.transfer(alice, 10_000e18);

        // Alice -> Bob: non-exempt, should pay 1 bps fee
        uint256 amount = 10_000e18;
        uint256 expectedFee = (amount * 1) / 10_000; // 1 bps = 1e18
        uint256 expectedReceived = amount - expectedFee;

        vm.prank(alice);
        token.transfer(bob, amount);

        assertEq(token.balanceOf(bob), expectedReceived);
        assertEq(token.balanceOf(lp), expectedFee);
    }

    function test_transferFee_exemptSender() public {
        vm.prank(owner);
        token.setLiquidityPool(lp);

        // Treasury is exempt — no fee
        uint256 amount = 10_000e18;
        vm.prank(treasury);
        token.transfer(alice, amount);

        assertEq(token.balanceOf(alice), amount);
        assertEq(token.balanceOf(lp), 0);
    }

    function test_transferFee_noLiquidityPool() public {
        // LP not set — no fee even for non-exempt
        vm.prank(treasury);
        token.transfer(alice, 10_000e18);

        vm.prank(alice);
        token.transfer(bob, 5_000e18);

        assertEq(token.balanceOf(bob), 5_000e18);
    }

    // ── Fee configuration ──

    function test_setTransferFeeBps() public {
        vm.prank(owner);
        token.setTransferFeeBps(11); // increase from 1 to 11 (delta = 10, within limit)
        assertEq(token.transferFeeBps(), 11);
    }

    function test_setTransferFeeBps_revert_feeTooHigh() public {
        vm.prank(owner);
        vm.expectRevert(LoarToken.FeeTooHigh.selector);
        token.setTransferFeeBps(501); // exceeds MAX_TRANSFER_FEE_BPS (500)
    }

    function test_setTransferFeeBps_revert_feeIncreaseExceedsLimit() public {
        // Current fee is 1 bps; trying to jump to 12 (delta = 11 > 10)
        vm.prank(owner);
        vm.expectRevert(LoarToken.FeeIncreaseExceedsLimit.selector);
        token.setTransferFeeBps(12);
    }

    function test_setTransferFeeBps_decreaseUnlimited() public {
        // First increase to 11
        vm.prank(owner);
        token.setTransferFeeBps(11);

        // Wait past cooldown
        vm.warp(block.timestamp + 1 days + 1);

        // Now decrease all the way to 0 — unlimited decrease
        vm.prank(owner);
        token.setTransferFeeBps(0);
        assertEq(token.transferFeeBps(), 0);
    }

    // ── Treasury ──

    function test_setTreasury() public {
        address newTreasury = makeAddr("newTreasury");
        vm.prank(owner);
        token.setTreasury(newTreasury);
        assertEq(token.treasury(), newTreasury);
        assertTrue(token.feeExempt(newTreasury));
        assertFalse(token.feeExempt(treasury)); // old treasury lost exemption
    }

    function test_setTreasury_revert_zeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(LoarToken.ZeroAddress.selector);
        token.setTreasury(address(0));
    }

    // ── Liquidity pool ──

    function test_setLiquidityPool() public {
        vm.prank(owner);
        token.setLiquidityPool(lp);
        assertEq(token.liquidityPool(), lp);
        assertTrue(token.feeExempt(lp));
    }

    // ── Fee exemptions ──

    function test_setFeeExempt() public {
        vm.prank(owner);
        token.setFeeExempt(alice, true);
        assertTrue(token.feeExempt(alice));

        vm.prank(owner);
        token.setFeeExempt(alice, false);
        assertFalse(token.feeExempt(alice));
    }

    function test_batchSetFeeExempt() public {
        address[] memory accounts = new address[](3);
        accounts[0] = makeAddr("a1");
        accounts[1] = makeAddr("a2");
        accounts[2] = makeAddr("a3");

        vm.prank(owner);
        token.batchSetFeeExempt(accounts, true);

        for (uint256 i = 0; i < accounts.length; i++) {
            assertTrue(token.feeExempt(accounts[i]));
        }

        vm.prank(owner);
        token.batchSetFeeExempt(accounts, false);

        for (uint256 i = 0; i < accounts.length; i++) {
            assertFalse(token.feeExempt(accounts[i]));
        }
    }
}
