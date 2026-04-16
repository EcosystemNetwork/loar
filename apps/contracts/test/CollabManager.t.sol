// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/proxy/ERC1967/ERC1967Proxy.sol";
import {CollabManager} from "../src/revenue/CollabManager.sol";
import {MockPaymentRouter} from "./mocks/MockPaymentRouter.sol";
import {MockUniverseManager} from "./mocks/MockUniverseManager.sol";

contract CollabManagerTest is Test {
    CollabManager public cm;
    MockPaymentRouter public router;
    MockUniverseManager public universeManager;

    address platform = makeAddr("platform");
    address treasury = makeAddr("treasury");
    address proposer = makeAddr("proposer");
    address acceptor = makeAddr("acceptor");
    address alice = makeAddr("alice");

    uint256 constant UNIVERSE_A = 1;
    uint256 constant UNIVERSE_B = 2;
    uint16 constant FEE_BPS = 500;
    uint256 constant REVENUE_SHARE_BPS = 6000; // 60% to A
    uint256 constant DURATION = 30 days;

    function setUp() public {
        vm.deal(treasury, 0);
        vm.deal(platform, 100 ether);

        router = new MockPaymentRouter(treasury);
        universeManager = new MockUniverseManager();

        CollabManager impl = new CollabManager();
        cm = CollabManager(
            address(
                new ERC1967Proxy(
                    address(impl),
                    abi.encodeCall(
                        CollabManager.initialize,
                        (platform, address(router), address(universeManager), FEE_BPS)
                    )
                )
            )
        );
    }

    // ---- helpers ----

    /// @dev Reads collab struct via the auto-generated getter and returns individual fields.
    function _getCollab(uint256 collabId)
        internal
        view
        returns (
            uint256 id,
            uint256 universeA,
            uint256 universeB,
            address prop,
            address acc,
            CollabManager.CollabStatus status,
            uint256 revenueShareBps,
            uint256 totalRevenue,
            uint256 startTime,
            uint256 endTime,
            string memory metadataURI,
            uint256 episodeCount
        )
    {
        (id, universeA, universeB, prop, acc, status, revenueShareBps,
         totalRevenue, startTime, endTime, metadataURI, episodeCount) = cm.collabs(collabId);
    }

    function _proposeCollab() internal returns (uint256 collabId) {
        vm.prank(proposer);
        collabId = cm.proposeCollab(
            UNIVERSE_A, UNIVERSE_B, REVENUE_SHARE_BPS, DURATION, "ipfs://collab", acceptor
        );
    }

    function _proposeAndAccept() internal returns (uint256 collabId) {
        collabId = _proposeCollab();
        vm.prank(acceptor);
        cm.acceptCollab(collabId);
    }

    function _proposeAcceptAndActivate() internal returns (uint256 collabId) {
        collabId = _proposeAndAccept();
        vm.prank(proposer);
        cm.activateCollab(collabId);
    }

    // ---- initialize ----

    function test_initialize() public view {
        assertEq(cm.platform(), platform);
        assertEq(address(cm.paymentRouter()), address(router));
        assertEq(address(cm.universeManager()), address(universeManager));
        assertEq(cm.platformFeeBps(), FEE_BPS);
    }

    // ---- proposeCollab ----

    function test_proposeCollab() public {
        uint256 collabId = _proposeCollab();

        (
            uint256 id,
            uint256 universeA,
            uint256 universeB,
            address prop,
            address acc,
            CollabManager.CollabStatus status,
            uint256 revShareBps,
            ,,,, uint256 episodeCount
        ) = _getCollab(collabId);

        assertEq(id, collabId);
        assertEq(universeA, UNIVERSE_A);
        assertEq(universeB, UNIVERSE_B);
        assertEq(prop, proposer);
        assertEq(acc, acceptor);
        assertEq(uint8(status), uint8(CollabManager.CollabStatus.PROPOSED));
        assertEq(revShareBps, REVENUE_SHARE_BPS);
        assertEq(episodeCount, 0);
    }

    // ---- acceptCollab ----

    function test_acceptCollab() public {
        uint256 collabId = _proposeCollab();

        vm.prank(acceptor);
        cm.acceptCollab(collabId);

        (,,,,, CollabManager.CollabStatus status,,,,,,) = _getCollab(collabId);
        assertEq(uint8(status), uint8(CollabManager.CollabStatus.ACCEPTED));
    }

    function test_acceptCollab_revert_notAcceptor() public {
        uint256 collabId = _proposeCollab();

        vm.prank(alice);
        vm.expectRevert(CollabManager.NotAcceptor.selector);
        cm.acceptCollab(collabId);
    }

    // ---- activateCollab ----

    function test_activateCollab() public {
        uint256 collabId = _proposeAcceptAndActivate();

        (,,,,, CollabManager.CollabStatus status,,,
         uint256 startTime, uint256 endTime,,) = _getCollab(collabId);

        assertEq(uint8(status), uint8(CollabManager.CollabStatus.ACTIVE));
        assertEq(startTime, block.timestamp);
        assertEq(endTime, block.timestamp + DURATION);
    }

    // ---- recordCollabRevenue ----

    function test_recordCollabRevenue() public {
        uint256 collabId = _proposeAcceptAndActivate();

        uint256 revenue = 1 ether;

        vm.prank(platform);
        cm.recordCollabRevenue{value: revenue}(collabId);

        (,,,,,,, uint256 totalRevenue,,,, uint256 episodeCount) = _getCollab(collabId);
        assertEq(totalRevenue, revenue);
        assertEq(episodeCount, 1);

        // Verify revenue split:
        // platformCut = 1 ether * 500 / 10000 = 0.05 ether
        // distributable = 0.95 ether
        // shareA = 0.95 ether * 6000 / 10000 = 0.57 ether
        // shareB = 0.95 ether - 0.57 ether = 0.38 ether
        uint256 platformCut = (revenue * FEE_BPS) / 10000;
        uint256 distributable = revenue - platformCut;
        uint256 expectedA = (distributable * REVENUE_SHARE_BPS) / 10000;
        uint256 expectedB = distributable - expectedA;

        assertEq(router._claimable(proposer), expectedA);
        assertEq(router._claimable(acceptor), expectedB);
        assertEq(treasury.balance, platformCut);
    }

    // ---- completeCollab ----

    function test_completeCollab() public {
        uint256 collabId = _proposeAcceptAndActivate();

        // Warp past endTime
        vm.warp(block.timestamp + DURATION + 1);

        cm.completeCollab(collabId);

        (,,,,, CollabManager.CollabStatus status,,,,,,) = _getCollab(collabId);
        assertEq(uint8(status), uint8(CollabManager.CollabStatus.COMPLETED));
    }

    // ---- cancelCollab ----

    function test_cancelCollab() public {
        uint256 collabId = _proposeCollab();

        vm.prank(proposer);
        cm.cancelCollab(collabId);

        (,,,,, CollabManager.CollabStatus status,,,,,,) = _getCollab(collabId);
        assertEq(uint8(status), uint8(CollabManager.CollabStatus.CANCELLED));
    }
}
