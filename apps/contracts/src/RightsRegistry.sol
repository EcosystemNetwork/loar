// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Initializable} from "@openzeppelin-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin-upgradeable/access/OwnableUpgradeable.sol";
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

    event RightsSet(bytes32 indexed contentHash, RightsType rightsType);
    event ContentFrozen(bytes32 indexed contentHash, string reason);
    event OperatorUpdated(address indexed operator, bool authorized);

    error NotOperator();
    error NotCreatorOrOwner();
    error AlreadyFrozen();
    error ZeroHash();

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

    /// @notice Set the rights classification for a content hash
    /// @dev On first classification (UNSET), any operator can set and becomes recorded creator.
    ///      Subsequent changes require the caller to be the recorded creator or the owner.
    ///      Cannot change a FROZEN entry — use a new content hash for revised content.
    function setRights(bytes32 contentHash, RightsType rightsType) external onlyOperator {
        if (contentHash == bytes32(0)) revert ZeroHash();
        if (rights[contentHash] == RightsType.FROZEN) revert AlreadyFrozen();

        if (rights[contentHash] == RightsType.UNSET) {
            // First classification — record the creator
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

    /// @notice Freeze a content hash — blocks all monetization permanently
    /// @dev Used for DMCA takedowns, rights disputes, or policy violations
    function freeze(bytes32 contentHash, string calldata reason) external onlyOperator {
        if (contentHash == bytes32(0)) revert ZeroHash();
        rights[contentHash] = RightsType.FROZEN;
        emit ContentFrozen(contentHash, reason);
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

    /// @dev Reserved storage gap for future upgrades
    uint256[46] private __gap;
}
