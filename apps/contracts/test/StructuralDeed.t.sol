// SPDX-License-Identifier: UNLICENSED
pragma solidity =0.8.30;

import {Test} from "forge-std/Test.sol";
import {StructuralDeed} from "../src/revenue/StructuralDeed.sol";
import {IRightsRegistry} from "../src/interfaces/IRightsRegistry.sol";
import {MockPaymentRouter} from "./mocks/MockPaymentRouter.sol";
import {MockRightsRegistry} from "./mocks/MockRightsRegistry.sol";
import {MockUniverseManager} from "./mocks/MockUniverseManager.sol";

contract StructuralDeedTest is Test {
    StructuralDeed public deed;
    MockPaymentRouter public router;
    MockRightsRegistry public registry;
    MockUniverseManager public universeManager;

    address platform = makeAddr("platform");
    address treasury = makeAddr("treasury");
    address alice = makeAddr("alice");

    uint256 constant UNIVERSE_ID = 1;
    bytes32 constant CONTENT = keccak256("content");
    string constant URI = "ipfs://metadata";

    uint256[6] prices = [0.001 ether, 0.005 ether, 0.02 ether, 0.05 ether, 0.1 ether, 0.5 ether];
    uint256[6] caps = [uint256(100), 20, 10, 5, 3, 1];

    function setUp() public {
        vm.deal(treasury, 0);
        vm.deal(alice, 100 ether);

        router = new MockPaymentRouter(treasury);
        registry = new MockRightsRegistry();
        universeManager = new MockUniverseManager();

        deed = new StructuralDeed(
            platform,
            address(router),
            address(registry),
            address(universeManager),
            500, // 5% platform fee
            250, // 2.5% royalty
            prices,
            caps
        );
    }

    // ---- Happy paths ----

    function test_mintDeed_domain() public {
        vm.prank(alice);
        uint256 tokenId = deed.mintDeed{value: 0.001 ether}(
            UNIVERSE_ID, StructuralDeed.Layer.DOMAIN, "Domain1", CONTENT, 0, URI
        );
        assertEq(tokenId, 1);
        assertEq(deed.ownerOf(1), alice);
        assertEq(deed.tokenURI(1), URI);

        (uint256 uId, StructuralDeed.Layer layer,,, address creator, uint256 parent) = deed.deeds(1);
        assertEq(uId, UNIVERSE_ID);
        assertEq(uint8(layer), 0);
        assertEq(creator, alice);
        assertEq(parent, 0);
    }

    function test_mintDeed_realm() public {
        // First mint a domain as parent
        vm.startPrank(alice);
        uint256 domainId = deed.mintDeed{value: 0.001 ether}(
            UNIVERSE_ID, StructuralDeed.Layer.DOMAIN, "Domain1", CONTENT, 0, URI
        );

        bytes32 realmContent = keccak256("realm-content");
        uint256 realmId = deed.mintDeed{value: 0.005 ether}(
            UNIVERSE_ID, StructuralDeed.Layer.REALM, "Realm1", realmContent, domainId, URI
        );
        vm.stopPrank();

        assertEq(realmId, 2);
        assertEq(deed.ownerOf(2), alice);
        (, StructuralDeed.Layer layer,,,, uint256 parent) = deed.deeds(realmId);
        assertEq(uint8(layer), 1);
        assertEq(parent, domainId);
    }

    // ---- Reverts ----

    function test_mintDeed_revert_invalidParent_wrongLayer() public {
        // Mint a domain
        vm.startPrank(alice);
        uint256 domainId = deed.mintDeed{value: 0.001 ether}(
            UNIVERSE_ID, StructuralDeed.Layer.DOMAIN, "Domain1", CONTENT, 0, URI
        );

        // Try to mint PLANE (layer 2) with DOMAIN parent (layer 0) — should need REALM parent (layer 1)
        vm.expectRevert(StructuralDeed.InvalidParent.selector);
        deed.mintDeed{value: 0.02 ether}(
            UNIVERSE_ID, StructuralDeed.Layer.PLANE, "Plane1", keccak256("plane"), domainId, URI
        );
        vm.stopPrank();
    }

    function test_mintDeed_revert_parentRequired() public {
        // Non-domain layer with parentTokenId = 0
        vm.prank(alice);
        vm.expectRevert(StructuralDeed.ParentRequired.selector);
        deed.mintDeed{value: 0.005 ether}(
            UNIVERSE_ID, StructuralDeed.Layer.REALM, "Realm1", CONTENT, 0, URI
        );
    }

    function test_mintDeed_revert_domainWithParent() public {
        // Mint a domain first to use as parent
        vm.startPrank(alice);
        uint256 domainId = deed.mintDeed{value: 0.001 ether}(
            UNIVERSE_ID, StructuralDeed.Layer.DOMAIN, "Domain1", CONTENT, 0, URI
        );

        // Try to mint another domain with a parent
        vm.expectRevert(StructuralDeed.InvalidParent.selector);
        deed.mintDeed{value: 0.001 ether}(
            UNIVERSE_ID, StructuralDeed.Layer.DOMAIN, "Domain2", keccak256("d2"), domainId, URI
        );
        vm.stopPrank();
    }

    function test_mintDeed_revert_insufficientPayment() public {
        vm.prank(alice);
        vm.expectRevert(StructuralDeed.InsufficientPayment.selector);
        deed.mintDeed{value: 0.0005 ether}(
            UNIVERSE_ID, StructuralDeed.Layer.DOMAIN, "Domain1", CONTENT, 0, URI
        );
    }

    function test_mintDeed_revert_layerSoldOut() public {
        // TIMELINE has cap of 1
        vm.startPrank(alice);

        // Build the chain: domain -> realm -> plane -> dimension -> reality -> timeline
        uint256 domainId = deed.mintDeed{value: 0.001 ether}(
            UNIVERSE_ID, StructuralDeed.Layer.DOMAIN, "D1", keccak256("d1"), 0, URI
        );
        uint256 realmId = deed.mintDeed{value: 0.005 ether}(
            UNIVERSE_ID, StructuralDeed.Layer.REALM, "R1", keccak256("r1"), domainId, URI
        );
        uint256 planeId = deed.mintDeed{value: 0.02 ether}(
            UNIVERSE_ID, StructuralDeed.Layer.PLANE, "P1", keccak256("p1"), realmId, URI
        );
        uint256 dimId = deed.mintDeed{value: 0.05 ether}(
            UNIVERSE_ID, StructuralDeed.Layer.DIMENSION, "Dim1", keccak256("dim1"), planeId, URI
        );
        uint256 realityId = deed.mintDeed{value: 0.1 ether}(
            UNIVERSE_ID, StructuralDeed.Layer.REALITY, "Real1", keccak256("real1"), dimId, URI
        );

        // Mint one timeline (fills cap)
        deed.mintDeed{value: 0.5 ether}(
            UNIVERSE_ID, StructuralDeed.Layer.TIMELINE, "T1", keccak256("t1"), realityId, URI
        );

        // Second timeline should fail
        vm.expectRevert(StructuralDeed.LayerSoldOut.selector);
        deed.mintDeed{value: 0.5 ether}(
            UNIVERSE_ID, StructuralDeed.Layer.TIMELINE, "T2", keccak256("t2"), realityId, URI
        );
        vm.stopPrank();
    }

    function test_mintDeed_revert_deedExists() public {
        vm.startPrank(alice);
        deed.mintDeed{value: 0.001 ether}(
            UNIVERSE_ID, StructuralDeed.Layer.DOMAIN, "Domain1", CONTENT, 0, URI
        );

        // Same name + universe + layer
        vm.expectRevert(StructuralDeed.DeedExists.selector);
        deed.mintDeed{value: 0.001 ether}(
            UNIVERSE_ID, StructuralDeed.Layer.DOMAIN, "Domain1", keccak256("other"), 0, URI
        );
        vm.stopPrank();
    }

    function test_mintDeed_revert_contentNotMonetizable() public {
        bytes32 frozenHash = keccak256("frozen");
        // FROZEN = 5 in the RightsType enum
        registry.setRights(frozenHash, IRightsRegistry.RightsType.FROZEN);

        vm.prank(alice);
        vm.expectRevert(StructuralDeed.ContentNotMonetizable.selector);
        deed.mintDeed{value: 0.001 ether}(
            UNIVERSE_ID, StructuralDeed.Layer.DOMAIN, "Frozen", frozenHash, 0, URI
        );
    }

    function test_mintDeed_routesPayment() public {
        uint256 treasuryBefore = treasury.balance;

        vm.prank(alice);
        deed.mintDeed{value: 0.001 ether}(
            UNIVERSE_ID, StructuralDeed.Layer.DOMAIN, "Domain1", CONTENT, 0, URI
        );

        // Mint fee is routed entirely to treasury via routeToTreasury()
        // (not split between creator and platform)
        assertEq(treasury.balance - treasuryBefore, 0.001 ether);
        assertEq(router._claimable(alice), 0);
    }

    // ---- View functions ----

    function test_getDeedsByLayer() public {
        vm.startPrank(alice);
        deed.mintDeed{value: 0.001 ether}(
            UNIVERSE_ID, StructuralDeed.Layer.DOMAIN, "D1", keccak256("d1"), 0, URI
        );
        deed.mintDeed{value: 0.001 ether}(
            UNIVERSE_ID, StructuralDeed.Layer.DOMAIN, "D2", keccak256("d2"), 0, URI
        );
        deed.mintDeed{value: 0.001 ether}(
            2, StructuralDeed.Layer.DOMAIN, "D3", keccak256("d3"), 0, URI
        );
        vm.stopPrank();

        uint256[] memory ids = deed.getDeedsByLayer(UNIVERSE_ID, StructuralDeed.Layer.DOMAIN, 1, 10);
        assertEq(ids.length, 2);
        assertEq(ids[0], 1);
        assertEq(ids[1], 2);
    }

    function test_getChildren() public {
        vm.startPrank(alice);
        uint256 domainId = deed.mintDeed{value: 0.001 ether}(
            UNIVERSE_ID, StructuralDeed.Layer.DOMAIN, "D1", keccak256("d1"), 0, URI
        );
        deed.mintDeed{value: 0.005 ether}(
            UNIVERSE_ID, StructuralDeed.Layer.REALM, "R1", keccak256("r1"), domainId, URI
        );
        deed.mintDeed{value: 0.005 ether}(
            UNIVERSE_ID, StructuralDeed.Layer.REALM, "R2", keccak256("r2"), domainId, URI
        );
        vm.stopPrank();

        uint256[] memory children = deed.getChildren(domainId, 1, 10);
        assertEq(children.length, 2);
        assertEq(children[0], 2);
        assertEq(children[1], 3);
    }
}
