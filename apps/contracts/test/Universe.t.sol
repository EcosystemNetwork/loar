// SPDX-License-Identifier: MIT
pragma solidity =0.8.30;

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

        IUniverseManager.UniverseConfig memory config = IUniverseManager.UniverseConfig({
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
        uint256 id = createNode();
        (
            uint256 nid,
            bytes32 contentHash,
            bytes32 plotHash,
            uint256 prev,
            uint256[] memory next,
            bool canon,
            address creator
        ) = universe.getNode(id);

        assertEq(contentHash, TEST_CONTENT_HASH);
        assertEq(plotHash, TEST_PLOT_HASH);
        assertTrue(canon); // root node should be canon
        assertEq(creator, address(this));
    }

    function test_createBranch() public {
        uint256 rootId = createNode();
        uint256 branchId = universe.createNode(
            keccak256("branch-link"),
            keccak256("branch plot"),
            rootId,
            "branch-link.org",
            "branch plot"
        );

        (,,,, uint256[] memory rootNext,,) = universe.getNode(rootId);
        assertEq(rootNext.length, 1);
        assertEq(rootNext[0], branchId);

        (,,, uint256 prev,, bool canon,) = universe.getNode(branchId);
        assertEq(prev, rootId);
        assertFalse(canon); // non-root should not be canon
    }

    function test_eventEmission() public {
        vm.expectEmit(true, true, true, true);
        emit IUniverse.NodeCreated(
            1, 0, address(this), TEST_CONTENT_HASH, TEST_PLOT_HASH, "testlink.org", "test plot"
        );
        createNode();
    }

    function test_getMedia() public {
        uint256 id = createNode();
        bytes32 contentHash = universe.getMedia(id);
        assertEq(contentHash, TEST_CONTENT_HASH);
    }

    function test_getFullGraph() public {
        createNode();
        universe.createNode(keccak256("link2"), keccak256("plot2"), 1, "link2.org", "plot2");

        (
            uint256[] memory ids,
            bytes32[] memory contentHashes,
            bytes32[] memory plotHashes,
            uint256[] memory previousIds,,
            bool[] memory canonFlags
        ) = universe.getFullGraph();

        assertEq(ids.length, 2);
        assertEq(contentHashes[0], TEST_CONTENT_HASH);
        assertEq(previousIds[1], 1);
        assertTrue(canonFlags[0]);
    }

    // --- getFullGraph() / getGraphPage() cap & pagination ---
    //
    // getFullGraph() hard-reverts once latestNodeId exceeds 500 — this is
    // the exact mechanism behind an incident where every universe that grew
    // past 500 total nodes rendered a permanently empty timeline/canvas on
    // the frontend, with no error shown anywhere (the frontend never called
    // getGraphPage() at all — see apps/web/src/hooks/useUniverseBlockchain.ts
    // and apps/web/src/hooks/universeGraphPaging.ts, whose
    // FULL_GRAPH_NODE_LIMIT constant must stay in lockstep with the `500`
    // below). These tests pin the contract-side half of that contract down
    // so it can't silently drift out of sync with the frontend's assumptions.

    function test_getFullGraph_succeedsAtExactly500() public {
        createChain(500);
        (uint256[] memory ids,,,,,) = universe.getFullGraph();
        assertEq(ids.length, 500);
        assertEq(universe.latestNodeId(), 500);
    }

    function test_getFullGraph_revertsAbove500() public {
        createChain(501);
        assertEq(universe.latestNodeId(), 501);
        vm.expectRevert("Use getGraphPage for large graphs");
        universe.getFullGraph();
    }

    function test_getGraphPage_matchesGetFullGraph_forSmallGraph() public {
        createChain(10);

        (
            uint256[] memory fullIds,
            bytes32[] memory fullContentHashes,
            bytes32[] memory fullPlotHashes,
            uint256[] memory fullPreviousIds,
            uint256[][] memory fullNextIds,
            bool[] memory fullCanonFlags
        ) = universe.getFullGraph();

        (
            uint256[] memory pageIds,
            bytes32[] memory pageContentHashes,
            bytes32[] memory pagePlotHashes,
            uint256[] memory pagePreviousIds,
            uint256[][] memory pageNextIds,
            bool[] memory pageCanonFlags
        ) = universe.getGraphPage(1, 10);

        // getGraphPage(1, latestNodeId) must be byte-for-byte identical to
        // getFullGraph() — this is exactly the parity the frontend's <=500
        // "fast path" (getFullGraph) vs paginated path depend on producing
        // the same shape of data.
        assertEq(fullIds.length, pageIds.length);
        for (uint256 i = 0; i < fullIds.length; i++) {
            assertEq(fullIds[i], pageIds[i]);
            assertEq(fullContentHashes[i], pageContentHashes[i]);
            assertEq(fullPlotHashes[i], pagePlotHashes[i]);
            assertEq(fullPreviousIds[i], pagePreviousIds[i]);
            assertEq(fullCanonFlags[i], pageCanonFlags[i]);
            assertEq(fullNextIds[i].length, pageNextIds[i].length);
            for (uint256 j = 0; j < fullNextIds[i].length; j++) {
                assertEq(fullNextIds[i][j], pageNextIds[i][j]);
            }
        }
    }

    function test_getGraphPage_paginationCoversLargeGraphWithNoGapsOrOverlap() public {
        // One past the cap — the smallest universe that actually needs
        // pagination (mirrors FULL_GRAPH_NODE_LIMIT + 1 in the frontend's
        // unit tests, apps/web/src/hooks/__tests__/universeGraphPaging.test.ts).
        uint256 total = 501;
        createChain(total);

        uint256 pageSize = 200;
        uint256 covered = 0;
        for (uint256 startId = 1; startId <= total; startId += pageSize) {
            (uint256[] memory ids,,, uint256[] memory previousIds,, bool[] memory canonFlags) =
                universe.getGraphPage(startId, pageSize);

            uint256 expectedCount =
                (startId + pageSize - 1 > total) ? (total - startId + 1) : pageSize;
            assertEq(ids.length, expectedCount, "page size mismatch");

            for (uint256 i = 0; i < ids.length; i++) {
                uint256 expectedId = startId + i;
                assertEq(ids[i], expectedId, "node id out of order at page boundary");
                if (expectedId == 1) {
                    assertEq(previousIds[i], 0);
                    assertTrue(canonFlags[i]);
                } else {
                    assertEq(previousIds[i], expectedId - 1, "chain broken across page boundary");
                }
            }
            covered += ids.length;
        }
        assertEq(covered, total, "pagination left gaps or double-counted nodes");
    }

    function test_getGraphPage_zeroStartId_returnsEmpty() public {
        createChain(5);
        (uint256[] memory ids,,,,,) = universe.getGraphPage(0, 10);
        assertEq(ids.length, 0);
    }

    function test_getGraphPage_startBeyondLatestNodeId_returnsEmpty() public {
        createChain(5);
        (uint256[] memory ids,,,,,) = universe.getGraphPage(1000, 10);
        assertEq(ids.length, 0);
    }

    function test_getGraphPage_countClampsToLatestNodeId() public {
        createChain(5);
        // Asking for far more than exists must clamp, not revert or return
        // out-of-bounds/garbage entries.
        (uint256[] memory ids,,,,,) = universe.getGraphPage(1, 1_000_000);
        assertEq(ids.length, 5);
        assertEq(ids[4], 5);
    }

    function test_getGraphPage_middlePage_startsPastFirstPage() public {
        createChain(25);
        (uint256[] memory ids,,, uint256[] memory previousIds,,) = universe.getGraphPage(11, 10);
        assertEq(ids.length, 10);
        assertEq(ids[0], 11);
        assertEq(ids[9], 20);
        assertEq(previousIds[0], 10); // chains correctly into the *previous* page's last node
    }

    /// @dev Creates `count` nodes chained root-to-tip (node i's previous = i-1),
    ///      mirroring how a real universe's timeline actually grows.
    function createChain(uint256 count) internal {
        uint256 previous = 0;
        for (uint256 i = 1; i <= count; i++) {
            previous =
                universe.createNode(keccak256(abi.encodePacked("content", i)), keccak256(abi.encodePacked("plot", i)), previous, "link", "plot");
        }
    }

    function test_getTimeline() public {
        uint256 root = createNode();
        uint256 child1 = universe.createNode(keccak256("c1"), keccak256("p1"), root, "c1", "p1");
        uint256 child2 = universe.createNode(keccak256("c2"), keccak256("p2"), child1, "c2", "p2");

        uint256[] memory timeline = universe.getTimeline(child2);
        assertEq(timeline.length, 3);
        assertEq(timeline[0], child2);
        assertEq(timeline[1], child1);
        assertEq(timeline[2], root);
    }

    function test_setMedia() public {
        // createNode() is called as address(this), so this Test contract is
        // the original creator — that satisfies UNIVERSE-01's
        // `msg.sender == originalCreator` branch even though the root node
        // was auto-promoted to canon. The previous `vm.prank(msg.sender)` set
        // the caller to the test runner (not address(this) = creator) and
        // hit the canon-immutability revert.
        uint256 id = createNode();
        bytes32 newHash = keccak256("new-link");
        universe.setMedia(id, newHash, "new-link.org");
        assertEq(universe.getMedia(id), newHash);
    }

    function test_setCanon() public {
        uint256 root = createNode();
        uint256 child = universe.createNode(keccak256("c"), keccak256("p"), root, "c", "p");
        vm.prank(msg.sender); // admin is msg.sender from setUp
        universe.setCanon(child);

        (,,,,, bool rootCanon,) = universe.getNode(root);
        assertTrue(rootCanon); // root stays canon — setCanon only marks the target node
        (,,,,, bool childCanon,) = universe.getNode(child);
        assertTrue(childCanon);
    }

    // --- Security tests ---

    function test_nodeIdToHex_validId() public {
        uint256 id = createNode();
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
        uint256 id = wlUniverse.createNode(keccak256("l"), keccak256("p"), 0, "l", "p");
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
        uint256 id = universe.createNode(contentHash, plotHash, 0, "fuzz-link", "fuzz-plot");
        assertEq(id, 1);
        (uint256 nid, bytes32 ch, bytes32 ph,,,,) = universe.getNode(id);
        assertEq(nid, id);
        assertEq(ch, contentHash);
        assertEq(ph, plotHash);
    }

    function createNode() internal returns (uint256) {
        uint256 id =
            universe.createNode(TEST_CONTENT_HASH, TEST_PLOT_HASH, 0, "testlink.org", "test plot");
        return id;
    }
}
