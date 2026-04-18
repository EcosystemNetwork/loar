// SPDX-License-Identifier: MIT
pragma solidity =0.8.30;

import {Initializable} from "@openzeppelin-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin-upgradeable/access/OwnableUpgradeable.sol";
import {ECDSA} from "@openzeppelin/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/utils/cryptography/MessageHashUtils.sol";
import {IRightsRegistry} from "./interfaces/IRightsRegistry.sol";

/// @title RightsRegistry
/// @notice Singleton rights classification gate. Tracks whether content is FUN (non-monetizable
///         fan/parody), ORIGINAL, LICENSED, PUBLIC_DOMAIN, or FROZEN (disputed/DMCA).
///
///         Revenue contracts check isMonetizable() before minting or listing content.
///         UNSET content is blocked by default (default-deny) — content must be explicitly
///         classified as ORIGINAL, LICENSED, or PUBLIC_DOMAIN before it can be monetized.
contract RightsRegistry is IRightsRegistry, Initializable, UUPSUpgradeable, OwnableUpgradeable {
    /// @notice Content hash => rights classification
    mapping(bytes32 => RightsType) public rights;

    /// @notice Content hash => original creator (set on first classification)
    mapping(bytes32 => address) public contentCreator;

    /// @notice Addresses authorized to set/freeze rights (platform operators)
    mapping(address => bool) public operators;

    /// @notice RIGHTS-02: Two-step freeze — operator requests, owner confirms
    mapping(bytes32 => address) public pendingFreeze;
    /// @notice RIGHTS-02: Reason for the pending freeze request
    mapping(bytes32 => string) public pendingFreezeReason;

    /// @notice RIGHTS-01: Per-creator nonce to prevent signature replay.
    mapping(address => uint256) public creatorNonce;

    event RightsSet(bytes32 indexed contentHash, RightsType rightsType);
    event ContentFrozen(bytes32 indexed contentHash, string reason);
    event FreezeRequested(bytes32 indexed contentHash, address indexed requestedBy, string reason);
    event FreezeCancelled(bytes32 indexed contentHash);
    event OperatorUpdated(address indexed operator, bool authorized);

    error NotOperator();
    error NotCreatorOrOwner();
    error AlreadyFrozen();
    error ZeroHash();
    error NotFrozen();
    error NoPendingFreeze();
    error InvalidSignature();
    error SignatureExpired();
    error MonetizableRequiresCreatorSig();

    modifier onlyOperator() {
        _checkOperator();
        _;
    }

    function _checkOperator() internal view {
        if (!operators[msg.sender] && msg.sender != owner()) revert NotOperator();
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function initialize(address _platform) external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        operators[_platform] = true;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    /// @notice Set the rights classification for a content hash.
    /// @dev RIGHTS-01 (hardening): Only the owner may classify content as
    ///      ORIGINAL/LICENSED/PUBLIC_DOMAIN via this path. A plain operator (platform backend key)
    ///      can only set non-monetizable classifications (UNSET/FUN). For creator-authenticated
    ///      monetizable classification, use `setRightsWithCreatorSig`, which carries the creator's
    ///      signature and binds `contentCreator = creator` (not the operator). This prevents a
    ///      compromised operator from pre-claiming an unset hash as ORIGINAL + locking
    ///      `contentCreator = msg.sender` and then flipping classifications without signature.
    function setRights(bytes32 contentHash, RightsType rightsType) external onlyOperator {
        if (contentHash == bytes32(0)) revert ZeroHash();
        if (rights[contentHash] == RightsType.FROZEN) revert AlreadyFrozen();

        bool isMonetizableType = rightsType == RightsType.ORIGINAL
            || rightsType == RightsType.LICENSED
            || rightsType == RightsType.PUBLIC_DOMAIN;
        if (isMonetizableType && msg.sender != owner()) {
            revert MonetizableRequiresCreatorSig();
        }

        if (rights[contentHash] == RightsType.UNSET) {
            // First classification — record the caller as creator for downgrade paths.
            contentCreator[contentHash] = msg.sender;
        } else {
            // Subsequent change — only creator or owner
            if (msg.sender != contentCreator[contentHash] && msg.sender != owner()) {
                revert NotCreatorOrOwner();
            }
        }

        rights[contentHash] = rightsType;
        emit RightsSet(contentHash, rightsType);
    }

    /// @notice RIGHTS-02: Request a freeze — operator initiates, owner must confirm.
    ///         Prevents any single operator from unilaterally killing content monetization.
    function requestFreeze(bytes32 contentHash, string calldata reason) external onlyOperator {
        if (contentHash == bytes32(0)) revert ZeroHash();
        if (rights[contentHash] == RightsType.FROZEN) revert AlreadyFrozen();
        pendingFreeze[contentHash] = msg.sender;
        pendingFreezeReason[contentHash] = reason;
        emit FreezeRequested(contentHash, msg.sender, reason);
    }

    /// @notice RIGHTS-02: Confirm a pending freeze — owner only.
    function confirmFreeze(bytes32 contentHash) external onlyOwner {
        if (pendingFreeze[contentHash] == address(0)) revert NoPendingFreeze();
        string memory reason = pendingFreezeReason[contentHash];
        rights[contentHash] = RightsType.FROZEN;
        delete pendingFreeze[contentHash];
        delete pendingFreezeReason[contentHash];
        emit ContentFrozen(contentHash, reason);
    }

    /// @notice RIGHTS-02: Emergency freeze — owner bypasses two-step for genuine DMCA emergencies.
    function emergencyFreeze(bytes32 contentHash, string calldata reason) external onlyOwner {
        if (contentHash == bytes32(0)) revert ZeroHash();
        // Clear any pending freeze for this hash
        if (pendingFreeze[contentHash] != address(0)) {
            delete pendingFreeze[contentHash];
            delete pendingFreezeReason[contentHash];
        }
        rights[contentHash] = RightsType.FROZEN;
        emit ContentFrozen(contentHash, reason);
    }

    /// @notice Unfreeze a content hash — restores it to UNSET for re-classification.
    /// @dev RIGHTS-02: Provides an appeal path (FROZEN → UNSET) rather than permanent freeze.
    ///      Only owner can unfreeze.
    function unfreeze(bytes32 contentHash) external onlyOwner {
        if (rights[contentHash] != RightsType.FROZEN) revert NotFrozen();
        rights[contentHash] = RightsType.UNSET;
        emit RightsSet(contentHash, RightsType.UNSET);
    }

    /// @notice Returns true if the content hash is allowed to be monetized.
    ///         Default-deny: only ORIGINAL, LICENSED, and PUBLIC_DOMAIN are monetizable.
    ///         UNSET, FUN, and FROZEN are all blocked.
    function isMonetizable(bytes32 contentHash) external view returns (bool) {
        RightsType r = rights[contentHash];
        return r == RightsType.ORIGINAL || r == RightsType.LICENSED || r == RightsType.PUBLIC_DOMAIN;
    }

    function setOperator(address operator, bool authorized) external onlyOwner {
        operators[operator] = authorized;
        emit OperatorUpdated(operator, authorized);
    }

    /// @notice RIGHTS-01: Operator-initiated classification transition that requires
    ///         the actual content creator's signature. Prevents a compromised operator
    ///         from flipping classifications without creator consent (e.g. ORIGINAL→FUN
    ///         to block monetization, or FUN→ORIGINAL to wash a classification).
    /// @param contentHash    The content hash being classified.
    /// @param rightsType     The new classification.
    /// @param creator        The true content creator signing this transition.
    /// @param deadline       Signature expiry (unix seconds).
    /// @param signature      Creator's ECDSA signature over the digest below.
    ///
    /// Digest format (EIP-191 personal_sign):
    ///   keccak256(abi.encodePacked(
    ///     "LOAR-RIGHTS-V1", address(this), block.chainid,
    ///     contentHash, uint8(rightsType), creatorNonce[creator], deadline
    ///   ))
    function setRightsWithCreatorSig(
        bytes32 contentHash,
        RightsType rightsType,
        address creator,
        uint256 deadline,
        bytes calldata signature
    ) external onlyOperator {
        if (contentHash == bytes32(0)) revert ZeroHash();
        if (rights[contentHash] == RightsType.FROZEN) revert AlreadyFrozen();
        if (block.timestamp > deadline) revert SignatureExpired();

        bytes32 raw = keccak256(abi.encodePacked(
            "LOAR-RIGHTS-V1",
            address(this),
            block.chainid,
            contentHash,
            uint8(rightsType),
            creatorNonce[creator],
            deadline
        ));
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(raw);
        address recovered = ECDSA.recover(digest, signature);
        if (recovered != creator || recovered == address(0)) revert InvalidSignature();

        // Consume the nonce so this signature cannot be replayed.
        unchecked { creatorNonce[creator]++; }

        // Creator signature binds the content to this creator even on first classification.
        contentCreator[contentHash] = creator;
        rights[contentHash] = rightsType;
        emit RightsSet(contentHash, rightsType);
    }

    /// @dev Reserved storage gap — reduced by 1 slot for `creatorNonce` mapping.
    uint256[43] private __gap;
}
