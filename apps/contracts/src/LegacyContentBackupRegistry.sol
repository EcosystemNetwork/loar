// SPDX-License-Identifier: MIT
pragma solidity =0.8.30;

import {ContentKind} from "./libraries/ContentBackup.sol";
import {IUniverseManager} from "./interfaces/IUniverseManager.sol";
import {Pausable} from "@openzeppelin/utils/Pausable.sol";
import {Ownable} from "@openzeppelin/access/Ownable.sol";

/// @title LegacyContentBackupRegistry
/// @notice Fallback on-chain backup registry for content with no native
///         Universe.sol home: universes deployed before backupContent existed
///         (frozen bytecode, no upgrade path) and standalone entities (no
///         universe assigned). Every other case uses the content's own
///         Universe contract instead — see Universe.backupContent. Not used
///         for any new content going forward, only for backfilling this gap.
contract LegacyContentBackupRegistry is Pausable, Ownable {
    error CallerNotBackupRelayer(address caller);

    /// @notice Same shape as ContentBackup.BackupRecord, plus an explicit
    ///         `universe` field since this registry isn't itself a universe
    ///         contract — address(0) means a standalone entity with no
    ///         universe assigned at all.
    struct LegacyBackupRecord {
        ContentKind kind;
        address universe;
        bytes32 offChainId;
        bytes32 contentHash;
    }

    /// @notice Mirrors Universe.ContentBackedUp, scoped by `universe`.
    event ContentBackedUp(
        ContentKind indexed kind,
        address indexed universe,
        bytes32 indexed offChainId,
        address relayer,
        bytes32 contentHash,
        string cid,
        string metadataJson
    );

    /// @notice Same relayer as every Universe contract reads — single source
    ///         of truth, rotated once via UniverseManager.setBackupRelayer.
    IUniverseManager public immutable universeManager;

    /// @notice universe => offChainId => backed up.
    mapping(address => mapping(bytes32 => bool)) public contentBackedUp;

    uint256 public constant MAX_BACKUP_BATCH_SIZE = 100;

    constructor(address _universeManager) Ownable(msg.sender) {
        require(_universeManager != address(0), "Zero manager address");
        universeManager = IUniverseManager(_universeManager);
    }

    modifier onlyBackupRelayer() {
        if (msg.sender != universeManager.backupRelayer()) {
            revert CallerNotBackupRelayer(msg.sender);
        }
        _;
    }

    /// @notice Idempotent: re-submitting an already-backed-up (universe, offChainId)
    ///         pair is a no-op that returns false, so the backfill script can
    ///         retry freely without pre-checking state.
    function backupContent(LegacyBackupRecord calldata record, string calldata cid, string calldata metadataJson)
        external
        whenNotPaused
        onlyBackupRelayer
        returns (bool)
    {
        return _backupContent(record, cid, metadataJson);
    }

    /// @notice Batch version. Skips (does not revert on) records already backed up.
    function batchBackupContent(
        LegacyBackupRecord[] calldata records,
        string[] calldata cids,
        string[] calldata metadataJsons
    ) external whenNotPaused onlyBackupRelayer {
        uint256 len = records.length;
        require(len == cids.length && len == metadataJsons.length, "Array length mismatch");
        require(len <= MAX_BACKUP_BATCH_SIZE, "Batch too large");
        for (uint256 i = 0; i < len;) {
            _backupContent(records[i], cids[i], metadataJsons[i]);
            unchecked {
                ++i;
            }
        }
    }

    function _backupContent(LegacyBackupRecord calldata record, string calldata cid, string calldata metadataJson)
        internal
        returns (bool)
    {
        if (contentBackedUp[record.universe][record.offChainId]) {
            return false;
        }
        contentBackedUp[record.universe][record.offChainId] = true;
        emit ContentBackedUp(
            record.kind, record.universe, record.offChainId, msg.sender, record.contentHash, cid, metadataJson
        );
        return true;
    }

    function isContentBackedUp(address universe, bytes32 offChainId) external view returns (bool) {
        return contentBackedUp[universe][offChainId];
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
