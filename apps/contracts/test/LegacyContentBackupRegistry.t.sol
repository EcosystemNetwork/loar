// SPDX-License-Identifier: MIT
pragma solidity =0.8.30;

import {Test} from "forge-std/Test.sol";
import {LegacyContentBackupRegistry} from "../src/LegacyContentBackupRegistry.sol";
import {ContentKind} from "../src/libraries/ContentBackup.sol";

contract MockUniverseManager {
    address public backupRelayer;

    function setBackupRelayer(address _relayer) external {
        backupRelayer = _relayer;
    }
}

contract LegacyContentBackupRegistryTest is Test {
    LegacyContentBackupRegistry public registry;
    MockUniverseManager public manager;
    address public relayer = address(0xBEEF);
    address public notRelayer = address(0xDEAD);
    address public legacyUniverse = address(0x1111);

    function setUp() public {
        manager = new MockUniverseManager();
        manager.setBackupRelayer(relayer);
        registry = new LegacyContentBackupRegistry(address(manager));
    }

    function _record(address universe, bytes32 offChainId)
        internal
        pure
        returns (LegacyContentBackupRegistry.LegacyBackupRecord memory)
    {
        return LegacyContentBackupRegistry.LegacyBackupRecord({
            kind: ContentKind.MediaAttachment,
            universe: universe,
            offChainId: offChainId,
            contentHash: keccak256("pinned-bytes")
        });
    }

    function test_constructor_revertsOnZeroBackupRelayerSource() public {
        vm.expectRevert("Zero backup relayer source");
        new LegacyContentBackupRegistry(address(0));
    }

    function test_backupContent_relayerCanCommitForLegacyUniverse() public {
        LegacyContentBackupRegistry.LegacyBackupRecord memory record =
            _record(legacyUniverse, keccak256("legacy-media-1"));

        vm.prank(relayer);
        bool committed = registry.backupContent(record, "ipfs://legacy-1", "{}");

        assertTrue(committed);
        assertTrue(registry.isContentBackedUp(legacyUniverse, record.offChainId));
    }

    function test_backupContent_relayerCanCommitForStandaloneEntity() public {
        // address(0) universe = standalone entity, no universe assigned.
        LegacyContentBackupRegistry.LegacyBackupRecord memory record =
            _record(address(0), keccak256("standalone-entity-1"));

        vm.prank(relayer);
        bool committed = registry.backupContent(record, "ipfs://standalone-1", "{}");

        assertTrue(committed);
        assertTrue(registry.isContentBackedUp(address(0), record.offChainId));
    }

    function test_backupContent_revertsForNonRelayer() public {
        LegacyContentBackupRegistry.LegacyBackupRecord memory record =
            _record(legacyUniverse, keccak256("legacy-media-2"));

        vm.prank(notRelayer);
        vm.expectRevert(
            abi.encodeWithSelector(LegacyContentBackupRegistry.CallerNotBackupRelayer.selector, notRelayer)
        );
        registry.backupContent(record, "ipfs://x", "{}");
    }

    function test_backupContent_sameOffChainIdDifferentUniverses_bothSucceed() public {
        bytes32 sharedId = keccak256("collides-across-universes");
        address universeA = address(0xAAAA);
        address universeB = address(0xBBBB);

        vm.startPrank(relayer);
        bool committedA = registry.backupContent(_record(universeA, sharedId), "ipfs://a", "{}");
        bool committedB = registry.backupContent(_record(universeB, sharedId), "ipfs://b", "{}");
        vm.stopPrank();

        // The (universe, offChainId) composite key means the same offChainId
        // under two different universes doesn't collide — confirms the
        // registry can't silently conflate content from different legacy
        // universes just because their off-chain ids happen to match.
        assertTrue(committedA);
        assertTrue(committedB);
        assertTrue(registry.isContentBackedUp(universeA, sharedId));
        assertTrue(registry.isContentBackedUp(universeB, sharedId));
    }

    function test_backupContent_idempotent() public {
        LegacyContentBackupRegistry.LegacyBackupRecord memory record =
            _record(legacyUniverse, keccak256("legacy-media-3"));

        vm.startPrank(relayer);
        bool first = registry.backupContent(record, "ipfs://x", "{}");
        bool second = registry.backupContent(record, "ipfs://x-resubmit", "{}");
        vm.stopPrank();

        assertTrue(first);
        assertFalse(second);
    }

    function test_pause_blocksBackupContent() public {
        registry.pause(); // owner (this test contract) can pause

        LegacyContentBackupRegistry.LegacyBackupRecord memory record =
            _record(legacyUniverse, keccak256("legacy-media-4"));

        vm.prank(relayer);
        vm.expectRevert();
        registry.backupContent(record, "ipfs://x", "{}");
    }

    function test_pause_onlyOwner() public {
        vm.prank(notRelayer);
        vm.expectRevert();
        registry.pause();
    }

    function test_batchBackupContent_revertsAboveMaxBatchSize() public {
        uint256 tooMany = registry.MAX_BACKUP_BATCH_SIZE() + 1;
        LegacyContentBackupRegistry.LegacyBackupRecord[] memory records =
            new LegacyContentBackupRegistry.LegacyBackupRecord[](tooMany);
        string[] memory cids = new string[](tooMany);
        string[] memory metas = new string[](tooMany);
        for (uint256 i = 0; i < tooMany; i++) {
            records[i] = _record(legacyUniverse, bytes32(i));
            cids[i] = "ipfs://x";
            metas[i] = "{}";
        }

        vm.prank(relayer);
        vm.expectRevert("Batch too large");
        registry.batchBackupContent(records, cids, metas);
    }
}
