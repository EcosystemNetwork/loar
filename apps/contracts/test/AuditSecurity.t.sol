// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {Test, console} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/proxy/ERC1967/ERC1967Proxy.sol";

import {Universe} from "../src/Universe.sol";
import {IUniverse} from "../src/interfaces/IUniverse.sol";
import {IUniverseManager} from "../src/interfaces/IUniverseManager.sol";
import {NodeCreationOptions, NodeVisibilityOptions} from "../src/libraries/NodeOptions.sol";

import {PaymentRouter} from "../src/PaymentRouter.sol";
import {CollabManager} from "../src/revenue/CollabManager.sol";
import {SubscriptionManager} from "../src/revenue/SubscriptionManager.sol";
import {SlopMarket} from "../src/revenue/SlopMarket.sol";
import {LicensingRegistry} from "../src/revenue/LicensingRegistry.sol";
import {CanonMarketplace} from "../src/revenue/CanonMarketplace.sol";
import {RightsRegistry} from "../src/RightsRegistry.sol";
import {AdPlacement} from "../src/revenue/AdPlacement.sol";

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

/// @dev Minimal ERC-20 stub for rights/payment routing tests
contract MockToken {
    mapping(address => uint256) public balanceOf;
    function mint(address to, uint256 amount) external { balanceOf[to] += amount; }
}

/// @dev Minimal IVotes stub for CanonMarketplace voting
contract MockVotesToken {
    mapping(address => uint256) private _votes;
    uint256 private _totalSupply = 1_000_000e18;

    function getPastTotalSupply(uint256) external view returns (uint256) { return _totalSupply; }
    function getPastVotes(address account, uint256) external view returns (uint256) {
        return _votes[account];
    }
    function setVotes(address account, uint256 weight) external { _votes[account] = weight; }
}

// ──────────────────────────────────────────────────────────────────────────────
// Fix 2 — Universe: invalid parent node must revert
// ──────────────────────────────────────────────────────────────────────────────

contract UniverseParentValidationTest is Test {
    Universe public universe;

    function setUp() public {
        IUniverseManager.UniverseConfig memory config = IUniverseManager.UniverseConfig({
            nodeCreationOption: NodeCreationOptions.PUBLIC,
            nodeVisibilityOption: NodeVisibilityOptions.PUBLIC,
            universeAdmin: address(this),
            name: "Test Universe",
            imageURL: "img.com",
            description: "test",
            universeManager: address(this)
        });
        universe = new Universe(config);
    }

    function test_createNode_invalidParent_reverts() public {
        // Node 999 does not exist; creating a child of it should revert
        vm.expectRevert(abi.encodeWithSelector(IUniverse.NodeDoesNotExist.selector));
        universe.createNode(keccak256("c"), keccak256("p"), 999, "link", "plot");
    }

    function test_createNode_validParent_succeeds() public {
        // Create a root node then a valid child
        uint root = universe.createNode(keccak256("r"), keccak256("rp"), 0, "root", "root plot");
        uint child = universe.createNode(keccak256("c"), keccak256("cp"), root, "child", "child plot");
        assertEq(child, 2);

        (,,,, uint[] memory next,,) = universe.getNode(root);
        assertEq(next.length, 1);
        assertEq(next[0], child);
    }

    function test_createNode_zeroParent_succeeds() public {
        // Root node (previous=0) must still work
        uint id = universe.createNode(keccak256("r"), keccak256("rp"), 0, "root", "root");
        assertEq(id, 1);
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// Fix 1 — CollabManager: unauthorized acceptCollab must revert
// ──────────────────────────────────────────────────────────────────────────────

contract CollabManagerAuthTest is Test {
    CollabManager public manager;
    PaymentRouter public router;

    address treasury = makeAddr("treasury");
    address proposer = makeAddr("proposer");
    address targetAcceptor = makeAddr("targetAcceptor");
    address attacker = makeAddr("attacker");

    function setUp() public {
        // Deploy PaymentRouter proxy
        PaymentRouter impl = new PaymentRouter();
        router = PaymentRouter(address(new ERC1967Proxy(
            address(impl),
            abi.encodeCall(PaymentRouter.initialize, (treasury, 1000))
        )));

        // Deploy CollabManager proxy
        CollabManager implCollab = new CollabManager();
        manager = CollabManager(address(new ERC1967Proxy(
            address(implCollab),
            abi.encodeCall(CollabManager.initialize, (address(this), address(router), 500))
        )));
    }

    function _propose() internal returns (uint256) {
        vm.prank(proposer);
        return manager.proposeCollab(1, 2, targetAcceptor, 5000, 7 days, "ipfs://meta");
    }

    function test_acceptCollab_byTargetAcceptor_succeeds() public {
        uint id = _propose();
        vm.prank(targetAcceptor);
        manager.acceptCollab(id);

        // After a successful accept, the proposer should be able to activate the collab.
        // Activation requires status == ACCEPTED — if the accept failed, this would revert.
        vm.prank(targetAcceptor);
        manager.activateCollab(id);
    }

    function test_acceptCollab_byAttacker_reverts() public {
        uint id = _propose();
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(CollabManager.NotAcceptor.selector));
        manager.acceptCollab(id);
    }

    function test_proposeCollab_zeroTargetAcceptor_reverts() public {
        vm.prank(proposer);
        vm.expectRevert(abi.encodeWithSelector(CollabManager.ZeroAddress.selector));
        manager.proposeCollab(1, 2, address(0), 5000, 7 days, "ipfs://meta");
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// Fix 3 — CanonMarketplace: rejected submission fee must not be stuck
// ──────────────────────────────────────────────────────────────────────────────

contract CanonMarketplaceRejectedFeeTest is Test {
    CanonMarketplace public marketplace;
    PaymentRouter public router;
    RightsRegistry public rights;

    address treasury = makeAddr("treasury");
    address platform = makeAddr("platform");
    address creator = makeAddr("creator");
    address voter = makeAddr("voter");

    MockVotesToken public votesToken;
    bytes32 constant CONTENT = keccak256("some content");

    function setUp() public {
        // Rights registry
        RightsRegistry rightsImpl = new RightsRegistry();
        rights = RightsRegistry(address(new ERC1967Proxy(
            address(rightsImpl),
            abi.encodeCall(RightsRegistry.initialize, (platform))
        )));

        // Payment router
        PaymentRouter routerImpl = new PaymentRouter();
        router = PaymentRouter(address(new ERC1967Proxy(
            address(routerImpl),
            abi.encodeCall(PaymentRouter.initialize, (treasury, 1000))
        )));

        // CanonMarketplace
        CanonMarketplace mktImpl = new CanonMarketplace();
        marketplace = CanonMarketplace(address(new ERC1967Proxy(
            address(mktImpl),
            abi.encodeCall(
                CanonMarketplace.initialize,
                (platform, address(rights), address(router), 1000, 500, 0.01 ether, 1 days)
            )
        )));

        // votes token
        votesToken = new MockVotesToken();
        votesToken.setVotes(voter, 100e18);
    }

    function test_rejectedSubmission_feeRouted_toTreasury() public {
        // Submit
        uint256 fee = 0.01 ether;
        vm.deal(creator, fee);
        vm.prank(creator);
        uint subId = marketplace.submit{value: fee}(
            1,
            address(votesToken),
            CanonMarketplace.SubmissionType.CHARACTER,
            CONTENT,
            "ipfs://meta"
        );

        // Cast a "against" vote so it will be rejected
        vm.roll(block.number + 1); // advance past snapshotBlock
        vm.prank(voter);
        marketplace.vote(subId, false);

        // Advance past voting deadline
        vm.warp(block.timestamp + 1 days + 1);

        uint256 treasuryBefore = treasury.balance;

        // Finalize — submission should be REJECTED
        marketplace.finalize(subId);

        // Treasury should have received the locked remainder
        uint256 treasuryAfter = treasury.balance;
        assertTrue(treasuryAfter > treasuryBefore, "Treasury should receive rejected fee");
        // Contract should have no remaining ETH
        assertEq(address(marketplace).balance, 0, "No ETH should be stuck in contract");
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// Fix 4 — LicensingRegistry: createLicense must not accept ETH
// ──────────────────────────────────────────────────────────────────────────────

contract LicensingRegistryPayableTest is Test {
    LicensingRegistry public registry;
    PaymentRouter public router;
    address treasury = makeAddr("treasury");
    address platform = makeAddr("platform");

    function setUp() public {
        PaymentRouter routerImpl = new PaymentRouter();
        router = PaymentRouter(address(new ERC1967Proxy(
            address(routerImpl),
            abi.encodeCall(PaymentRouter.initialize, (treasury, 1000))
        )));

        LicensingRegistry regImpl = new LicensingRegistry();
        registry = LicensingRegistry(address(new ERC1967Proxy(
            address(regImpl),
            abi.encodeCall(LicensingRegistry.initialize, (platform, address(router), 500))
        )));
    }

    function test_createLicense_nonPayable() public {
        // Verify the function signature is NOT payable by attempting to call it.
        // With Solidity 0.8+ a non-payable function will revert if ETH is attached.
        // We use low-level call so we can send ETH even to a non-payable function.
        address licensee = makeAddr("licensee");
        bytes memory callData = abi.encodeCall(
            LicensingRegistry.createLicense,
            (1, LicensingRegistry.LicenseType.STREAMING, licensee, 1 ether, 500, 30 days, "ipfs://terms")
        );
        (bool success,) = address(registry).call{value: 0.1 ether}(callData);
        assertFalse(success, "createLicense should revert when ETH is sent");
    }

    function test_createLicense_withoutEth_succeeds() public {
        address licensee = makeAddr("licensee");
        address licensor = makeAddr("licensor");
        vm.prank(licensor);
        uint id = registry.createLicense(
            1,
            LicensingRegistry.LicenseType.STREAMING,
            licensee,
            1 ether,
            500,
            30 days,
            "ipfs://terms"
        );
        assertEq(id, 0);
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// Fix 5 — AdPlacement: acceptBid CEI + nonReentrant
// ──────────────────────────────────────────────────────────────────────────────

contract AdPlacementCEITest is Test {
    AdPlacement public placement;
    PaymentRouter public router;

    address treasury = makeAddr("treasury");
    address platform = address(this);
    address universeCreator = makeAddr("universeCreator");

    function setUp() public {
        PaymentRouter routerImpl = new PaymentRouter();
        router = PaymentRouter(address(new ERC1967Proxy(
            address(routerImpl),
            abi.encodeCall(PaymentRouter.initialize, (treasury, 1000))
        )));

        AdPlacement adImpl = new AdPlacement();
        placement = AdPlacement(address(new ERC1967Proxy(
            address(adImpl),
            abi.encodeCall(AdPlacement.initialize, (platform, address(router), 500))
        )));

        // Register universe + create slot
        placement.registerUniverse(1, universeCreator);
        vm.prank(universeCreator);
        placement.createAdSlot(1, AdPlacement.PlacementType.BILLBOARD, 0.01 ether, 5, "meta");
    }

    function test_acceptBid_stateResetBeforePayment() public {
        // Place a bid
        address bidder = makeAddr("bidder");
        vm.deal(bidder, 1 ether);
        vm.prank(bidder);
        placement.bid{value: 0.05 ether}(0);

        // Accept bid
        vm.prank(universeCreator);
        placement.acceptBid(0);

        // After acceptBid, slot should be reset (no current bidder).
        // Trying to acceptBid again should revert with "No bids".
        vm.prank(universeCreator);
        vm.expectRevert("No bids");
        placement.acceptBid(0);
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// Fix 6 — SlopMarket: setPaymentRouter zero address
// ──────────────────────────────────────────────────────────────────────────────

contract SlopMarketZeroAddressTest is Test {
    SlopMarket public market;
    PaymentRouter public router;
    RightsRegistry public rights;

    address treasury = makeAddr("treasury");
    address platform = makeAddr("platform");

    function setUp() public {
        PaymentRouter routerImpl = new PaymentRouter();
        router = PaymentRouter(address(new ERC1967Proxy(
            address(routerImpl),
            abi.encodeCall(PaymentRouter.initialize, (treasury, 1000))
        )));

        RightsRegistry rightsImpl = new RightsRegistry();
        rights = RightsRegistry(address(new ERC1967Proxy(
            address(rightsImpl),
            abi.encodeCall(RightsRegistry.initialize, (platform))
        )));

        market = new SlopMarket(platform, address(router), address(rights), 250);
    }

    function test_setPaymentRouter_zeroAddress_reverts() public {
        vm.expectRevert(abi.encodeWithSelector(SlopMarket.ZeroAddress.selector));
        market.setPaymentRouter(address(0));
    }

    function test_setPaymentRouter_valid_succeeds() public {
        address newRouter = makeAddr("newRouter");
        market.setPaymentRouter(newRouter);
        assertEq(address(market.paymentRouter()), newRouter);
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// Fix 7 — SubscriptionManager: overpayment refund + unregistered creator
// ──────────────────────────────────────────────────────────────────────────────

contract SubscriptionManagerRefundTest is Test {
    SubscriptionManager public manager;
    PaymentRouter public router;

    address treasury = makeAddr("treasury");
    address platform = makeAddr("platform");
    address creator = makeAddr("creator");
    address subscriber = makeAddr("subscriber");

    uint256 constant UNIVERSE_ID = 1;

    function setUp() public {
        PaymentRouter routerImpl = new PaymentRouter();
        router = PaymentRouter(address(new ERC1967Proxy(
            address(routerImpl),
            abi.encodeCall(PaymentRouter.initialize, (treasury, 1000))
        )));

        SubscriptionManager smImpl = new SubscriptionManager();
        manager = SubscriptionManager(address(new ERC1967Proxy(
            address(smImpl),
            abi.encodeCall(SubscriptionManager.initialize, (platform, address(router), 500))
        )));

        // Register universe + configure a tier
        vm.prank(platform);
        manager.registerUniverse(UNIVERSE_ID, creator);

        vm.prank(platform);
        manager.configureTier(
            UNIVERSE_ID,
            SubscriptionManager.SubscriptionTier.BASIC,
            0.01 ether,  // price per month
            true, false, false, false, 0
        );
    }

    function test_subscribe_exactPayment_noRefund() public {
        vm.deal(subscriber, 1 ether);
        uint256 balanceBefore = subscriber.balance;

        vm.prank(subscriber);
        manager.subscribe{value: 0.01 ether}(UNIVERSE_ID, SubscriptionManager.SubscriptionTier.BASIC, 1);

        uint256 spent = balanceBefore - subscriber.balance;
        assertEq(spent, 0.01 ether, "Exact payment should be fully spent");
    }

    function test_subscribe_overpayment_refunded() public {
        vm.deal(subscriber, 1 ether);
        uint256 balanceBefore = subscriber.balance;

        vm.prank(subscriber);
        manager.subscribe{value: 0.05 ether}(UNIVERSE_ID, SubscriptionManager.SubscriptionTier.BASIC, 1);

        uint256 spent = balanceBefore - subscriber.balance;
        assertEq(spent, 0.01 ether, "Overpayment must be refunded; only totalPrice deducted");
    }

    function test_subscribe_unregisteredCreator_reverts() public {
        // Universe 999 has no registered creator
        vm.prank(platform);
        manager.configureTier(
            999,
            SubscriptionManager.SubscriptionTier.BASIC,
            0.01 ether,
            true, false, false, false, 0
        );

        vm.deal(subscriber, 1 ether);
        vm.prank(subscriber);
        vm.expectRevert(abi.encodeWithSelector(SubscriptionManager.CreatorNotRegistered.selector));
        manager.subscribe{value: 0.01 ether}(999, SubscriptionManager.SubscriptionTier.BASIC, 1);
    }
}
