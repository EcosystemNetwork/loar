// SPDX-License-Identifier: UNLICENSED
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
///         UNSET content is allowed by default — the platform freezes or tags FUN reactively.
contract RightsRegistry is IRightsRegistry, Initializable, UUPSUpgradeable, OwnableUpgradeable {
    /// @notice Content hash => rights classification
    mapping(bytes32 => RightsType) public rights;

    /// @notice Addresses authorized to set/freeze rights (platform operators)
    mapping(address => bool) public operators;

    event RightsSet(bytes32 indexed contentHash, RightsType rightsType);
    event ContentFrozen(bytes32 indexed contentHash, string reason);
    event OperatorUpdated(address indexed operator, bool authorized);

    error NotOperator();
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
    /// @dev Cannot change a FROZEN entry — use a new content hash for revised content
    function setRights(bytes32 contentHash, RightsType rightsType) external onlyOperator {
        if (contentHash == bytes32(0)) revert ZeroHash();
        if (rights[contentHash] == RightsType.FROZEN) revert AlreadyFrozen();
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
    ///         UNSET is permitted (default-allow); FUN and FROZEN are blocked.
    function isMonetizable(bytes32 contentHash) external view returns (bool) {
        RightsType r = rights[contentHash];
        return r != RightsType.FUN && r != RightsType.FROZEN;
    }

    function setOperator(address operator, bool authorized) external onlyOwner {
        operators[operator] = authorized;
        emit OperatorUpdated(operator, authorized);
    }

    /// @dev Reserved storage gap for future upgrades
    uint256[47] private __gap;
}
