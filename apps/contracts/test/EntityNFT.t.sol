// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/proxy/ERC1967/ERC1967Proxy.sol";
import {EntityNFT} from "../src/revenue/EntityNFT.sol";
import {IRightsRegistry} from "../src/interfaces/IRightsRegistry.sol";
import {MockPaymentRouter} from "./mocks/MockPaymentRouter.sol";
import {MockRightsRegistry} from "./mocks/MockRightsRegistry.sol";

contract EntityNFTTest is Test {
    EntityNFT public nft;
    MockPaymentRouter public router;
    MockRightsRegistry public registry;

    address platform = makeAddr("platform");
    address treasury = makeAddr("treasury");
    address alice = makeAddr("alice");

    uint256 constant UNIVERSE_ID = 42;
    bytes32 constant CONTENT = keccak256("entity-content");
    string constant URI = "ipfs://entity-metadata";

    function setUp() public {
        vm.deal(treasury, 0);
        vm.deal(alice, 100 ether);

        router = new MockPaymentRouter(treasury);
        registry = new MockRightsRegistry();

        EntityNFT impl = new EntityNFT();
        nft = EntityNFT(address(new ERC1967Proxy(
            address(impl),
            abi.encodeCall(EntityNFT.initialize, (
                UNIVERSE_ID,
                platform,
                address(router),
                address(registry),
                500,
                250
            ))
        )));
    }

    // ---- Initialization ----

    function test_initialize() public view {
        assertEq(nft.universeId(), UNIVERSE_ID);
        assertEq(nft.platform(), platform);
        assertEq(nft.platformFeeBps(), 500);
        assertEq(nft.royaltyBps(), 250);
    }

    // ---- Happy path mints ----

    function test_mint_place() public {
        vm.prank(alice);
        uint256 tokenId = nft.mint{value: 0.01 ether}(
            UNIVERSE_ID, EntityNFT.EntityKind.PLACE, "Tavern", CONTENT, 0.01 ether, URI
        );

        assertEq(tokenId, 1);
        assertEq(nft.ownerOf(1), alice);
        assertEq(nft.tokenURI(1), URI);

        // Check royalty info
        (address receiver, uint256 royaltyAmount) = nft.royaltyInfo(1, 10000);
        assertEq(receiver, alice);
        assertEq(royaltyAmount, 250); // 2.5% of 10000

        // Check entity data
        (uint256 uId, EntityNFT.EntityKind kind,,, address creator, uint256 mintPrice) = nft.entities(1);
        assertEq(uId, UNIVERSE_ID);
        assertEq(uint8(kind), uint8(EntityNFT.EntityKind.PLACE));
        assertEq(creator, alice);
        assertEq(mintPrice, 0.01 ether);
    }

    function test_mint_event() public {
        vm.prank(alice);
        uint256 tokenId = nft.mint{value: 0.05 ether}(
            UNIVERSE_ID, EntityNFT.EntityKind.EVENT, "Battle of Dawn", keccak256("event1"), 0.05 ether, URI
        );

        assertEq(tokenId, 1);
        (, EntityNFT.EntityKind kind,,,,) = nft.entities(1);
        assertEq(uint8(kind), uint8(EntityNFT.EntityKind.EVENT));
    }

    function test_mint_vehicle() public {
        vm.prank(alice);
        uint256 tokenId = nft.mint{value: 0.02 ether}(
            UNIVERSE_ID, EntityNFT.EntityKind.VEHICLE, "Starship", keccak256("vehicle1"), 0.02 ether, URI
        );

        assertEq(tokenId, 1);
        (, EntityNFT.EntityKind kind,,,,) = nft.entities(1);
        assertEq(uint8(kind), uint8(EntityNFT.EntityKind.VEHICLE));
    }

    // ---- Reverts ----

    function test_mint_revert_wrongUniverse() public {
        vm.prank(alice);
        vm.expectRevert(EntityNFT.WrongUniverse.selector);
        nft.mint{value: 0.01 ether}(
            999, EntityNFT.EntityKind.PLACE, "Tavern", CONTENT, 0.01 ether, URI
        );
    }

    function test_mint_revert_entityExists() public {
        vm.startPrank(alice);
        nft.mint{value: 0.01 ether}(
            UNIVERSE_ID, EntityNFT.EntityKind.PLACE, "Tavern", CONTENT, 0.01 ether, URI
        );

        // Same name + universe + kind
        vm.expectRevert(EntityNFT.EntityExists.selector);
        nft.mint{value: 0.01 ether}(
            UNIVERSE_ID, EntityNFT.EntityKind.PLACE, "Tavern", keccak256("other"), 0.01 ether, URI
        );
        vm.stopPrank();
    }

    function test_mint_revert_insufficientPayment() public {
        vm.prank(alice);
        vm.expectRevert(EntityNFT.InsufficientPayment.selector);
        nft.mint{value: 0.005 ether}(
            UNIVERSE_ID, EntityNFT.EntityKind.PLACE, "Tavern", CONTENT, 0.01 ether, URI
        );
    }

    function test_mint_revert_contentNotMonetizable() public {
        bytes32 frozenHash = keccak256("frozen-entity");
        registry.setRights(frozenHash, IRightsRegistry.RightsType.FROZEN);

        vm.prank(alice);
        vm.expectRevert(EntityNFT.ContentNotMonetizable.selector);
        nft.mint{value: 0.01 ether}(
            UNIVERSE_ID, EntityNFT.EntityKind.PLACE, "Frozen Place", frozenHash, 0.01 ether, URI
        );
    }

    // ---- Free mint & refunds ----

    function test_mint_free() public {
        vm.prank(alice);
        uint256 tokenId = nft.mint{value: 0}(
            UNIVERSE_ID, EntityNFT.EntityKind.PLACE, "Free Place", CONTENT, 0, URI
        );

        assertEq(tokenId, 1);
        assertEq(nft.ownerOf(1), alice);
        // No payment routed
        assertEq(router._claimable(alice), 0);
    }

    function test_mint_refundsExcess() public {
        uint256 balanceBefore = alice.balance;

        vm.prank(alice);
        nft.mint{value: 0.05 ether}(
            UNIVERSE_ID, EntityNFT.EntityKind.PLACE, "Tavern", CONTENT, 0.01 ether, URI
        );

        uint256 balanceAfter = alice.balance;
        // Alice should have been refunded 0.04 ether (sent 0.05, mintPrice 0.01)
        // She pays 0.01 ether total (routed via payment router)
        assertEq(balanceBefore - balanceAfter, 0.01 ether);
    }

    // ---- View functions ----

    function test_getByUniverse() public {
        vm.startPrank(alice);
        nft.mint{value: 0.01 ether}(
            UNIVERSE_ID, EntityNFT.EntityKind.PLACE, "Place1", keccak256("p1"), 0.01 ether, URI
        );
        nft.mint{value: 0.01 ether}(
            UNIVERSE_ID, EntityNFT.EntityKind.PLACE, "Place2", keccak256("p2"), 0.01 ether, URI
        );
        nft.mint{value: 0.01 ether}(
            UNIVERSE_ID, EntityNFT.EntityKind.EVENT, "Event1", keccak256("e1"), 0.01 ether, URI
        );
        vm.stopPrank();

        uint256[] memory places = nft.getByUniverse(UNIVERSE_ID, EntityNFT.EntityKind.PLACE, 1, 10);
        assertEq(places.length, 2);
        assertEq(places[0], 1);
        assertEq(places[1], 2);

        uint256[] memory events = nft.getByUniverse(UNIVERSE_ID, EntityNFT.EntityKind.EVENT, 1, 10);
        assertEq(events.length, 1);
        assertEq(events[0], 3);
    }
}
