// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {EpisodeEditionCollection} from "../../src/revenue/EpisodeEditionCollection.sol";
import {RightsRegistry} from "../../src/RightsRegistry.sol";
import {PaymentRouter} from "../../src/PaymentRouter.sol";
import {IRightsRegistry} from "../../src/interfaces/IRightsRegistry.sol";

contract EpisodeEditionCollectionTest is Test {
    EpisodeEditionCollection collection;
    RightsRegistry registry;
    PaymentRouter router;

    address platform = address(0x1);
    address treasury;
    address creator = address(0x3);
    address buyer;

    bytes32 contentHash = keccak256("episode-content");
    bytes32 frozenHash = keccak256("frozen-content");
    bytes32 funHash = keccak256("fun-content");

    function setUp() public {
        treasury = makeAddr("treasury");
        buyer = makeAddr("buyer");
        vm.deal(buyer, 100 ether);

        registry = new RightsRegistry(platform);
        router = new PaymentRouter(treasury, 1000);

        collection = new EpisodeEditionCollection(
            1, // universeId
            platform,
            address(registry),
            address(router),
            1000, // 10% platform fee
            500   // 5% royalty
        );

        // Freeze and fun-tag test hashes
        vm.startPrank(platform);
        registry.freeze(frozenHash, "DMCA");
        registry.setRights(funHash, IRightsRegistry.RightsType.FUN);
        vm.stopPrank();
    }

    // ── Create Edition ──

    function test_createEdition_succeeds() public {
        vm.prank(creator);
        uint256 editionId = collection.createEdition(1, contentHash, 0.1 ether, 100, "ipfs://meta");
        assertEq(editionId, 0);

        (uint256 nodeId, bytes32 hash, address cr, uint256 price, uint256 maxSupply, uint256 minted, bool active)
            = collection.editions(0);
        assertEq(nodeId, 1);
        assertEq(hash, contentHash);
        assertEq(cr, creator);
        assertEq(price, 0.1 ether);
        assertEq(maxSupply, 100);
        assertEq(minted, 0);
        assertTrue(active);
    }

    function test_createEdition_revertsFrozenContent() public {
        vm.prank(creator);
        vm.expectRevert(EpisodeEditionCollection.ContentNotMonetizable.selector);
        collection.createEdition(1, frozenHash, 0.1 ether, 100, "ipfs://meta");
    }

    function test_createEdition_revertsFunContent() public {
        vm.prank(creator);
        vm.expectRevert(EpisodeEditionCollection.ContentNotMonetizable.selector);
        collection.createEdition(1, funHash, 0.1 ether, 100, "ipfs://meta");
    }

    // ── Mint ──

    function test_mint_succeeds() public {
        vm.prank(creator);
        collection.createEdition(1, contentHash, 0.1 ether, 100, "ipfs://meta");

        vm.prank(buyer);
        collection.mint{value: 0.1 ether}(0, 1);

        assertEq(collection.balanceOf(buyer, 0), 1);
    }

    function test_mint_routesPayment() public {
        vm.prank(creator);
        collection.createEdition(1, contentHash, 0.1 ether, 100, "ipfs://meta");

        uint256 treasuryBefore = treasury.balance;

        vm.prank(buyer);
        collection.mint{value: 0.1 ether}(0, 1);

        // 10% platform fee to treasury
        assertEq(treasury.balance - treasuryBefore, 0.01 ether);
        // 90% to creator via PaymentRouter
        assertEq(router.claimable(creator), 0.09 ether);
    }

    function test_mint_revertsInsufficientPayment() public {
        vm.prank(creator);
        collection.createEdition(1, contentHash, 0.1 ether, 100, "ipfs://meta");

        vm.prank(buyer);
        vm.expectRevert(EpisodeEditionCollection.InsufficientPayment.selector);
        collection.mint{value: 0.05 ether}(0, 1);
    }

    function test_mint_revertsMaxSupply() public {
        vm.prank(creator);
        collection.createEdition(1, contentHash, 0.01 ether, 2, "ipfs://meta");

        vm.startPrank(buyer);
        collection.mint{value: 0.01 ether}(0, 1);
        collection.mint{value: 0.01 ether}(0, 1);

        vm.expectRevert(EpisodeEditionCollection.MaxSupplyReached.selector);
        collection.mint{value: 0.01 ether}(0, 1);
        vm.stopPrank();
    }

    // ── Deactivate ──

    function test_deactivate_byCreator() public {
        vm.prank(creator);
        collection.createEdition(1, contentHash, 0.1 ether, 100, "ipfs://meta");

        vm.prank(creator);
        collection.deactivateEdition(0);

        (,,,,,,bool active) = collection.editions(0);
        assertFalse(active);
    }

    function test_deactivate_byPlatform() public {
        vm.prank(creator);
        collection.createEdition(1, contentHash, 0.1 ether, 100, "ipfs://meta");

        vm.prank(platform);
        collection.deactivateEdition(0);

        (,,,,,,bool active) = collection.editions(0);
        assertFalse(active);
    }

    // ── Fee Cap ──

    function test_setPlatformFee_revertsAboveMax() public {
        vm.prank(platform);
        vm.expectRevert(EpisodeEditionCollection.FeeTooHigh.selector);
        collection.setPlatformFee(5001);
    }

    function test_setPlatformFee_allowsMax() public {
        vm.prank(platform);
        collection.setPlatformFee(5000);
        assertEq(collection.platformFeeBps(), 5000);
    }

    function test_constructor_revertsFeeTooHigh() public {
        vm.expectRevert(EpisodeEditionCollection.FeeTooHigh.selector);
        new EpisodeEditionCollection(1, platform, address(registry), address(router), 5001, 500);
    }
}
