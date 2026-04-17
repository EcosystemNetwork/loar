// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

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

contract CanonMarketplaceTest is Test {
    CanonMarketplace public canon;
    MockRightsRegistry public rights;
    MockPaymentRouter public router;
    MockVotesToken public votesToken;

    address deployer  = makeAddr("deployer");
    address platform  = makeAddr("platform");
    address creator   = makeAddr("creator");
    address voter1    = makeAddr("voter1");
    address voter2    = makeAddr("voter2");

    uint16 constant PLATFORM_FEE = 500;    // 5%
    uint16 constant LICENSE_FEE  = 300;    // 3%
    uint256 constant MIN_FEE     = 0.001 ether;
    uint256 constant VOTE_DURATION = 7 days;

    function setUp() public {
        vm.startPrank(deployer);

        rights = new MockRightsRegistry();
        router = new MockPaymentRouter(platform);
        votesToken = new MockVotesToken();

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

        vm.stopPrank();

        // Setup: give voters voting power
        votesToken.mint(voter1, 60_000e18);
        votesToken.mint(voter2, 40_000e18);

        // Fund accounts
        vm.deal(creator, 100 ether);
        vm.deal(voter1, 10 ether);
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
}
