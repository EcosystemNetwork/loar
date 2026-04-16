// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC721} from "@openzeppelin/token/ERC721/ERC721.sol";
import {ERC721Enumerable} from "@openzeppelin/token/ERC721/extensions/ERC721Enumerable.sol";
import {ERC721URIStorage} from "@openzeppelin/token/ERC721/extensions/ERC721URIStorage.sol";
import {ERC2981} from "@openzeppelin/token/common/ERC2981.sol";
import {Initializable} from "@openzeppelin-upgradeable/proxy/utils/Initializable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {IRightsRegistry} from "../interfaces/IRightsRegistry.sol";
import {IPaymentRouter} from "../interfaces/IPaymentRouter.sol";

/// @title EpisodeNFT
/// @notice Mints AI-generated episodes as NFTs with ERC2981 royalties.
///         Each episode is tied to a universe node and earns royalties on resale.
contract EpisodeNFT is Initializable, ERC721Enumerable, ERC721URIStorage, ERC2981, ReentrancyGuardUpgradeable {
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
    IRightsRegistry public rightsRegistry;
    IPaymentRouter public paymentRouter;
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
    error FeeTooHigh();
    error ContentNotMonetizable();

    uint16 public constant MAX_FEE_BPS = 5000;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() ERC721("LOAR Episodes", "EPISODE") { _disableInitializers(); }

    function initialize(
        address _platform,
        address _rightsRegistry,
        address _paymentRouter,
        uint16 _platformFeeBps,
        uint16 _defaultRoyaltyBps
    ) external initializer {
        __ReentrancyGuard_init();
        if (_platformFeeBps > MAX_FEE_BPS) revert FeeTooHigh();
        platform = _platform;
        rightsRegistry = IRightsRegistry(_rightsRegistry);
        paymentRouter = IPaymentRouter(_paymentRouter);
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
        string calldata /* metadataURI */
    ) external returns (uint256 episodeId) {
        if (!rightsRegistry.isMonetizable(contentHash)) revert ContentNotMonetizable();
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

        // Route exact mint price through PaymentRouter; refund excess
        if (ep.mintPrice > 0) {
            paymentRouter.route{value: ep.mintPrice}(ep.creator, platformFeeBps);
        }
        uint256 excess = msg.value - ep.mintPrice;
        if (excess > 0) {
            (bool refunded,) = msg.sender.call{value: excess}("");
            if (!refunded) revert TransferFailed();
        }

        emit EpisodeMinted(tokenId, episodeId, msg.sender, ep.mintPrice);
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
        if (newFeeBps > MAX_FEE_BPS) revert FeeTooHigh();
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
