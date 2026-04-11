// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {Test} from "forge-std/Test.sol";
import {Universe} from "../src/Universe.sol";
import {IUniverse} from "../src/interfaces/IUniverse.sol";
import {IUniverseManager} from "../src/interfaces/IUniverseManager.sol";
import {NodeCreationOptions, NodeVisibilityOptions} from "../src/libraries/NodeOptions.sol";

contract UniverseTest is Test {
    Universe public universe;

    bytes32 constant TEST_CONTENT_HASH = keccak256("testlink.org");
    bytes32 constant TEST_PLOT_HASH = keccak256("test plot");

    function setUp() public {
        NodeCreationOptions creationOption = NodeCreationOptions.PUBLIC;
        NodeVisibilityOptions visibilityOption = NodeVisibilityOptions.PUBLIC;

        IUniverseManager.UniverseConfig memory config = IUniverseManager
            .UniverseConfig({
                nodeCreationOption: creationOption,
                nodeVisibilityOption: visibilityOption,
                universeAdmin: msg.sender,
                name: "Universe Name",
                imageURL: "Universeimage.com",
                description: "test universe",
                universeManager: msg.sender
            });
        universe = new Universe(config);
    }

    function test_createNode() public {
        uint id = createNode();
        (
            uint nid,
            bytes32 contentHash,
            bytes32 plotHash,
            uint prev,
            uint[] memory next,
            bool canon,
            address creator
        ) = universe.getNode(id);

        assertEq(contentHash, TEST_CONTENT_HASH);
        assertEq(plotHash, TEST_PLOT_HASH);
        assertTrue(canon); // root node should be canon
        assertEq(creator, address(this));
    }

    function test_createBranch() public {
        uint rootId = createNode();
        uint branchId = universe.createNode(
            keccak256("branch-link"),
            keccak256("branch plot"),
            rootId,
            "branch-link.org",
            "branch plot"
        );

        (,,,, uint[] memory rootNext,,) = universe.getNode(rootId);
        assertEq(rootNext.length, 1);
        assertEq(rootNext[0], branchId);

        (,,, uint prev,,bool canon,) = universe.getNode(branchId);
        assertEq(prev, rootId);
        assertFalse(canon); // non-root should not be canon
    }

    function test_eventEmission() public {
        vm.expectEmit(true, true, true, true);
        emit IUniverse.NodeCreated(
            1,
            0,
            address(this),
            TEST_CONTENT_HASH,
            TEST_PLOT_HASH,
            "testlink.org",
            "test plot"
        );
        createNode();
    }

    function test_getMedia() public {
        uint id = createNode();
        bytes32 contentHash = universe.getMedia(id);
        assertEq(contentHash, TEST_CONTENT_HASH);
    }

    function test_getFullGraph() public {
        createNode();
        universe.createNode(
            keccak256("link2"),
            keccak256("plot2"),
            1,
            "link2.org",
            "plot2"
        );

        (
            uint[] memory ids,
            bytes32[] memory contentHashes,
            bytes32[] memory plotHashes,
            uint[] memory previousIds,
            ,
            bool[] memory canonFlags
        ) = universe.getFullGraph();

        assertEq(ids.length, 2);
        assertEq(contentHashes[0], TEST_CONTENT_HASH);
        assertEq(previousIds[1], 1);
        assertTrue(canonFlags[0]);
    }

    function test_getTimeline() public {
        uint root = createNode();
        uint child1 = universe.createNode(keccak256("c1"), keccak256("p1"), root, "c1", "p1");
        uint child2 = universe.createNode(keccak256("c2"), keccak256("p2"), child1, "c2", "p2");

        uint[] memory timeline = universe.getTimeline(child2);
        assertEq(timeline.length, 3);
        assertEq(timeline[0], child2);
        assertEq(timeline[1], child1);
        assertEq(timeline[2], root);
    }

    function test_setMedia() public {
        uint id = createNode();
        bytes32 newHash = keccak256("new-link");
        vm.prank(msg.sender); // admin is msg.sender from setUp
        universe.setMedia(id, newHash, "new-link.org");
        assertEq(universe.getMedia(id), newHash);
    }

    function test_setCanon() public {
        uint root = createNode();
        uint child = universe.createNode(keccak256("c"), keccak256("p"), root, "c", "p");
        vm.prank(msg.sender); // admin is msg.sender from setUp
        universe.setCanon(child);

        (,,,,,bool rootCanon,) = universe.getNode(root);
        assertFalse(rootCanon);
        (,,,,,bool childCanon,) = universe.getNode(child);
        assertTrue(childCanon);
    }

    // --- Security tests ---

    function test_nodeIdToHex_validId() public {
        uint id = createNode();
        bytes32 result = universe.nodeIdToHex(id);
        assertTrue(result != bytes32(0));
    }

    function test_nodeIdToHex_invalidId() public {
        createNode(); // latestNodeId = 1
        vm.expectRevert(abi.encodeWithSelector(IUniverse.NodeDoesNotExist.selector));
        universe.nodeIdToHex(999);
    }

    function test_nodeIdToHex_zeroId() public {
        vm.expectRevert(abi.encodeWithSelector(IUniverse.NodeDoesNotExist.selector));
        universe.nodeIdToHex(0);
    }

    function test_createNode_whitelistedMode_revert() public {
        // Deploy a WHITELISTED universe
        IUniverseManager.UniverseConfig memory config = IUniverseManager.UniverseConfig({
            nodeCreationOption: NodeCreationOptions.WHITELISTED,
            nodeVisibilityOption: NodeVisibilityOptions.PUBLIC,
            universeAdmin: address(this),
            name: "WL Universe",
            imageURL: "img.com",
            description: "whitelisted",
            universeManager: address(this)
        });
        Universe wlUniverse = new Universe(config);

        // Non-whitelisted user should revert
        vm.prank(address(0xBEEF));
        vm.expectRevert("Not whitelisted");
        wlUniverse.createNode(keccak256("l"), keccak256("p"), 0, "l", "p");
    }

    function test_createNode_whitelistedMode_success() public {
        IUniverseManager.UniverseConfig memory config = IUniverseManager.UniverseConfig({
            nodeCreationOption: NodeCreationOptions.WHITELISTED,
            nodeVisibilityOption: NodeVisibilityOptions.PUBLIC,
            universeAdmin: address(this),
            name: "WL Universe",
            imageURL: "img.com",
            description: "whitelisted",
            universeManager: address(this)
        });
        Universe wlUniverse = new Universe(config);

        // Whitelist an address
        wlUniverse.setWhitelisted(address(0xBEEF), true);
        assertTrue(wlUniverse.getWhitelisted(address(0xBEEF)));

        // Whitelisted user can create
        vm.prank(address(0xBEEF));
        uint id = wlUniverse.createNode(keccak256("l"), keccak256("p"), 0, "l", "p");
        assertEq(id, 1);
    }

    function test_constructorZeroAdmin() public {
        IUniverseManager.UniverseConfig memory config = IUniverseManager.UniverseConfig({
            nodeCreationOption: NodeCreationOptions.PUBLIC,
            nodeVisibilityOption: NodeVisibilityOptions.PUBLIC,
            universeAdmin: address(0),
            name: "Bad Universe",
            imageURL: "img.com",
            description: "bad",
            universeManager: address(this)
        });
        vm.expectRevert("Zero admin address");
        new Universe(config);
    }

    function test_constructorZeroManager() public {
        IUniverseManager.UniverseConfig memory config = IUniverseManager.UniverseConfig({
            nodeCreationOption: NodeCreationOptions.PUBLIC,
            nodeVisibilityOption: NodeVisibilityOptions.PUBLIC,
            universeAdmin: address(this),
            name: "Bad Universe",
            imageURL: "img.com",
            description: "bad",
            universeManager: address(0)
        });
        vm.expectRevert("Zero manager address");
        new Universe(config);
    }

    function testFuzz_createNode(bytes32 contentHash, bytes32 plotHash) public {
        uint id = universe.createNode(contentHash, plotHash, 0, "fuzz-link", "fuzz-plot");
        assertEq(id, 1);
        (uint nid, bytes32 ch, bytes32 ph,,,,) = universe.getNode(id);
        assertEq(nid, id);
        assertEq(ch, contentHash);
        assertEq(ph, plotHash);
    }

    function createNode() internal returns (uint) {
        uint id = universe.createNode(
            TEST_CONTENT_HASH,
            TEST_PLOT_HASH,
            0,
            "testlink.org",
            "test plot"
        );
        return id;
    }
}
