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
    address bob = makeAddr("bob");
    address stranger = makeAddr("stranger");

    uint256 constant UNIVERSE_ID = 42;
    bytes32 constant CONTENT = keccak256("entity-content");
    string constant URI = "ipfs://entity-metadata";

    function setUp() public {
        vm.deal(treasury, 0);
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);

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

    // =========================================================================
    //                          INITIALIZATION
    // =========================================================================

    function test_initialize() public view {
        assertEq(nft.universeId(), UNIVERSE_ID);
        assertEq(nft.platform(), platform);
        assertEq(nft.platformFeeBps(), 500);
        assertEq(nft.royaltyBps(), 250);
        assertEq(address(nft.paymentRouter()), address(router));
        assertEq(address(nft.rightsRegistry()), address(registry));
    }

    function test_initialize_revert_feeTooHigh() public {
        EntityNFT impl = new EntityNFT();
        vm.expectRevert(EntityNFT.FeeTooHigh.selector);
        new ERC1967Proxy(
            address(impl),
            abi.encodeCall(EntityNFT.initialize, (
                UNIVERSE_ID, platform, address(router), address(registry), 5001, 250
            ))
        );
    }

    function test_initialize_maxFee() public {
        EntityNFT impl = new EntityNFT();
        EntityNFT nft2 = EntityNFT(address(new ERC1967Proxy(
            address(impl),
            abi.encodeCall(EntityNFT.initialize, (
                UNIVERSE_ID, platform, address(router), address(registry), 5000, 250
            ))
        )));
        assertEq(nft2.platformFeeBps(), 5000);
    }

    function test_cannotReinitialize() public {
        vm.expectRevert();
        nft.initialize(UNIVERSE_ID, platform, address(router), address(registry), 500, 250);
    }

    function test_nameAndSymbol() public view {
        assertEq(nft.name(), "LOAR Entities");
        assertEq(nft.symbol(), "ENTITY");
    }

    // =========================================================================
    //                          HAPPY PATH MINTS
    // =========================================================================

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
        (uint256 uId, EntityNFT.EntityKind kind,,, address creator_, uint256 mintPrice) = nft.entities(1);
        assertEq(uId, UNIVERSE_ID);
        assertEq(uint8(kind), uint8(EntityNFT.EntityKind.PLACE));
        assertEq(creator_, alice);
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

    function test_mint_multipleEntities_incrementTokenId() public {
        vm.startPrank(alice);
        uint256 t1 = nft.mint{value: 0.01 ether}(UNIVERSE_ID, EntityNFT.EntityKind.PLACE, "Place1", keccak256("p1"), 0.01 ether, URI);
        uint256 t2 = nft.mint{value: 0.01 ether}(UNIVERSE_ID, EntityNFT.EntityKind.PLACE, "Place2", keccak256("p2"), 0.01 ether, URI);
        uint256 t3 = nft.mint{value: 0.01 ether}(UNIVERSE_ID, EntityNFT.EntityKind.EVENT, "Event1", keccak256("e1"), 0.01 ether, URI);
        vm.stopPrank();

        assertEq(t1, 1);
        assertEq(t2, 2);
        assertEq(t3, 3);
        assertEq(nft.nextTokenId(), 3);
    }

    function test_mint_differentUsersCanMint() public {
        vm.prank(alice);
        uint256 t1 = nft.mint{value: 0.01 ether}(UNIVERSE_ID, EntityNFT.EntityKind.PLACE, "Alice Place", keccak256("ap"), 0.01 ether, URI);

        vm.prank(bob);
        uint256 t2 = nft.mint{value: 0.01 ether}(UNIVERSE_ID, EntityNFT.EntityKind.PLACE, "Bob Place", keccak256("bp"), 0.01 ether, URI);

        assertEq(nft.ownerOf(t1), alice);
        assertEq(nft.ownerOf(t2), bob);
    }

    function test_mint_sameNameDifferentKind_succeeds() public {
        vm.startPrank(alice);
        // Same name "Dragon" as PLACE and EVENT should both succeed
        nft.mint{value: 0.01 ether}(UNIVERSE_ID, EntityNFT.EntityKind.PLACE, "Dragon", keccak256("dp"), 0.01 ether, URI);
        nft.mint{value: 0.01 ether}(UNIVERSE_ID, EntityNFT.EntityKind.EVENT, "Dragon", keccak256("de"), 0.01 ether, URI);
        vm.stopPrank();

        assertEq(nft.totalSupply(), 2);
    }

    // =========================================================================
    //                          REVERTS
    // =========================================================================

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

    function test_mint_revert_zeroPaymentForPaidMint() public {
        vm.prank(alice);
        vm.expectRevert(EntityNFT.InsufficientPayment.selector);
        nft.mint{value: 0}(
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

    function test_mint_revert_whenPaused() public {
        vm.prank(platform);
        nft.pause();

        vm.prank(alice);
        vm.expectRevert();
        nft.mint{value: 0.01 ether}(
            UNIVERSE_ID, EntityNFT.EntityKind.PLACE, "Tavern", CONTENT, 0.01 ether, URI
        );
    }

    // =========================================================================
    //                     FREE MINT & REFUNDS
    // =========================================================================

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

    function test_mint_free_noRouterCall() public {
        // Send 0 for free mint — treasury should receive nothing
        uint256 treasuryBefore = treasury.balance;

        vm.prank(alice);
        nft.mint{value: 0}(
            UNIVERSE_ID, EntityNFT.EntityKind.PLACE, "Free Place", CONTENT, 0, URI
        );

        assertEq(treasury.balance, treasuryBefore);
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

    function test_mint_exactPayment_noRefund() public {
        uint256 balanceBefore = alice.balance;

        vm.prank(alice);
        nft.mint{value: 0.01 ether}(
            UNIVERSE_ID, EntityNFT.EntityKind.PLACE, "Tavern", CONTENT, 0.01 ether, URI
        );

        assertEq(balanceBefore - alice.balance, 0.01 ether);
    }

    // =========================================================================
    //                     PAYMENT ROUTING
    // =========================================================================

    function test_mint_routesPaymentToCreatorAndTreasury() public {
        vm.prank(alice);
        nft.mint{value: 0.1 ether}(
            UNIVERSE_ID, EntityNFT.EntityKind.PLACE, "Rich Place", keccak256("rich"), 0.1 ether, URI
        );

        // 5% platform fee = 0.005 ether to treasury
        uint256 expectedFee = (0.1 ether * 500) / 10000;
        assertEq(treasury.balance, expectedFee);

        // Creator gets remainder
        uint256 expectedCreatorCut = 0.1 ether - expectedFee;
        assertEq(router._claimable(alice), expectedCreatorCut);
    }

    function test_mint_paymentRouting_multipleMints() public {
        vm.prank(alice);
        nft.mint{value: 0.1 ether}(UNIVERSE_ID, EntityNFT.EntityKind.PLACE, "P1", keccak256("p1"), 0.1 ether, URI);

        vm.prank(bob);
        nft.mint{value: 0.2 ether}(UNIVERSE_ID, EntityNFT.EntityKind.EVENT, "E1", keccak256("e1"), 0.2 ether, URI);

        uint256 aliceCut = 0.1 ether - (0.1 ether * 500 / 10000);
        uint256 bobCut = 0.2 ether - (0.2 ether * 500 / 10000);

        assertEq(router._claimable(alice), aliceCut);
        assertEq(router._claimable(bob), bobCut);
    }

    // =========================================================================
    //                          ERC2981 ROYALTIES
    // =========================================================================

    function test_royaltyInfo_perToken() public {
        vm.prank(alice);
        nft.mint{value: 0.01 ether}(UNIVERSE_ID, EntityNFT.EntityKind.PLACE, "P1", keccak256("p1"), 0.01 ether, URI);

        vm.prank(bob);
        nft.mint{value: 0.01 ether}(UNIVERSE_ID, EntityNFT.EntityKind.EVENT, "E1", keccak256("e1"), 0.01 ether, URI);

        // Token 1 royalties go to alice
        (address r1, uint256 amt1) = nft.royaltyInfo(1, 1 ether);
        assertEq(r1, alice);
        assertEq(amt1, 0.025 ether); // 2.5%

        // Token 2 royalties go to bob
        (address r2, uint256 amt2) = nft.royaltyInfo(2, 1 ether);
        assertEq(r2, bob);
        assertEq(amt2, 0.025 ether);
    }

    function test_royaltyInfo_variousSalePrices() public {
        vm.prank(alice);
        nft.mint{value: 0}(UNIVERSE_ID, EntityNFT.EntityKind.PLACE, "P1", CONTENT, 0, URI);

        // 250 bps = 2.5%
        (, uint256 r1) = nft.royaltyInfo(1, 100 ether);
        assertEq(r1, 2.5 ether);

        (, uint256 r2) = nft.royaltyInfo(1, 0);
        assertEq(r2, 0);

        (, uint256 r3) = nft.royaltyInfo(1, 1);
        assertEq(r3, 0); // rounds down
    }

    // =========================================================================
    //                          PAUSE / UNPAUSE
    // =========================================================================

    function test_pause_onlyPlatform() public {
        vm.prank(platform);
        nft.pause();
        assertTrue(nft.paused());
    }

    function test_unpause_onlyPlatform() public {
        vm.prank(platform);
        nft.pause();

        vm.prank(platform);
        nft.unpause();
        assertFalse(nft.paused());
    }

    function test_pause_revert_notPlatform() public {
        vm.prank(stranger);
        vm.expectRevert(EntityNFT.NotPlatform.selector);
        nft.pause();
    }

    function test_unpause_revert_notPlatform() public {
        vm.prank(platform);
        nft.pause();

        vm.prank(stranger);
        vm.expectRevert(EntityNFT.NotPlatform.selector);
        nft.unpause();
    }

    function test_mintAfterUnpause() public {
        vm.prank(platform);
        nft.pause();

        vm.prank(platform);
        nft.unpause();

        vm.prank(alice);
        uint256 tokenId = nft.mint{value: 0}(
            UNIVERSE_ID, EntityNFT.EntityKind.PLACE, "After Unpause", CONTENT, 0, URI
        );
        assertEq(tokenId, 1);
    }

    // =========================================================================
    //                          SET PLATFORM FEE
    // =========================================================================

    function test_setPlatformFee() public {
        vm.prank(platform);
        nft.setPlatformFee(1000);
        assertEq(nft.platformFeeBps(), 1000);
    }

    function test_setPlatformFee_revert_notPlatform() public {
        vm.prank(stranger);
        vm.expectRevert(EntityNFT.NotPlatform.selector);
        nft.setPlatformFee(1000);
    }

    function test_setPlatformFee_revert_tooHigh() public {
        vm.prank(platform);
        vm.expectRevert(EntityNFT.FeeTooHigh.selector);
        nft.setPlatformFee(5001);
    }

    function test_setPlatformFee_maxFee() public {
        vm.prank(platform);
        nft.setPlatformFee(5000);
        assertEq(nft.platformFeeBps(), 5000);
    }

    function test_setPlatformFee_zero() public {
        vm.prank(platform);
        nft.setPlatformFee(0);
        assertEq(nft.platformFeeBps(), 0);
    }

    // =========================================================================
    //                          VIEW FUNCTIONS
    // =========================================================================

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

    function test_getByUniverse_empty() public view {
        uint256[] memory result = nft.getByUniverse(UNIVERSE_ID, EntityNFT.EntityKind.PLACE, 1, 10);
        assertEq(result.length, 0);
    }

    function test_getByUniverse_wrongUniverse() public {
        vm.prank(alice);
        nft.mint{value: 0}(UNIVERSE_ID, EntityNFT.EntityKind.PLACE, "P1", CONTENT, 0, URI);

        uint256[] memory result = nft.getByUniverse(999, EntityNFT.EntityKind.PLACE, 1, 10);
        assertEq(result.length, 0);
    }

    function test_getByUniverse_pagination() public {
        vm.startPrank(alice);
        for (uint256 i = 0; i < 5; i++) {
            nft.mint{value: 0}(
                UNIVERSE_ID, EntityNFT.EntityKind.PLACE,
                string(abi.encodePacked("Place", vm.toString(i))),
                keccak256(abi.encodePacked("p", i)),
                0, URI
            );
        }
        vm.stopPrank();

        // Get first 2
        uint256[] memory page1 = nft.getByUniverse(UNIVERSE_ID, EntityNFT.EntityKind.PLACE, 1, 2);
        assertEq(page1.length, 2);
        assertEq(page1[0], 1);
        assertEq(page1[1], 2);

        // Get next 2
        uint256[] memory page2 = nft.getByUniverse(UNIVERSE_ID, EntityNFT.EntityKind.PLACE, 3, 2);
        assertEq(page2.length, 2);
        assertEq(page2[0], 3);
        assertEq(page2[1], 4);
    }

    // =========================================================================
    //                          ERC721 ENUMERABLE
    // =========================================================================

    function test_totalSupply() public {
        assertEq(nft.totalSupply(), 0);

        vm.startPrank(alice);
        nft.mint{value: 0}(UNIVERSE_ID, EntityNFT.EntityKind.PLACE, "P1", keccak256("p1"), 0, URI);
        nft.mint{value: 0}(UNIVERSE_ID, EntityNFT.EntityKind.EVENT, "E1", keccak256("e1"), 0, URI);
        vm.stopPrank();

        assertEq(nft.totalSupply(), 2);
    }

    function test_balanceOf() public {
        vm.prank(alice);
        nft.mint{value: 0}(UNIVERSE_ID, EntityNFT.EntityKind.PLACE, "P1", keccak256("p1"), 0, URI);

        vm.prank(bob);
        nft.mint{value: 0}(UNIVERSE_ID, EntityNFT.EntityKind.EVENT, "E1", keccak256("e1"), 0, URI);

        vm.prank(alice);
        nft.mint{value: 0}(UNIVERSE_ID, EntityNFT.EntityKind.VEHICLE, "V1", keccak256("v1"), 0, URI);

        assertEq(nft.balanceOf(alice), 2);
        assertEq(nft.balanceOf(bob), 1);
    }

    function test_tokenByIndex() public {
        vm.startPrank(alice);
        nft.mint{value: 0}(UNIVERSE_ID, EntityNFT.EntityKind.PLACE, "P1", keccak256("p1"), 0, URI);
        nft.mint{value: 0}(UNIVERSE_ID, EntityNFT.EntityKind.EVENT, "E1", keccak256("e1"), 0, URI);
        vm.stopPrank();

        assertEq(nft.tokenByIndex(0), 1);
        assertEq(nft.tokenByIndex(1), 2);
    }

    // =========================================================================
    //                          SUPPORTS INTERFACE
    // =========================================================================

    function test_supportsInterface_ERC721() public view {
        assertTrue(nft.supportsInterface(0x80ac58cd)); // ERC721
    }

    function test_supportsInterface_ERC2981() public view {
        assertTrue(nft.supportsInterface(0x2a55205a)); // ERC2981
    }

    function test_supportsInterface_ERC721Enumerable() public view {
        assertTrue(nft.supportsInterface(0x780e9d63)); // ERC721Enumerable
    }

    // =========================================================================
    //                     RIGHTS REGISTRY INTEGRATION
    // =========================================================================

    function test_mint_succeeds_withOriginalRights() public {
        bytes32 h = keccak256("original");
        registry.setRights(h, IRightsRegistry.RightsType.ORIGINAL);

        vm.prank(alice);
        uint256 tokenId = nft.mint{value: 0}(UNIVERSE_ID, EntityNFT.EntityKind.PLACE, "Orig", h, 0, URI);
        assertEq(tokenId, 1);
    }

    function test_mint_succeeds_withLicensedRights() public {
        bytes32 h = keccak256("licensed");
        registry.setRights(h, IRightsRegistry.RightsType.LICENSED);

        vm.prank(alice);
        uint256 tokenId = nft.mint{value: 0}(UNIVERSE_ID, EntityNFT.EntityKind.PLACE, "Licensed", h, 0, URI);
        assertEq(tokenId, 1);
    }

    function test_mint_succeeds_withPublicDomainRights() public {
        bytes32 h = keccak256("public");
        registry.setRights(h, IRightsRegistry.RightsType.PUBLIC_DOMAIN);

        vm.prank(alice);
        uint256 tokenId = nft.mint{value: 0}(UNIVERSE_ID, EntityNFT.EntityKind.PLACE, "PD", h, 0, URI);
        assertEq(tokenId, 1);
    }

    function test_mint_revert_frozenContent() public {
        bytes32 h = keccak256("frozen");
        registry.setRights(h, IRightsRegistry.RightsType.FROZEN);

        vm.prank(alice);
        vm.expectRevert(EntityNFT.ContentNotMonetizable.selector);
        nft.mint{value: 0}(UNIVERSE_ID, EntityNFT.EntityKind.PLACE, "Frozen", h, 0, URI);
    }

    function test_mint_revert_allContentNonMonetizable() public {
        // Disable default monetizable flag
        registry.setDefaultMonetizable(false);

        vm.prank(alice);
        vm.expectRevert(EntityNFT.ContentNotMonetizable.selector);
        nft.mint{value: 0}(UNIVERSE_ID, EntityNFT.EntityKind.PLACE, "Blocked", CONTENT, 0, URI);
    }

    // =========================================================================
    //                          EVENT EMISSION
    // =========================================================================

    function test_event_EntityMinted() public {
        vm.prank(alice);
        vm.expectEmit(true, true, false, true);
        emit EntityNFT.EntityMinted(1, UNIVERSE_ID, EntityNFT.EntityKind.PLACE, "Tavern", alice, CONTENT);
        nft.mint{value: 0.01 ether}(UNIVERSE_ID, EntityNFT.EntityKind.PLACE, "Tavern", CONTENT, 0.01 ether, URI);
    }

    // =========================================================================
    //                     FULL LIFECYCLE
    // =========================================================================

    function test_fullLifecycle_mintTransferRoyalty() public {
        // Alice mints
        vm.prank(alice);
        uint256 tokenId = nft.mint{value: 0.1 ether}(
            UNIVERSE_ID, EntityNFT.EntityKind.VEHICLE, "Starship", CONTENT, 0.1 ether, URI
        );

        // Alice transfers to Bob
        vm.prank(alice);
        nft.transferFrom(alice, bob, tokenId);
        assertEq(nft.ownerOf(tokenId), bob);

        // Royalty still goes to alice (creator)
        (address receiver, uint256 royalty) = nft.royaltyInfo(tokenId, 1 ether);
        assertEq(receiver, alice);
        assertEq(royalty, 0.025 ether);
    }

    function test_fullLifecycle_multipleKindsSameUniverse() public {
        vm.startPrank(alice);
        nft.mint{value: 0}(UNIVERSE_ID, EntityNFT.EntityKind.PLACE, "Tavern", keccak256("t"), 0, URI);
        nft.mint{value: 0}(UNIVERSE_ID, EntityNFT.EntityKind.EVENT, "Battle", keccak256("b"), 0, URI);
        nft.mint{value: 0}(UNIVERSE_ID, EntityNFT.EntityKind.VEHICLE, "Cart", keccak256("c"), 0, URI);
        vm.stopPrank();

        assertEq(nft.totalSupply(), 3);
        assertEq(nft.balanceOf(alice), 3);

        uint256[] memory places = nft.getByUniverse(UNIVERSE_ID, EntityNFT.EntityKind.PLACE, 1, 10);
        uint256[] memory events_ = nft.getByUniverse(UNIVERSE_ID, EntityNFT.EntityKind.EVENT, 1, 10);
        uint256[] memory vehicles = nft.getByUniverse(UNIVERSE_ID, EntityNFT.EntityKind.VEHICLE, 1, 10);

        assertEq(places.length, 1);
        assertEq(events_.length, 1);
        assertEq(vehicles.length, 1);
    }
}
