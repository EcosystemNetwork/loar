// SPDX-License-Identifier: MIT
pragma solidity =0.8.30;

import {Test} from "forge-std/Test.sol";
import {Universe} from "../src/Universe.sol";
import {IUniverse} from "../src/interfaces/IUniverse.sol";
import {IUniverseManager} from "../src/interfaces/IUniverseManager.sol";
import {NodeCreationOptions, NodeVisibilityOptions} from "../src/libraries/NodeOptions.sol";
import {ContentKind, BackupRecord} from "../src/libraries/ContentBackup.sol";

/// @notice Doubles as both the `universeManager` config field (Universe.sol
///         never calls anything on that address in the backupContent path)
///         and the `backupRelayerSource` constructor arg, which only needs
///         `backupRelayer()` — the one function Universe.sol actually calls
///         for backup-relayer auth. Deliberately not a full IUniverseManager
///         or IUniverseFactory implementation.
contract MockUniverseManager {
    address public backupRelayer;

    function setBackupRelayer(address _relayer) external {
        backupRelayer = _relayer;
    }
}

contract UniverseContentBackupTest is Test {
    Universe public universe;
    MockUniverseManager public manager;
    address public relayer = address(0xBEEF);
    address public notRelayer = address(0xDEAD);

    function setUp() public {
        manager = new MockUniverseManager();
        manager.setBackupRelayer(relayer);

        IUniverseManager.UniverseConfig memory config = IUniverseManager.UniverseConfig({
            nodeCreationOption: NodeCreationOptions.PUBLIC,
            nodeVisibilityOption: NodeVisibilityOptions.PUBLIC,
            universeAdmin: address(this),
            name: "Universe Name",
            imageURL: "Universeimage.com",
            description: "test universe",
            universeManager: address(manager)
        });
        universe = new Universe(config, address(manager));
    }

    function _record(bytes32 offChainId) internal pure returns (BackupRecord memory) {
        return BackupRecord({
            kind: ContentKind.Entity, offChainId: offChainId, contentHash: keccak256("pinned-bytes")
        });
    }

    function test_backupContent_relayerCanCommit() public {
        BackupRecord memory record = _record(keccak256("entity-1"));

        vm.prank(relayer);
        bool committed = universe.backupContent(record, "ipfs://cid-1", '{"name":"Test Entity"}');

        assertTrue(committed);
        assertTrue(universe.isContentBackedUp(record.offChainId));
    }

    function test_backupContent_emitsEvent() public {
        BackupRecord memory record = _record(keccak256("entity-2"));

        vm.expectEmit(true, true, true, true);
        emit IUniverse.ContentBackedUp(
            ContentKind.Entity, record.offChainId, relayer, record.contentHash, "ipfs://cid-2", "{}"
        );

        vm.prank(relayer);
        universe.backupContent(record, "ipfs://cid-2", "{}");
    }

    function test_backupContent_revertsForNonRelayer() public {
        BackupRecord memory record = _record(keccak256("entity-3"));

        vm.prank(notRelayer);
        vm.expectRevert(
            abi.encodeWithSelector(IUniverse.CallerNotBackupRelayer.selector, notRelayer)
        );
        universe.backupContent(record, "ipfs://cid-3", "{}");
    }

    function test_backupContent_idempotent_secondCallIsNoOpAndReturnsFalse() public {
        BackupRecord memory record = _record(keccak256("entity-4"));

        vm.prank(relayer);
        bool first = universe.backupContent(record, "ipfs://cid-4", "{}");
        assertTrue(first);

        vm.prank(relayer);
        bool second = universe.backupContent(record, "ipfs://cid-4-resubmit", "{}");
        assertFalse(second);

        // Idempotency guard is keyed only on offChainId — confirms a retry
        // never reverts, which is what makes the backfill script safe to
        // re-run without pre-checking state.
        assertTrue(universe.isContentBackedUp(record.offChainId));
    }

    function test_backupContent_revertsWhenPaused() public {
        vm.prank(address(this)); // universeAdmin
        universe.pause();

        BackupRecord memory record = _record(keccak256("entity-5"));
        vm.prank(relayer);
        vm.expectRevert();
        universe.backupContent(record, "ipfs://cid-5", "{}");
    }

    function test_batchBackupContent_commitsAllAndSkipsDuplicates() public {
        BackupRecord[] memory records = new BackupRecord[](3);
        records[0] = _record(keccak256("batch-1"));
        records[1] = _record(keccak256("batch-2"));
        records[2] = _record(keccak256("batch-1")); // duplicate within the same batch

        string[] memory cids = new string[](3);
        cids[0] = "ipfs://batch-1";
        cids[1] = "ipfs://batch-2";
        cids[2] = "ipfs://batch-1-dup";

        string[] memory metas = new string[](3);
        metas[0] = "{}";
        metas[1] = "{}";
        metas[2] = "{}";

        vm.prank(relayer);
        universe.batchBackupContent(records, cids, metas);

        assertTrue(universe.isContentBackedUp(records[0].offChainId));
        assertTrue(universe.isContentBackedUp(records[1].offChainId));
    }

    function test_batchBackupContent_revertsOnArrayLengthMismatch() public {
        BackupRecord[] memory records = new BackupRecord[](2);
        records[0] = _record(keccak256("mismatch-1"));
        records[1] = _record(keccak256("mismatch-2"));

        string[] memory cids = new string[](1);
        cids[0] = "ipfs://only-one";

        string[] memory metas = new string[](2);
        metas[0] = "{}";
        metas[1] = "{}";

        vm.prank(relayer);
        vm.expectRevert("Array length mismatch");
        universe.batchBackupContent(records, cids, metas);
    }

    function test_batchBackupContent_revertsAboveMaxBatchSize() public {
        uint256 tooMany = universe.MAX_BACKUP_BATCH_SIZE() + 1;
        BackupRecord[] memory records = new BackupRecord[](tooMany);
        string[] memory cids = new string[](tooMany);
        string[] memory metas = new string[](tooMany);
        for (uint256 i = 0; i < tooMany; i++) {
            records[i] = _record(bytes32(i));
            cids[i] = "ipfs://x";
            metas[i] = "{}";
        }

        vm.prank(relayer);
        vm.expectRevert("Batch too large");
        universe.batchBackupContent(records, cids, metas);
    }

    /// @notice Gas measurement at realistic metadata size (~500 bytes JSON,
    ///         matching a typical entity name+description+imageUrl+kind
    ///         payload) — informs the Phase 4 backfill batch-size cap. Not an
    ///         assertion beyond success; read the gas number in test output.
    function test_backupContent_gasAtRealisticMetadataSize() public {
        string memory realisticMetadata = '{"name":"Captain Elara Voss","kind":"person","description":'
            '"A weathered starship captain who abandoned the Sol Fleet after the Kessler '
            'mutiny, now running cargo through contested space with a crew of exiles.",'
            '"imageUrl":"https://gateway.pinata.cloud/ipfs/bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",'
            '"universeAddress":"0x1234567890123456789012345678901234567890",'
            '"creator":"0xabcdefabcdefabcdefabcdefabcdefabcdefabcd"}';

        BackupRecord memory record = _record(keccak256("gas-measurement-entity"));

        vm.prank(relayer);
        uint256 gasBefore = gasleft();
        universe.backupContent(
            record, "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi", realisticMetadata
        );
        uint256 gasUsed = gasBefore - gasleft();
        emit log_named_uint("gas used (realistic single record)", gasUsed);
    }

    function test_backupRelayer_rotationTakesEffectImmediately() public {
        address newRelayer = address(0xC0FFEE);
        manager.setBackupRelayer(newRelayer);

        BackupRecord memory record = _record(keccak256("post-rotation"));

        vm.prank(relayer); // old relayer, should now be rejected
        vm.expectRevert(abi.encodeWithSelector(IUniverse.CallerNotBackupRelayer.selector, relayer));
        universe.backupContent(record, "ipfs://x", "{}");

        vm.prank(newRelayer);
        bool committed = universe.backupContent(record, "ipfs://x", "{}");
        assertTrue(committed);
    }
}
