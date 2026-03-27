// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {ERC721} from "@openzeppelin/token/ERC721/ERC721.sol";
import {ERC721Enumerable} from "@openzeppelin/token/ERC721/extensions/ERC721Enumerable.sol";
import {ERC721URIStorage} from "@openzeppelin/token/ERC721/extensions/ERC721URIStorage.sol";
import {ERC2981} from "@openzeppelin/token/common/ERC2981.sol";
import {ReentrancyGuard} from "@openzeppelin/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/interfaces/IERC20.sol";

/// @title EpisodeNFT
/// @notice Mints AI-generated episodes as NFTs with ERC2981 royalties.
///         Each episode is tied to a universe node and earns royalties on resale.
contract EpisodeNFT is ERC721Enumerable, ERC721URIStorage, ERC2981, ReentrancyGuard {
    struct Episode {
        uint256 universeId;
        uint256 nodeId;
        bytes32 contentHash;
        address creator;
        uint256 mintPrice;
        uint256 maxSupply;     // 0 = unlimited
        uint256 minted;
        bool active;
    }

    uint256 public nextEpisodeId;
    uint256 public nextTokenId;

    // episodeId => Episode
    mapping(uint256 => Episode) public episodes;
    // tokenId => episodeId
    mapping(uint256 => uint256) public tokenEpisode;

    address public platform;
    uint16 public platformFeeBps;       // basis points on primary sales
    uint16 public defaultRoyaltyBps;    // secondary sale royalty

    // Universe governance token => whether it's recognized
    mapping(address => bool) public recognizedTokens;

    event EpisodeCreated(uint256 indexed episodeId, uint256 universeId, uint256 nodeId, address creator, uint256 mintPrice, uint256 maxSupply);
    event EpisodeMinted(uint256 indexed tokenId, uint256 indexed episodeId, address buyer, uint256 price);
    event EpisodeDeactivated(uint256 indexed episodeId);

    error NotCreator();
    error EpisodeNotActive();
    error MaxSupplyReached();
    error InsufficientPayment();
    error TransferFailed();

    constructor(
        address _platform,
        uint16 _platformFeeBps,
        uint16 _defaultRoyaltyBps
    ) ERC721("LOAR Episodes", "EPISODE") {
        platform = _platform;
        platformFeeBps = _platformFeeBps;
        defaultRoyaltyBps = _defaultRoyaltyBps;
    }

    /// @notice Create a new episode listing from a universe node
    function createEpisode(
        uint256 universeId,
        uint256 nodeId,
        bytes32 contentHash,
        uint256 mintPrice,
        uint256 maxSupply,
        string calldata metadataURI
    ) external returns (uint256 episodeId) {
        episodeId = nextEpisodeId++;

        episodes[episodeId] = Episode({
            universeId: universeId,
            nodeId: nodeId,
            contentHash: contentHash,
            creator: msg.sender,
            mintPrice: mintPrice,
            maxSupply: maxSupply,
            minted: 0,
            active: true
        });

        emit EpisodeCreated(episodeId, universeId, nodeId, msg.sender, mintPrice, maxSupply);
    }

    /// @notice Mint an episode NFT
    function mint(uint256 episodeId, string calldata tokenURI_) external payable nonReentrant returns (uint256 tokenId) {
        Episode storage ep = episodes[episodeId];
        if (!ep.active) revert EpisodeNotActive();
        if (ep.maxSupply > 0 && ep.minted >= ep.maxSupply) revert MaxSupplyReached();
        if (msg.value < ep.mintPrice) revert InsufficientPayment();

        tokenId = nextTokenId++;
        ep.minted++;
        tokenEpisode[tokenId] = episodeId;

        _safeMint(msg.sender, tokenId);
        _setTokenURI(tokenId, tokenURI_);
        _setTokenRoyalty(tokenId, ep.creator, defaultRoyaltyBps);

        // Split payment: platform fee + creator
        uint256 platformCut = (msg.value * platformFeeBps) / 10000;
        uint256 creatorCut = msg.value - platformCut;

        (bool s1,) = platform.call{value: platformCut}("");
        if (!s1) revert TransferFailed();
        (bool s2,) = ep.creator.call{value: creatorCut}("");
        if (!s2) revert TransferFailed();

        emit EpisodeMinted(tokenId, episodeId, msg.sender, msg.value);
    }

    /// @notice Deactivate episode listing
    function deactivateEpisode(uint256 episodeId) external {
        if (episodes[episodeId].creator != msg.sender) revert NotCreator();
        episodes[episodeId].active = false;
        emit EpisodeDeactivated(episodeId);
    }

    /// @notice Update platform fee (only platform admin)
    function setPlatformFee(uint16 newFeeBps) external {
        require(msg.sender == platform, "Not platform");
        platformFeeBps = newFeeBps;
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
