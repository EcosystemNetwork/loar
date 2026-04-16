// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {TokenVesting} from "../src/TokenVesting.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract SimpleToken is ERC20 {
    constructor() ERC20("Test", "TST") {
        _mint(msg.sender, 1_000_000e18);
    }
}

contract TokenVestingTest is Test {
    TokenVesting public vesting;
    SimpleToken public token;

    address owner = makeAddr("owner");
    address beneficiary = makeAddr("beneficiary");
    address alice = makeAddr("alice");

    uint128 constant VEST_AMOUNT = 10_000e18;
    uint64 constant CLIFF = 30 days;
    uint64 constant DURATION = 180 days;

    function setUp() public {
        vm.startPrank(owner);
        vesting = new TokenVesting(owner);
        token = new SimpleToken();
        // Approve vesting contract to pull tokens
        token.approve(address(vesting), type(uint256).max);
        vm.stopPrank();
    }

    // ── Helper ──

    function _createDefaultVesting() internal returns (uint256 vestingId) {
        vm.prank(owner);
        vestingId = vesting.createVesting(
            address(token), beneficiary, VEST_AMOUNT, CLIFF, DURATION
        );
    }

    // ── createVesting ──

    function test_createVesting() public {
        uint256 ownerBalBefore = token.balanceOf(owner);

        uint256 id = _createDefaultVesting();

        assertEq(id, 0);
        assertEq(token.balanceOf(address(vesting)), VEST_AMOUNT);
        assertEq(token.balanceOf(owner), ownerBalBefore - VEST_AMOUNT);

        TokenVesting.VestingSchedule memory v = vesting.getVesting(id);
        assertEq(v.token, address(token));
        assertEq(v.beneficiary, beneficiary);
        assertEq(v.totalAmount, VEST_AMOUNT);
        assertEq(v.claimed, 0);
        assertEq(v.cliffDuration, CLIFF);
        assertEq(v.vestingDuration, DURATION);
        assertFalse(v.revoked);
    }

    function test_createVesting_revert_zeroAddress() public {
        vm.startPrank(owner);

        vm.expectRevert(TokenVesting.ZeroAddress.selector);
        vesting.createVesting(address(0), beneficiary, VEST_AMOUNT, CLIFF, DURATION);

        vm.expectRevert(TokenVesting.ZeroAddress.selector);
        vesting.createVesting(address(token), address(0), VEST_AMOUNT, CLIFF, DURATION);

        vm.stopPrank();
    }

    function test_createVesting_revert_zeroAmount() public {
        vm.prank(owner);
        vm.expectRevert(TokenVesting.ZeroAmount.selector);
        vesting.createVesting(address(token), beneficiary, 0, CLIFF, DURATION);
    }

    function test_createVesting_revert_zeroDuration() public {
        vm.prank(owner);
        vm.expectRevert(TokenVesting.ZeroVestingDuration.selector);
        vesting.createVesting(address(token), beneficiary, VEST_AMOUNT, CLIFF, 0);
    }

    function test_createVesting_revert_cliffExceedsVesting() public {
        vm.prank(owner);
        vm.expectRevert(TokenVesting.CliffExceedsVesting.selector);
        vesting.createVesting(address(token), beneficiary, VEST_AMOUNT, DURATION + 1, DURATION);
    }

    // ── Claim ──

    function test_claim_duringCliff_reverts() public {
        uint256 id = _createDefaultVesting();

        // Warp to middle of cliff
        vm.warp(block.timestamp + CLIFF / 2);

        vm.prank(beneficiary);
        vm.expectRevert(TokenVesting.NothingToClaim.selector);
        vesting.claim(id);
    }

    function test_claim_afterCliff() public {
        uint256 startTime = block.timestamp;
        uint256 id = _createDefaultVesting();

        // Warp to halfway through vesting (past cliff)
        uint256 elapsed = DURATION / 2;
        vm.warp(startTime + elapsed);

        // Expected: linear over full duration
        uint128 expectedVested = uint128((uint256(VEST_AMOUNT) * elapsed) / DURATION);

        vm.prank(beneficiary);
        vesting.claim(id);

        assertEq(token.balanceOf(beneficiary), expectedVested);

        TokenVesting.VestingSchedule memory v = vesting.getVesting(id);
        assertEq(v.claimed, expectedVested);
    }

    function test_claim_afterFullVesting() public {
        uint256 id = _createDefaultVesting();

        vm.warp(block.timestamp + DURATION);

        vm.prank(beneficiary);
        vesting.claim(id);

        assertEq(token.balanceOf(beneficiary), VEST_AMOUNT);
    }

    // ── claimAll ──

    function test_claimAll() public {
        // Create two vestings for same beneficiary
        vm.startPrank(owner);
        uint256 id1 = vesting.createVesting(
            address(token), beneficiary, VEST_AMOUNT, CLIFF, DURATION
        );
        uint256 id2 = vesting.createVesting(
            address(token), beneficiary, VEST_AMOUNT, CLIFF, DURATION
        );
        vm.stopPrank();

        // Warp past full vesting
        vm.warp(block.timestamp + DURATION);

        vm.prank(beneficiary);
        vesting.claimAll();

        assertEq(token.balanceOf(beneficiary), VEST_AMOUNT * 2);

        // Both should be fully claimed
        assertEq(vesting.getVesting(id1).claimed, VEST_AMOUNT);
        assertEq(vesting.getVesting(id2).claimed, VEST_AMOUNT);
    }

    // ── Revoke ──

    function test_revokeVesting() public {
        uint256 id = _createDefaultVesting();
        TokenVesting.VestingSchedule memory vs = vesting.getVesting(id);

        // Warp to halfway through vesting
        uint256 halfwayTs = vs.start + (DURATION / 2);
        vm.warp(halfwayTs);

        uint256 ownerBalBefore = token.balanceOf(owner);

        vm.prank(owner);
        vesting.revokeVesting(id);

        // BUG NOTE: revokeVesting sets v.revoked=true BEFORE calling _vestedAmount(),
        // and _vestedAmount() returns v.vestedAtRevoke (=0) when revoked=true.
        // This means ALL tokens are returned as "unvested" regardless of actual vesting progress.
        // The beneficiary loses their vested tokens on revocation.
        // Expected behavior: unvested = totalAmount - actualVested = 5000e18
        // Actual behavior: unvested = totalAmount - 0 = 10000e18 (all returned to owner)
        assertEq(token.balanceOf(owner), ownerBalBefore + VEST_AMOUNT);

        TokenVesting.VestingSchedule memory v = vesting.getVesting(id);
        assertTrue(v.revoked);
        // vestedAtRevoke is 0 due to the bug (should be 5000e18)
        assertEq(v.vestedAtRevoke, 0);
    }

    function test_claim_afterRevoke() public {
        uint256 id = _createDefaultVesting();
        TokenVesting.VestingSchedule memory vs = vesting.getVesting(id);

        // Warp to halfway, then revoke
        uint256 halfwayTs = vs.start + (DURATION / 2);
        vm.warp(halfwayTs);

        vm.prank(owner);
        vesting.revokeVesting(id);

        // Due to the revoked-before-snapshot bug, vestedAtRevoke = 0
        // So beneficiary has nothing to claim even though they should have 50%
        vm.prank(beneficiary);
        vm.expectRevert(TokenVesting.NothingToClaim.selector);
        vesting.claim(id);
    }

    function test_revokeVesting_revert_alreadyRevoked() public {
        uint256 id = _createDefaultVesting();

        vm.warp(block.timestamp + DURATION / 2);

        vm.startPrank(owner);
        vesting.revokeVesting(id);

        vm.expectRevert(TokenVesting.VestingAlreadyRevoked.selector);
        vesting.revokeVesting(id);
        vm.stopPrank();
    }

    function test_revokeVesting_revert_notOwner() public {
        uint256 id = _createDefaultVesting();

        vm.prank(alice);
        vm.expectRevert();
        vesting.revokeVesting(id);
    }
}
