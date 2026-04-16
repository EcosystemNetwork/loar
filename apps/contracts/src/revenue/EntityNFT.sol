// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC721} from "@openzeppelin/token/ERC721/ERC721.sol";
import {ERC721Enumerable} from "@openzeppelin/token/ERC721/extensions/ERC721Enumerable.sol";
import {ERC721URIStorage} from "@openzeppelin/token/ERC721/extensions/ERC721URIStorage.sol";
import {ERC2981} from "@openzeppelin/token/common/ERC2981.sol";
import {Initializable} from "@openzeppelin-upgradeable/proxy/utils/Initializable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin-upgradeable/utils/PausableUpgradeable.sol";
import {Context} from "@openzeppelin/utils/Context.sol";
import {ContextUpgradeable} from "@openzeppelin-upgradeable/utils/ContextUpgradeable.sol";
import {IPaymentRouter} from "../interfaces/IPaymentRouter.sol";
import {IRightsRegistry} from "../interfaces/IRightsRegistry.sol";

/// @title EntityNFT
/// @notice ERC-721 for unique world-building entities: places, events, vehicles.
///         Each mint is a 1-of-1 token. Owners earn royalties on secondary sales.
///         Free to mint (mintPrice=0) or paid — payment routed through PaymentRouter.
contract EntityNFT is Initializable, ERC721Enumerable, ERC721URIStorage, ERC2981, ReentrancyGuardUpgradeable, PausableUpgradeable {
    enum EntityKind { PLACE, EVENT, VEHICLE }

    struct Entity {
        uint256 universeId;
        EntityKind kind;
        string name;
        bytes32 contentHash;
        address creator;
        uint256 mintPrice;
    }

    /// @notice The universe this collection belongs to
    uint256 public universeId;

    uint256 public nextTokenId;

    mapping(uint256 => Entity) public entities;

    // universeId => kind => nameHash => tokenId (duplicate guard, starts at 1)
    mapping(uint256 => mapping(uint8 => mapping(bytes32 => uint256))) public entityByName;

    address public platform;
    IPaymentRouter public paymentRouter;
    IRightsRegistry public rightsRegistry;
    uint16 public platformFeeBps;
    uint16 public royaltyBps;

    event EntityMinted(
        uint256 indexed tokenId,
        uint256 indexed universeId,
        EntityKind kind,
        string name,
        address creator,
        bytes32 contentHash
    );

    error EntityExists();
    error InsufficientPayment();
    error NotPlatform();
    error FeeTooHigh();
    error ContentNotMonetizable();
    error WrongUniverse();

    uint16 public constant MAX_FEE_BPS = 5000;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() ERC721("LOAR Entities", "ENTITY") { _disableInitializers(); }

    function initialize(
        uint256 _universeId,
        address _platform,
        address _paymentRouter,
        address _rightsRegistry,
        uint16 _platformFeeBps,
        uint16 _royaltyBps
    ) external initializer {
        __ReentrancyGuard_init();
        __Pausable_init();
        if (_platformFeeBps > MAX_FEE_BPS) revert FeeTooHigh();
        universeId = _universeId;
        platform = _platform;
        paymentRouter = IPaymentRouter(_paymentRouter);
        rightsRegistry = IRightsRegistry(_rightsRegistry);
        platformFeeBps = _platformFeeBps;
        royaltyBps = _royaltyBps;
    }

    function pause() external { if (msg.sender != platform) revert NotPlatform(); _pause(); }
    function unpause() external { if (msg.sender != platform) revert NotPlatform(); _unpause(); }

    /// @notice Mint a unique entity NFT (place, event, or vehicle)
    /// @param _universeId Universe this entity belongs to
    /// @param kind        EntityKind enum value
    /// @param name        Unique name within universe+kind
    /// @param contentHash SHA-256 of full entity content (stored off-chain)
    /// @param mintPrice   ETH price caller must send (0 = free)
    /// @param metadataURI IPFS/Walrus URI for NFT metadata
    function mint(
        uint256 _universeId,
        EntityKind kind,
        string calldata name,
        bytes32 contentHash,
        uint256 mintPrice,
        string calldata metadataURI
    ) external payable nonReentrant whenNotPaused returns (uint256 tokenId) {
        if (_universeId != universeId) revert WrongUniverse();
        if (!rightsRegistry.isMonetizable(contentHash)) revert ContentNotMonetizable();
        if (msg.value < mintPrice) revert InsufficientPayment();

        bytes32 nameHash = keccak256(abi.encodePacked(name));
        if (entityByName[universeId][uint8(kind)][nameHash] != 0) revert EntityExists();

        tokenId = ++nextTokenId;
        entityByName[universeId][uint8(kind)][nameHash] = tokenId;

        entities[tokenId] = Entity({
            universeId: universeId,
            kind: kind,
            name: name,
            contentHash: contentHash,
            creator: msg.sender,
            mintPrice: mintPrice
        });

        _safeMint(msg.sender, tokenId);
        _setTokenURI(tokenId, metadataURI);
        _setTokenRoyalty(tokenId, msg.sender, royaltyBps);

        // Route exact mint price; refund excess
        if (mintPrice > 0) {
            paymentRouter.route{value: mintPrice}(msg.sender, platformFeeBps);
        }
        uint256 excess = msg.value - mintPrice;
        if (excess > 0) {
            (bool refunded,) = msg.sender.call{value: excess}("");
            if (!refunded) revert InsufficientPayment(); // reuse error for refund fail
        }

        emit EntityMinted(tokenId, universeId, kind, name, msg.sender, contentHash);
    }

    /// @notice Get entities in a universe filtered by kind (paginated)
    function getByUniverse(uint256 _universeId, EntityKind kind, uint256 startId, uint256 count)
        external view returns (uint256[] memory ids)
    {
        uint256[] memory temp = new uint256[](count);
        uint256 found = 0;
        for (uint256 i = startId; i <= nextTokenId && found < count; i++) {
            if (entities[i].universeId == _universeId && entities[i].kind == kind) {
                temp[found++] = i;
            }
        }
        ids = new uint256[](found);
        for (uint256 j = 0; j < found; j++) ids[j] = temp[j];
    }

    function setPlatformFee(uint16 newFeeBps) external {
        if (msg.sender != platform) revert NotPlatform();
        if (newFeeBps > MAX_FEE_BPS) revert FeeTooHigh();
        platformFeeBps = newFeeBps;
    }

    // ---- ERC721 Overrides ----

    function tokenURI(uint256 tokenId)
        public view override(ERC721, ERC721URIStorage) returns (string memory)
    {
        return super.tokenURI(tokenId);
    }

    function supportsInterface(bytes4 interfaceId)
        public view override(ERC721Enumerable, ERC721URIStorage, ERC2981) returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    function _update(address to, uint256 tokenId, address auth)
        internal override(ERC721, ERC721Enumerable) returns (address)
    {
        return super._update(to, tokenId, auth);
    }

    function _increaseBalance(address account, uint128 value)
        internal override(ERC721, ERC721Enumerable)
    {
        super._increaseBalance(account, value);
    }

    // ---- Context diamond override (non-upgradeable + upgradeable) ----

    function _msgSender() internal view override(Context, ContextUpgradeable) returns (address) {
        return msg.sender;
    }

    function _msgData() internal pure override(Context, ContextUpgradeable) returns (bytes calldata) {
        return msg.data;
    }

    function _contextSuffixLength() internal pure override(Context, ContextUpgradeable) returns (uint256) {
        return 0;
    }
}
