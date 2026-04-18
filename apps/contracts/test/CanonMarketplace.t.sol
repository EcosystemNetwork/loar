// SPDX-License-Identifier: MIT
pragma solidity =0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/proxy/ERC1967/ERC1967Proxy.sol";
import {CanonMarketplace} from "../src/revenue/CanonMarketplace.sol";
import {MockRightsRegistry} from "./mocks/MockRightsRegistry.sol";
import {MockPaymentRouter} from "./mocks/MockPaymentRouter.sol";

/// @dev Mock governance token with ERC20Votes-like interface
contract MockVotesToken {
    mapping(address => uint256) public balances;
    uint256 public totalSupply_;

    function mint(address to, uint256 amount) external {
        balances[to] += amount;
        totalSupply_ += amount;
    }

    function totalSupply() external view returns (uint256) { return totalSupply_; }
    function getPastVotes(address account, uint256) external view returns (uint256) { return balances[account]; }
    function getPastTotalSupply(uint256) external view returns (uint256) { return totalSupply_; }
}

/// @dev Mock UniverseManager that returns a known token for a universe ID
contract MockUniverseManager {
    mapping(uint256 => address) public universeTokens;

    function setUniverseToken(uint256 universeId, address token) external {
        universeTokens[universeId] = token;
    }

    function getUniverseData(uint256 id) external view returns (
        address universe, address token, address governor, address hook, address locker, address bondingCurve
    ) {
        return (address(0), universeTokens[id], address(0), address(0), address(0), address(0));
    }
}

contract CanonMarketplaceTest is Test {
    CanonMarketplace public canon;
    MockRightsRegistry public rights;
    MockPaymentRouter public router;
    MockVotesToken public votesToken;
    MockUniverseManager public universeManager;

    address deployer  = makeAddr("deployer");
    address platform  = makeAddr("platform");
    address creator   = makeAddr("creator");
    address voter1    = makeAddr("voter1");
    address voter2    = makeAddr("voter2");
    address attacker  = makeAddr("attacker");

    uint16 constant PLATFORM_FEE = 500;    // 5%
    uint16 constant LICENSE_FEE  = 300;    // 3%
    uint256 constant MIN_FEE     = 0.001 ether;
    uint256 constant VOTE_DURATION = 7 days;
    uint256 constant UNIVERSE_ID = 1;

    function setUp() public {
        vm.startPrank(deployer);

        rights = new MockRightsRegistry();
        router = new MockPaymentRouter(platform);
        votesToken = new MockVotesToken();
        universeManager = new MockUniverseManager();

        CanonMarketplace impl = new CanonMarketplace();
        canon = CanonMarketplace(address(new ERC1967Proxy(
            address(impl),
            abi.encodeCall(CanonMarketplace.initialize, (
                platform,
                address(rights),
                address(router),
                PLATFORM_FEE,
                LICENSE_FEE,
                MIN_FEE,
                VOTE_DURATION
            ))
        )));

        // Wire up UniverseManager for C5 protection
        canon.setUniverseManager(address(universeManager));
        universeManager.setUniverseToken(UNIVERSE_ID, address(votesToken));

        vm.stopPrank();

        // Setup: give voters voting power
        votesToken.mint(voter1, 60_000e18);
        votesToken.mint(voter2, 40_000e18);

        // Fund accounts
        vm.deal(creator, 100 ether);
        vm.deal(voter1, 10 ether);
        vm.deal(attacker, 100 ether);

        // Advance past MIN_SNAPSHOT_AGE (15) to avoid underflow in snapshotBlock calculation
        vm.roll(20);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  Initialize
    // ═══════════════════════════════════════════════════════════════════

    function test_initialize() public view {
        assertEq(canon.platform(), platform);
        assertEq(canon.platformFeeBps(), PLATFORM_FEE);
        assertEq(canon.canonLicenseFeeBps(), LICENSE_FEE);
        assertEq(canon.minSubmissionFee(), MIN_FEE);
        assertEq(canon.votingDuration(), VOTE_DURATION);
        assertEq(canon.owner(), deployer);
    }

    function test_initialize_revert_zeroPlatform() public {
        CanonMarketplace impl = new CanonMarketplace();
        vm.expectRevert(CanonMarketplace.ZeroAddress.selector);
        new ERC1967Proxy(
            address(impl),
            abi.encodeCall(CanonMarketplace.initialize, (
                address(0), address(rights), address(router),
                PLATFORM_FEE, LICENSE_FEE, MIN_FEE, VOTE_DURATION
            ))
        );
    }

    function test_initialize_revert_feeTooHigh() public {
        CanonMarketplace impl = new CanonMarketplace();
        vm.expectRevert(CanonMarketplace.FeeTooHigh.selector);
        new ERC1967Proxy(
            address(impl),
            abi.encodeCall(CanonMarketplace.initialize, (
                platform, address(rights), address(router),
                5001, LICENSE_FEE, MIN_FEE, VOTE_DURATION
            ))
        );
    }

    function test_cannotReinitialize() public {
        vm.expectRevert();
        canon.initialize(
            platform, address(rights), address(router),
            PLATFORM_FEE, LICENSE_FEE, MIN_FEE, VOTE_DURATION
        );
    }

    // ═══════════════════════════════════════════════════════════════════
    //  Pause / Unpause
    // ═══════════════════════════════════════════════════════════════════

    function test_pause_unpause() public {
        vm.prank(deployer);
        canon.pause();
        assertTrue(canon.paused());

        vm.prank(deployer);
        canon.unpause();
        assertFalse(canon.paused());
    }

    function test_pause_revert_notOwner() public {
        vm.prank(creator);
        vm.expectRevert();
        canon.pause();
    }

    // ═══════════════════════════════════════════════════════════════════
    //  Ownership
    // ═══════════════════════════════════════════════════════════════════

    function test_transferOwnership() public {
        vm.prank(deployer);
        canon.transferOwnership(platform);
        assertEq(canon.owner(), platform);
    }

    function test_transferOwnership_revert_notOwner() public {
        vm.prank(creator);
        vm.expectRevert();
        canon.transferOwnership(creator);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  Upgrade Authorization
    // ═══════════════════════════════════════════════════════════════════

    function test_upgrade_revert_notOwner() public {
        CanonMarketplace newImpl = new CanonMarketplace();
        vm.prank(creator);
        vm.expectRevert();
        canon.upgradeToAndCall(address(newImpl), "");
    }

    // ═══════════════════════════════════════════════════════════════════
    //  C5: Sockpuppet Token Rejection
    // ═══════════════════════════════════════════════════════════════════

    function test_submit_revert_sockpuppetToken() public {
        // Attacker deploys their own IVotes-compatible token
        MockVotesToken attackerToken = new MockVotesToken();
        attackerToken.mint(attacker, 1_000_000e18);

        bytes32 contentHash = keccak256("attacker-content");
        // defaultMonetizable is true in MockRightsRegistry

        // Attempt to submit with attacker's token instead of the real universe token
        vm.prank(attacker);
        vm.expectRevert(CanonMarketplace.TokenMismatch.selector);
        canon.submit{value: MIN_FEE}(
            UNIVERSE_ID,
            address(attackerToken),
            CanonMarketplace.SubmissionType.CHARACTER,
            contentHash,
            "ipfs://fake"
        );
    }

    function test_submit_success_correctToken() public {
        bytes32 contentHash = keccak256("legit-content");
        // defaultMonetizable is true in MockRightsRegistry

        // Submit with the correct universe token — should succeed
        vm.prank(creator);
        uint256 subId = canon.submit{value: MIN_FEE}(
            UNIVERSE_ID,
            address(votesToken),
            CanonMarketplace.SubmissionType.CHARACTER,
            contentHash,
            "ipfs://legit"
        );
        assertEq(subId, 0);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  C5: setUniverseManager
    // ═══════════════════════════════════════════════════════════════════

    function test_setUniverseManager_revert_notOwner() public {
        vm.prank(attacker);
        vm.expectRevert();
        canon.setUniverseManager(address(universeManager));
    }

    function test_setUniverseManager_revert_zeroAddress() public {
        vm.prank(deployer);
        vm.expectRevert(CanonMarketplace.ZeroAddress.selector);
        canon.setUniverseManager(address(0));
    }

    // ═══════════════════════════════════════════════════════════════════
    //  C6: Vote CEI + nonReentrant
    // ═══════════════════════════════════════════════════════════════════

    function test_vote_success() public {
        bytes32 contentHash = keccak256("vote-content");
        // defaultMonetizable is true in MockRightsRegistry

        vm.prank(creator);
        uint256 subId = canon.submit{value: MIN_FEE}(
            UNIVERSE_ID,
            address(votesToken),
            CanonMarketplace.SubmissionType.CHARACTER,
            contentHash,
            "ipfs://vote"
        );

        // voter1 votes for
        vm.prank(voter1);
        canon.vote(subId, true);

        assertTrue(canon.hasVoted(subId, voter1));
        assertEq(canon.voteWeight(subId, voter1), 60_000e18);
    }

    function test_vote_revert_doubleVote() public {
        bytes32 contentHash = keccak256("double-vote");
        // defaultMonetizable is true in MockRightsRegistry

        vm.prank(creator);
        uint256 subId = canon.submit{value: MIN_FEE}(
            UNIVERSE_ID,
            address(votesToken),
            CanonMarketplace.SubmissionType.CHARACTER,
            contentHash,
            "ipfs://dv"
        );

        vm.prank(voter1);
        canon.vote(subId, true);

        // Second vote should revert
        vm.prank(voter1);
        vm.expectRevert(CanonMarketplace.AlreadyVoted.selector);
        canon.vote(subId, true);
    }

    function test_vote_revert_noVotingPower() public {
        bytes32 contentHash = keccak256("no-power");
        // defaultMonetizable is true in MockRightsRegistry

        vm.prank(creator);
        uint256 subId = canon.submit{value: MIN_FEE}(
            UNIVERSE_ID,
            address(votesToken),
            CanonMarketplace.SubmissionType.CHARACTER,
            contentHash,
            "ipfs://np"
        );

        // attacker has no voting power
        vm.prank(attacker);
        vm.expectRevert(CanonMarketplace.NoVotingPower.selector);
        canon.vote(subId, true);

        // hasVoted should NOT be set (revert undoes state)
        assertFalse(canon.hasVoted(subId, attacker));
    }

    // ═══════════════════════════════════════════════════════════════════
    //  Full flow: submit → vote → finalize
    // ═══════════════════════════════════════════════════════════════════

    function test_fullFlow_submitVoteFinalize() public {
        bytes32 contentHash = keccak256("full-flow");
        // defaultMonetizable is true in MockRightsRegistry

        // Submit
        vm.prank(creator);
        uint256 subId = canon.submit{value: 0.01 ether}(
            UNIVERSE_ID,
            address(votesToken),
            CanonMarketplace.SubmissionType.LOCATION,
            contentHash,
            "ipfs://full"
        );

        // Vote — majority for
        vm.prank(voter1);
        canon.vote(subId, true);
        vm.prank(voter2);
        canon.vote(subId, false);

        // Warp past voting deadline
        vm.warp(block.timestamp + VOTE_DURATION + 1);

        // Finalize
        canon.finalize(subId);

        // Should be accepted (60k > 40k)
        (,,,, CanonMarketplace.SubmissionStatus status,,,,,,,,,) = canon.submissions(subId);
        assertTrue(status == CanonMarketplace.SubmissionStatus.ACCEPTED);

        // Should be in canon submissions for this universe
        uint256[] memory canonIds = canon.getCanonSubmissions(UNIVERSE_ID);
        assertEq(canonIds.length, 1);
        assertEq(canonIds[0], subId);
    }
}
