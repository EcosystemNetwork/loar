// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {CanonMarketplace} from "../../src/revenue/CanonMarketplace.sol";
import {RightsRegistry} from "../../src/RightsRegistry.sol";
import {PaymentRouter} from "../../src/PaymentRouter.sol";
import {IRightsRegistry} from "../../src/interfaces/IRightsRegistry.sol";

/// @dev Mock ERC20 for voting
contract MockGovToken {
    mapping(address => uint256) public balanceOf;

    function setBalance(address user, uint256 amount) external {
        balanceOf[user] = amount;
    }
}

contract CanonMarketplaceTest is Test {
    CanonMarketplace marketplace;
    RightsRegistry registry;
    PaymentRouter router;
    MockGovToken govToken;

    address platform;
    address treasury;
    address creator;
    address voter1;
    address voter2;

    bytes32 contentHash = keccak256("canon-content");
    bytes32 frozenHash = keccak256("frozen-content");

    function setUp() public {
        platform = makeAddr("platform");
        treasury = makeAddr("treasury");
        creator = makeAddr("creator");
        voter1 = makeAddr("voter1");
        voter2 = makeAddr("voter2");

        vm.deal(creator, 10 ether);
        vm.deal(voter1, 1 ether);

        registry = new RightsRegistry(platform);
        router = new PaymentRouter(treasury, 1000);
        govToken = new MockGovToken();

        marketplace = new CanonMarketplace(
            platform,
            address(registry),
            address(router),
            1000,     // 10% platform fee
            500,      // 5% license fee
            0.01 ether, // min submission fee
            1 days      // voting duration
        );

        // Setup voting power
        govToken.setBalance(voter1, 100e18);
        govToken.setBalance(voter2, 50e18);

        // Freeze test hash
        vm.prank(platform);
        registry.freeze(frozenHash, "DMCA");
    }

    // ── Constructor Fee Caps ──

    function test_constructor_revertsPlatformFeeTooHigh() public {
        vm.expectRevert(CanonMarketplace.FeeTooHigh.selector);
        new CanonMarketplace(platform, address(registry), address(router), 5001, 500, 0.01 ether, 1 days);
    }

    function test_constructor_revertsLicenseFeeTooHigh() public {
        vm.expectRevert(CanonMarketplace.FeeTooHigh.selector);
        new CanonMarketplace(platform, address(registry), address(router), 1000, 5001, 0.01 ether, 1 days);
    }

    // ── Submit ──

    function test_submit_succeeds() public {
        vm.prank(creator);
        uint256 id = marketplace.submit{value: 0.1 ether}(
            1, address(govToken), CanonMarketplace.SubmissionType.CHARACTER, contentHash, "ipfs://meta"
        );
        assertEq(id, 0);
    }

    function test_submit_routesPlatformFee() public {
        uint256 treasuryBefore = treasury.balance;

        vm.prank(creator);
        marketplace.submit{value: 0.1 ether}(
            1, address(govToken), CanonMarketplace.SubmissionType.CHARACTER, contentHash, "ipfs://meta"
        );

        // 10% of 0.1 ETH = 0.01 ETH to treasury
        assertEq(treasury.balance - treasuryBefore, 0.01 ether);
    }

    function test_submit_revertsFrozenContent() public {
        vm.prank(creator);
        vm.expectRevert(CanonMarketplace.ContentNotMonetizable.selector);
        marketplace.submit{value: 0.1 ether}(
            1, address(govToken), CanonMarketplace.SubmissionType.CHARACTER, frozenHash, "ipfs://meta"
        );
    }

    function test_submit_revertsInsufficientFee() public {
        vm.prank(creator);
        vm.expectRevert(CanonMarketplace.InsufficientFee.selector);
        marketplace.submit{value: 0.001 ether}(
            1, address(govToken), CanonMarketplace.SubmissionType.CHARACTER, contentHash, "ipfs://meta"
        );
    }

    // ── Vote ──

    function test_vote_succeeds() public {
        vm.prank(creator);
        uint256 submissionId = marketplace.submit{value: 0.1 ether}(
            1, address(govToken), CanonMarketplace.SubmissionType.CHARACTER, contentHash, "ipfs://meta"
        );

        vm.prank(voter1);
        marketplace.vote(submissionId, true);

        (,,,,,,,,uint256 votesFor,,,) = marketplace.submissions(submissionId);
        assertEq(votesFor, 100e18);
    }

    function test_vote_revertsDoubleVote() public {
        vm.prank(creator);
        uint256 id = marketplace.submit{value: 0.1 ether}(
            1, address(govToken), CanonMarketplace.SubmissionType.CHARACTER, contentHash, "ipfs://meta"
        );

        vm.prank(voter1);
        marketplace.vote(id, true);

        vm.prank(voter1);
        vm.expectRevert(CanonMarketplace.AlreadyVoted.selector);
        marketplace.vote(id, true);
    }

    // ── Finalize ──

    function test_finalize_accepted() public {
        vm.prank(creator);
        uint256 id = marketplace.submit{value: 0.1 ether}(
            1, address(govToken), CanonMarketplace.SubmissionType.CHARACTER, contentHash, "ipfs://meta"
        );

        vm.prank(voter1);
        marketplace.vote(id, true);

        // Advance past voting deadline
        vm.warp(block.timestamp + 1 days + 1);

        marketplace.finalize(id);

        (,,,,CanonMarketplace.SubmissionStatus status,,,,,,,) = marketplace.submissions(id);
        assertEq(uint(status), uint(CanonMarketplace.SubmissionStatus.ACCEPTED));

        // Creator reward routed through PaymentRouter (0.1 - 10% = 0.09)
        assertEq(router.claimable(creator), 0.09 ether);
    }

    function test_finalize_rejected() public {
        vm.prank(creator);
        uint256 id = marketplace.submit{value: 0.1 ether}(
            1, address(govToken), CanonMarketplace.SubmissionType.CHARACTER, contentHash, "ipfs://meta"
        );

        vm.prank(voter1);
        marketplace.vote(id, false);

        vm.warp(block.timestamp + 1 days + 1);
        marketplace.finalize(id);

        (,,,,CanonMarketplace.SubmissionStatus status,,,,,,,) = marketplace.submissions(id);
        assertEq(uint(status), uint(CanonMarketplace.SubmissionStatus.REJECTED));
    }

    function test_finalize_revertsBeforeDeadline() public {
        vm.prank(creator);
        uint256 id = marketplace.submit{value: 0.1 ether}(
            1, address(govToken), CanonMarketplace.SubmissionType.CHARACTER, contentHash, "ipfs://meta"
        );

        vm.expectRevert(CanonMarketplace.VotingNotEnded.selector);
        marketplace.finalize(id);
    }

    // ── License ──

    function test_licenseCanon_routesPayment() public {
        // Setup: submit, vote, finalize
        vm.prank(creator);
        uint256 id = marketplace.submit{value: 0.1 ether}(
            1, address(govToken), CanonMarketplace.SubmissionType.CHARACTER, contentHash, "ipfs://meta"
        );
        vm.prank(voter1);
        marketplace.vote(id, true);
        vm.warp(block.timestamp + 1 days + 1);
        marketplace.finalize(id);

        // License it
        address licensee = makeAddr("licensee");
        vm.deal(licensee, 1 ether);
        uint256 treasuryBefore = treasury.balance;

        vm.prank(licensee);
        marketplace.licenseCanon{value: 1 ether}(id);

        // 5% license fee to treasury
        assertEq(treasury.balance - treasuryBefore, 0.05 ether);
        // Creator gets rest via PaymentRouter (existing 0.09 + 0.95 = 1.04)
        assertEq(router.claimable(creator), 0.09 ether + 0.95 ether);
    }

    // ── Cross-reference Event ──

    function test_finalize_emitsCanonSubmissionAccepted() public {
        vm.prank(creator);
        uint256 id = marketplace.submit{value: 0.1 ether}(
            1, address(govToken), CanonMarketplace.SubmissionType.CHARACTER, contentHash, "ipfs://meta"
        );
        vm.prank(voter1);
        marketplace.vote(id, true);
        vm.warp(block.timestamp + 1 days + 1);

        vm.expectEmit(true, true, false, true);
        emit CanonMarketplace.CanonSubmissionAccepted(1, id, contentHash);
        marketplace.finalize(id);
    }
}
