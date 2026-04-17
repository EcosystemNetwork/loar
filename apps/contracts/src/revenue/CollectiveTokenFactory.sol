// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC20} from "@openzeppelin/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/token/ERC20/extensions/ERC20Permit.sol";
import {Ownable} from "@openzeppelin/access/Ownable.sol";

/// @notice ERC-20 token for a single faction or organization.
///         Full supply minted to creator on deploy — creator distributes as they see fit
///         (treasury, members, liquidity, etc.).
contract CollectiveERC20 is ERC20, ERC20Permit, Ownable {
    enum CollectiveKind { FACTION, ORGANIZATION }

    uint256 public immutable universeId;
    CollectiveKind public immutable kind;
    address public immutable creator;
    string public metadataURI;

    constructor(
        uint256 _universeId,
        CollectiveKind _kind,
        string memory _name,
        string memory _symbol,
        uint256 _supply,
        address _creator,
        string memory _metadataURI
    ) ERC20(_name, _symbol) ERC20Permit(_name) Ownable(_creator) {
        universeId = _universeId;
        kind = _kind;
        creator = _creator;
        metadataURI = _metadataURI;
        _mint(_creator, _supply);
    }
}

/// @title CollectiveTokenFactory
/// @notice Deploys ERC-20 tokens for factions and organizations.
///         Each collective gets 1 billion tokens (same pattern as GovernanceERC20)
///         minted entirely to the creator for self-managed distribution.
///         These tokens represent membership/ownership shares in a narrative collective.
/// @dev Minimal interface to look up universe owner for access control (L2 fix)
interface IUniverseManagerOwner {
    function ownerOf(uint256 tokenId) external view returns (address);
}

contract CollectiveTokenFactory {
    enum CollectiveKind { FACTION, ORGANIZATION }

    struct Collective {
        address token;
        uint256 universeId;
        CollectiveKind kind;
        string name;
        address creator;
    }

    /// @notice 1 billion tokens per collective — same as universe governance tokens
    uint256 public constant DEFAULT_SUPPLY = 1_000_000_000e18;

    /// @notice UniverseManager contract for access control (L2 fix)
    address public immutable universeManager;

    uint256 public nextCollectiveId;
    mapping(uint256 => Collective) public collectives;

    // universeId => collectiveIds
    mapping(uint256 => uint256[]) public universeCollectives;

    // token address => collectiveId (reverse lookup)
    mapping(address => uint256) public collectiveByToken;

    error NotUniverseCreatorOrManager();

    constructor(address _universeManager) {
        require(_universeManager != address(0), "Zero address");
        universeManager = _universeManager;
    }

    event CollectiveDeployed(
        uint256 indexed collectiveId,
        uint256 indexed universeId,
        CollectiveKind kind,
        string name,
        address token,
        address creator
    );

    /// @notice Deploy a faction or organization ERC-20 token
    /// @param universeId   Universe this collective belongs to
    /// @param kind         FACTION or ORGANIZATION
    /// @param name         Full collective name (also ERC20 name)
    /// @param symbol       ERC20 ticker symbol (e.g. "LORE", "GUILD")
    /// @param metadataURI  IPFS/Walrus URI for collective metadata
    function deployCollective(
        uint256 universeId,
        CollectiveKind kind,
        string calldata name,
        string calldata symbol,
        string calldata metadataURI
    ) external returns (uint256 collectiveId, address token) {
        collectiveId = nextCollectiveId++;

        CollectiveERC20 t = new CollectiveERC20(
            universeId,
            CollectiveERC20.CollectiveKind(uint8(kind)),
            name,
            symbol,
            DEFAULT_SUPPLY,
            msg.sender,
            metadataURI
        );
        token = address(t);

        collectives[collectiveId] = Collective({
            token: token,
            universeId: universeId,
            kind: kind,
            name: name,
            creator: msg.sender
        });

        universeCollectives[universeId].push(collectiveId);
        collectiveByToken[token] = collectiveId;

        emit CollectiveDeployed(collectiveId, universeId, kind, name, token, msg.sender);
    }

    function getUniverseCollectives(uint256 universeId) external view returns (uint256[] memory) {
        return universeCollectives[universeId];
    }
}
