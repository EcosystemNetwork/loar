// SPDX-License-Identifier: UNLICENSED
pragma solidity =0.8.30;

import {Test} from "forge-std/Test.sol";
import {LoarToken} from "../src/LoarToken.sol";
import {LoarFaucet} from "../src/LoarFaucet.sol";

contract LoarFaucetTest is Test {
    LoarToken public token;
    LoarFaucet public faucet;

    address owner = makeAddr("owner");
    address treasury = makeAddr("treasury");
    address holder = makeAddr("holder");
    address alice = makeAddr("alice");

    uint256 constant FAUCET_SUPPLY = 100_000e18;

    function setUp() public {
        vm.warp(100_000); // ensure first claim succeeds (lastClaimed=0, nextClaimAt=86400)
        vm.startPrank(owner);
        token = new LoarToken(treasury, holder);
        faucet = new LoarFaucet(address(token));
        vm.stopPrank();

        // Fund faucet from treasury (treasury is fee-exempt)
        vm.prank(treasury);
        token.transfer(address(faucet), FAUCET_SUPPLY);
    }

    // ── Claim ──

    function test_claim() public {
        vm.prank(alice);
        faucet.claim();

        assertEq(token.balanceOf(alice), faucet.claimAmount());
        assertEq(faucet.lastClaimed(alice), block.timestamp);
    }

    function test_claim_revert_cooldownNotElapsed() public {
        vm.prank(alice);
        faucet.claim();

        // Try claiming again immediately
        vm.prank(alice);
        vm.expectRevert();
        faucet.claim();
    }

    function test_claim_revert_insufficientBalance() public {
        // Drain the faucet first
        vm.prank(owner);
        faucet.drain();

        vm.prank(alice);
        vm.expectRevert(LoarFaucet.InsufficientFaucetBalance.selector);
        faucet.claim();
    }

    // ── canClaim ──

    function test_canClaim() public {
        // Should be claimable initially
        (bool ok,) = faucet.canClaim(alice);
        assertTrue(ok);

        // Claim once
        vm.prank(alice);
        faucet.claim();

        // Should not be claimable now
        (ok,) = faucet.canClaim(alice);
        assertFalse(ok);

        // Warp past cooldown
        vm.warp(block.timestamp + faucet.cooldown());

        (ok,) = faucet.canClaim(alice);
        assertTrue(ok);
    }

    // ── Owner controls ──

    function test_setClaimAmount() public {
        vm.prank(owner);
        faucet.setClaimAmount(500e18);
        assertEq(faucet.claimAmount(), 500e18);
    }

    function test_setCooldown() public {
        vm.prank(owner);
        faucet.setCooldown(1 hours);
        assertEq(faucet.cooldown(), 1 hours);
    }

    function test_drain() public {
        uint256 faucetBal = token.balanceOf(address(faucet));
        uint256 ownerBalBefore = token.balanceOf(owner);

        vm.prank(owner);
        faucet.drain();

        assertEq(token.balanceOf(address(faucet)), 0);
        assertEq(token.balanceOf(owner), ownerBalBefore + faucetBal);
    }
}
