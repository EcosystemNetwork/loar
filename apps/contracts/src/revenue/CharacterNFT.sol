// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {ERC721} from "@openzeppelin/token/ERC721/ERC721.sol";
import {ERC721Enumerable} from "@openzeppelin/token/ERC721/extensions/ERC721Enumerable.sol";
import {ERC721URIStorage} from "@openzeppelin/token/ERC721/extensions/ERC721URIStorage.sol";
import {ERC2981} from "@openzeppelin/token/common/ERC2981.sol";
import {ReentrancyGuard} from "@openzeppelin/utils/ReentrancyGuard.sol";

/// @title CharacterNFT
/// @notice Characters as ownable NFTs. Owners earn when their character appears in episodes.
///         Supports appearance tracking and royalty accumulation.
contract CharacterNFT is ERC721Enumerable, ERC721URIStorage, ERC2981, ReentrancyGuard {
    struct Character {
        uint256 universeId;
        string name;
        bytes32 visualHash;        // hash of character visual description/image
        address creator;
        uint256 appearanceCount;
        uint256 accumulatedRoyalties;
    }

    uint256 public nextCharacterId;

    mapping(uint256 => Character) public characters;
    // universeId => characterName hash => characterId (prevent duplicates)
    mapping(uint256 => mapping(bytes32 => uint256)) public characterByName;

    address public platform;
    uint16 public appearanceFeeBps;    // fee taken from episode mint when character appears

    // Accumulated ETH for character owners to claim
    mapping(uint256 => uint256) public claimable;

    event CharacterCreated(uint256 indexed characterId, uint256 universeId, string name, address creator);
    event CharacterAppearance(uint256 indexed characterId, uint256 indexed episodeId, uint256 reward);
    event RoyaltyClaimed(uint256 indexed characterId, address owner, uint256 amount);

    error NotOwner();
    error CharacterExists();
    error NothingToClaim();
    error TransferFailed();

    constructor(
        address _platform,
        uint16 _appearanceFeeBps
    ) ERC721("LOAR Characters", "CHARACTER") {
        platform = _platform;
        appearanceFeeBps = _appearanceFeeBps;
    }

    /// @notice Mint a new character NFT
    function createCharacter(
        uint256 universeId,
        string calldata name,
        bytes32 visualHash,
        string calldata metadataURI
    ) external returns (uint256 characterId) {
        bytes32 nameHash = keccak256(abi.encodePacked(name));
        if (characterByName[universeId][nameHash] != 0) revert CharacterExists();

        characterId = ++nextCharacterId;
        characterByName[universeId][nameHash] = characterId;

        characters[characterId] = Character({
            universeId: universeId,
            name: name,
            visualHash: visualHash,
            creator: msg.sender,
            appearanceCount: 0,
            accumulatedRoyalties: 0
        });

        _safeMint(msg.sender, characterId);
        _setTokenURI(characterId, metadataURI);
        _setTokenRoyalty(characterId, msg.sender, 500); // 5% secondary royalty

        emit CharacterCreated(characterId, universeId, name, msg.sender);
    }

    /// @notice Record a character appearance in an episode and distribute reward
    /// @dev Called by the platform when an episode featuring this character is minted
    function recordAppearance(uint256 characterId, uint256 episodeId) external payable {
        require(msg.sender == platform, "Only platform");
        Character storage c = characters[characterId];
        c.appearanceCount++;
        c.accumulatedRoyalties += msg.value;
        claimable[characterId] += msg.value;

        emit CharacterAppearance(characterId, episodeId, msg.value);
    }

    /// @notice Character owner claims accumulated appearance royalties
    function claimRoyalties(uint256 characterId) external nonReentrant {
        if (ownerOf(characterId) != msg.sender) revert NotOwner();
        uint256 amount = claimable[characterId];
        if (amount == 0) revert NothingToClaim();

        claimable[characterId] = 0;
        (bool success,) = msg.sender.call{value: amount}("");
        if (!success) revert TransferFailed();

        emit RoyaltyClaimed(characterId, msg.sender, amount);
    }

    /// @notice Get all characters in a universe
    function getCharactersByUniverse(uint256 universeId, uint256 startId, uint256 count)
        external view returns (uint256[] memory ids)
    {
        uint256[] memory temp = new uint256[](count);
        uint256 found = 0;
        for (uint256 i = startId; i <= nextCharacterId && found < count; i++) {
            if (characters[i].universeId == universeId) {
                temp[found++] = i;
            }
        }
        ids = new uint256[](found);
        for (uint256 j = 0; j < found; j++) {
            ids[j] = temp[j];
        }
    }

    // ---- Overrides ----

    function tokenURI(uint256 tokenId) public view override(ERC721, ERC721URIStorage) returns (string memory) {
        return super.tokenURI(tokenId);
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721Enumerable, ERC721URIStorage, ERC2981) returns (bool) {
        return super.supportsInterface(interfaceId);
    }

    function _update(address to, uint256 tokenId, address auth) internal override(ERC721, ERC721Enumerable) returns (address) {
        return super._update(to, tokenId, auth);
    }

    function _increaseBalance(address account, uint128 value) internal override(ERC721, ERC721Enumerable) {
        super._increaseBalance(account, value);
    }
}
