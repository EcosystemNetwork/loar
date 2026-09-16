// SPDX-License-Identifier: MIT
pragma solidity =0.8.30;

/// @notice Category of off-chain content a backup record points at.
///         Timeline scene nodes are NOT included here — they already have
///         their own on-chain home via Universe.createNode/VideoNode.
enum ContentKind {
    Entity,
    MediaAttachment
}

/// @notice A single content-backup commitment. `contentHash` is stored
///         on-chain for verification; the CID and descriptive metadata are
///         emitted in the ContentBackedUp event only (not stored), matching
///         the gas-conscious hash-in-storage/data-in-event pattern already
///         used by Universe.createNode.
struct BackupRecord {
    ContentKind kind;
    bytes32 offChainId; // keccak256 of the Firestore entity/mediaAttachment doc id
    bytes32 contentHash; // sha256 of the pinned bytes, matches StorageManifest.contentHash
}
