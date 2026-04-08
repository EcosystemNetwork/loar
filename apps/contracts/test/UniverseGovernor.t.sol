// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {UniverseGovernor} from "../src/UniverseGovernor.sol";
import {GovernanceERC20} from "../src/GovernanceERC20.sol";
import {IGovernor} from "@openzeppelin/governance/IGovernor.sol";
import {IVotes} from "@openzeppelin/governance/utils/IVotes.sol";

contract UniverseGovernorTest is Test {
    UniverseGovernor governor;
    GovernanceERC20 token;

    address deployer = address(this);
    address voter1 = address(0x1);
    address voter2 = address(0x2);
    address target = address(0xAAAA);

    uint256 constant SUPPLY = 100_000_000_000e18;

    function setUp() public {
        token = new GovernanceERC20(
            "Test Token",
            "TEST",
            SUPPLY,
            deployer,
            "",
            "",
            ""
        );

        governor = new UniverseGovernor(IVotes(address(token)));

        // Distribute tokens: voter1 gets 10B (10%), voter2 gets 5B (5%)
        token.transfer(voter1, 10_000_000_000e18);
        token.transfer(voter2, 5_000_000_000e18);

        // Voters must delegate to themselves to activate voting power
        vm.prank(voter1);
        token.delegate(voter1);
        vm.prank(voter2);
        token.delegate(voter2);

        // Mine a block so delegation takes effect
        vm.roll(block.number + 1);
    }

    // ── Configuration ──

    function test_votingDelay() public view {
        assertEq(governor.votingDelay(), 7200);
    }

    function test_votingPeriod() public view {
        assertEq(governor.votingPeriod(), 50400);
    }

    function test_proposalThreshold() public view {
        assertEq(governor.proposalThreshold(), 1_000_000e18);
    }

    function test_quorumNumerator() public view {
        assertEq(governor.quorumNumerator(), 10);
    }

    // ── Proposal Lifecycle ──

    function test_propose_succeeds() public {
        address[] memory targets = new address[](1);
        targets[0] = target;
        uint256[] memory values = new uint256[](1);
        bytes[] memory calldatas = new bytes[](1);
        calldatas[0] = abi.encodeWithSignature("setCanon(uint256)", 42);

        vm.prank(voter1);
        uint256 proposalId = governor.propose(targets, values, calldatas, "Set node 42 as canon");
        assertTrue(proposalId != 0);
    }

    function test_propose_revertsInsufficientTokens() public {
        address smallHolder = address(0x99);
        token.transfer(smallHolder, 100e18);
        vm.prank(smallHolder);
        token.delegate(smallHolder);
        vm.roll(block.number + 1);

        address[] memory targets = new address[](1);
        targets[0] = target;
        uint256[] memory values = new uint256[](1);
        bytes[] memory calldatas = new bytes[](1);

        vm.prank(smallHolder);
        vm.expectRevert();
        governor.propose(targets, values, calldatas, "should fail");
    }

    function test_fullGovernanceCycle() public {
        // 1. Propose
        address[] memory targets = new address[](1);
        targets[0] = target;
        uint256[] memory values = new uint256[](1);
        bytes[] memory calldatas = new bytes[](1);
        calldatas[0] = abi.encodeWithSignature("doSomething()");

        vm.prank(voter1);
        uint256 proposalId = governor.propose(targets, values, calldatas, "Test proposal");

        // 2. Wait for voting delay
        vm.roll(block.number + governor.votingDelay() + 1);

        // 3. Cast votes
        vm.prank(voter1);
        governor.castVote(proposalId, 1); // For

        vm.prank(voter2);
        governor.castVote(proposalId, 1); // For

        // 4. Wait for voting period to end
        vm.roll(block.number + governor.votingPeriod() + 1);

        // 5. Check state is Succeeded
        assertEq(uint(governor.state(proposalId)), uint(IGovernor.ProposalState.Succeeded));
    }

    function test_voteCannotHappenBeforeDelay() public {
        address[] memory targets = new address[](1);
        targets[0] = target;
        uint256[] memory values = new uint256[](1);
        bytes[] memory calldatas = new bytes[](1);

        vm.prank(voter1);
        uint256 proposalId = governor.propose(targets, values, calldatas, "Test");

        // Try to vote immediately (before voting delay)
        vm.prank(voter1);
        vm.expectRevert();
        governor.castVote(proposalId, 1);
    }

    function test_quorumRequired() public {
        address[] memory targets = new address[](1);
        targets[0] = target;
        uint256[] memory values = new uint256[](1);
        bytes[] memory calldatas = new bytes[](1);

        vm.prank(voter1);
        uint256 proposalId = governor.propose(targets, values, calldatas, "Quorum test");

        vm.roll(block.number + governor.votingDelay() + 1);

        // Only voter2 votes (5% < 10% quorum)
        vm.prank(voter2);
        governor.castVote(proposalId, 1);

        vm.roll(block.number + governor.votingPeriod() + 1);

        // Should be Defeated due to insufficient quorum
        assertEq(uint(governor.state(proposalId)), uint(IGovernor.ProposalState.Defeated));
    }
}
