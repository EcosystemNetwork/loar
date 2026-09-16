// SPDX-License-Identifier: MIT
pragma solidity =0.8.30;

import {NodeCreationOptions, NodeVisibilityOptions} from "../libraries/NodeOptions.sol";
import {ContentKind, BackupRecord} from "../libraries/ContentBackup.sol";

interface IUniverse {
    error NodeDoesNotExist();
    error TokenDoesNotExist();
    error CanonNotSet();
    error CallerNotManager();
    error CallerNotAdmin(address caller);
    error CallerNotBackupRelayer(address caller);

    event NodeCanonized(uint256 id, address canonizer); // deprecated — use CanonChanged
    event CanonChanged(
        uint256 indexed newCanonId, uint256 indexed previousCanonId, address canonizer
    );
    /// @notice Emitted when an off-chain episode is promoted to canon. `episodeHash` is
    ///         keccak256 of the episode's off-chain id (UUID); `tipNodeId` is the canon
    ///         tip after promotion (same semantics as CanonChanged.newCanonId).
    event EpisodeCanonized(
        bytes32 indexed episodeHash, uint256 indexed tipNodeId, address canonizer
    );
    event NodeCreated(
        uint256 indexed id,
        uint256 indexed previous,
        address indexed creator,
        bytes32 contentHash,
        bytes32 plotHash,
        string link,
        string plot
    );
    event NodeVisibilityOptionUpdated(NodeVisibilityOptions option);
    event NodeCreationOptionUpdated(NodeCreationOptions option);
    event MediaUpdated(uint256 indexed nodeId, address updater, bytes32 contentHash, string link);
    event MediaUpdatedAttribution(
        uint256 indexed nodeId,
        address indexed updater,
        address indexed originalCreator,
        bytes32 contentHash
    );
    event NodesSwapped(uint256 indexed nodeA, uint256 indexed nodeB, address swapper);
    event WhitelistedUpdated(address indexed user, bool status);
    event VaultWhitelistUpdated(address indexed user, bool status);
    event TokenUpdated(address indexed token);
    event AdminUpdated(address indexed newAdmin);
    /// @notice Off-chain content backup commitment. `relayer` is the platform
    ///         backup relayer that submitted it, not the content's original
    ///         author — see Universe.backupContent.
    event ContentBackedUp(
        ContentKind indexed kind,
        bytes32 indexed offChainId,
        address indexed relayer,
        bytes32 contentHash,
        string cid,
        string metadataJson
    );

    function setAdmin(address newAdmin) external;
    function setToken(address) external;
    function getAdmin() external view returns (address);
    function getToken() external view returns (address);
    function setVaultWhitelisted(address user, bool status) external;
    function getVaultWhitelisted(address user) external view returns (bool);
    function batchSetWhitelisted(address[] calldata users, bool status) external;
    function batchSetVaultWhitelisted(address[] calldata users, bool status) external;
    function pause() external;
    function unpause() external;

    /// @notice Commit an off-chain-content backup record. Callable only by the
    ///         platform backup relayer (see UniverseManager.backupRelayer).
    ///         Idempotent: re-submitting an already-backed-up offChainId is a
    ///         no-op that returns false, so callers can retry safely.
    function backupContent(BackupRecord calldata record, string calldata cid, string calldata metadataJson)
        external
        returns (bool);
    /// @notice Batch version of backupContent. Skips (does not revert on)
    ///         records already backed up.
    function batchBackupContent(
        BackupRecord[] calldata records,
        string[] calldata cids,
        string[] calldata metadataJsons
    ) external;
    function isContentBackedUp(bytes32 offChainId) external view returns (bool);

    // Metadata accessors (used by UniverseManager for on-chain tokenURI)
    function universeName() external view returns (string memory);
    function universeDescription() external view returns (string memory);
    function universeImageUrl() external view returns (string memory);
}
