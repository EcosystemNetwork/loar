// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC721} from "@openzeppelin/token/ERC721/ERC721.sol";
import {ERC721Enumerable} from "@openzeppelin/token/ERC721/extensions/ERC721Enumerable.sol";
import {ERC721URIStorage} from "@openzeppelin/token/ERC721/extensions/ERC721URIStorage.sol";
import {ERC2981} from "@openzeppelin/token/common/ERC2981.sol";
import {ReentrancyGuard} from "@openzeppelin/utils/ReentrancyGuard.sol";
import {IPaymentRouter} from "../interfaces/IPaymentRouter.sol";
import {IRightsRegistry} from "../interfaces/IRightsRegistry.sol";

/// @title StructuralDeed
/// @notice ERC-721 "world real estate" for the ontology hierarchy:
///         DOMAIN → REALM → PLANE → DIMENSION → REALITY → TIMELINE
///
///         Higher layers are rarer and have lower supply caps. Deed ownership
///         grants IP rights over that slice of the narrative multiverse.
///
///         Layer mint prices and supply caps are set at deploy time and follow
///         the scarcity gradient (domains cheap/plentiful, timelines rare/expensive).
///
///         Example defaults (set by deployer):
///           DOMAIN     — 0.001 ETH, cap 10000
///           REALM      — 0.005 ETH, cap 2000
///           PLANE      — 0.02  ETH, cap 500
///           DIMENSION  — 0.05  ETH, cap 200
///           REALITY    — 0.1   ETH, cap 50
///           TIMELINE   — 0.5   ETH, cap 10
contract StructuralDeed is ERC721Enumerable, ERC721URIStorage, ERC2981, ReentrancyGuard {
    enum Layer {
        DOMAIN,      // 0 — most common, smallest territory
        REALM,       // 1
        PLANE,       // 2
        DIMENSION,   // 3
        REALITY,     // 4
        TIMELINE     // 5 — rarest, root-level world frame
    }

    struct Deed {
        uint256 universeId;
        Layer layer;
        string name;
        bytes32 contentHash;
        address creator;
        uint256 parentTokenId;  // 0 = no parent
    }

    // Per-layer mint price and supply cap (index = Layer uint8)
    uint256[6] public layerMintPrices;
    uint256[6] public layerMaxSupply;    // 0 = unlimited
    uint256[6] public layerMinted;

    uint256 public nextTokenId;
    mapping(uint256 => Deed) public deeds;

    // universeId => layer => nameHash => tokenId (duplicate guard)
    mapping(uint256 => mapping(uint8 => mapping(bytes32 => uint256))) public deedByName;

    address public immutable platform;
    IPaymentRouter public immutable paymentRouter;
    IRightsRegistry public immutable rightsRegistry;
    uint16 public immutable platformFeeBps;
    uint16 public immutable royaltyBps;

    event DeedMinted(
        uint256 indexed tokenId,
        uint256 indexed universeId,
        Layer layer,
        string name,
        address creator,
        uint256 parentTokenId
    );
    event LayerPriceUpdated(Layer layer, uint256 newPrice);

    error LayerSoldOut();
    error InsufficientPayment();
    error DeedExists();
    error NotPlatform();
    error FeeTooHigh();
    error ContentNotMonetizable();
    error InvalidParent();
    error ParentRequired();

    uint16 public constant MAX_FEE_BPS = 5000;

    constructor(
        address _platform,
        address _paymentRouter,
        address _rightsRegistry,
        uint16 _platformFeeBps,
        uint16 _royaltyBps,
        uint256[6] memory _layerMintPrices,
        uint256[6] memory _layerMaxSupply
    ) ERC721("LOAR World Deeds", "DEED") {
        if (_platformFeeBps > MAX_FEE_BPS) revert FeeTooHigh();
        platform = _platform;
        paymentRouter = IPaymentRouter(_paymentRouter);
        rightsRegistry = IRightsRegistry(_rightsRegistry);
        platformFeeBps = _platformFeeBps;
        royaltyBps = _royaltyBps;
        layerMintPrices = _layerMintPrices;
        layerMaxSupply = _layerMaxSupply;
    }

    /// @notice Mint a structural deed at the given layer
    /// @param universeId    Universe this world layer belongs to
    /// @param layer         Layer enum value (DOMAIN through TIMELINE)
    /// @param name          Unique name within universe+layer
    /// @param contentHash   SHA-256 of full world-building content
    /// @param parentTokenId Token ID of containing deed (0 if none)
    /// @param metadataURI   IPFS/Walrus URI for NFT metadata
    function mintDeed(
        uint256 universeId,
        Layer layer,
        string calldata name,
        bytes32 contentHash,
        uint256 parentTokenId,
        string calldata metadataURI
    ) external payable nonReentrant returns (uint256 tokenId) {
        if (!rightsRegistry.isMonetizable(contentHash)) revert ContentNotMonetizable();
        uint8 l = uint8(layer);
        if (msg.value < layerMintPrices[l]) revert InsufficientPayment();
        if (layerMaxSupply[l] > 0 && layerMinted[l] >= layerMaxSupply[l]) revert LayerSoldOut();

        // Hierarchy validation: DOMAIN (layer 0) has no parent, all others require one
        if (layer == Layer.DOMAIN) {
            // DOMAIN is root — parentTokenId must be 0
            if (parentTokenId != 0) revert InvalidParent();
        } else {
            // All other layers require a parent that is exactly one layer above
            if (parentTokenId == 0) revert ParentRequired();
            Deed storage parent = deeds[parentTokenId];
            if (parent.universeId != universeId) revert InvalidParent();
            if (uint8(parent.layer) + 1 != l) revert InvalidParent();
        }

        bytes32 nameHash = keccak256(abi.encodePacked(name));
        if (deedByName[universeId][l][nameHash] != 0) revert DeedExists();

        tokenId = ++nextTokenId;
        deedByName[universeId][l][nameHash] = tokenId;
        layerMinted[l]++;

        deeds[tokenId] = Deed({
            universeId: universeId,
            layer: layer,
            name: name,
            contentHash: contentHash,
            creator: msg.sender,
            parentTokenId: parentTokenId
        });

        _safeMint(msg.sender, tokenId);
        _setTokenURI(tokenId, metadataURI);
        _setTokenRoyalty(tokenId, msg.sender, royaltyBps);

        // Route mint fee entirely to treasury (not back to minter)
        if (msg.value > 0) {
            paymentRouter.routeToTreasury{value: msg.value}();
        }

        emit DeedMinted(tokenId, universeId, layer, name, msg.sender, parentTokenId);
    }

    /// @notice Get deeds in a universe at a given layer (paginated)
    function getDeedsByLayer(uint256 universeId, Layer layer, uint256 startId, uint256 count)
        external view returns (uint256[] memory ids)
    {
        uint256[] memory temp = new uint256[](count);
        uint256 found = 0;
        for (uint256 i = startId; i <= nextTokenId && found < count; i++) {
            if (deeds[i].universeId == universeId && deeds[i].layer == layer) {
                temp[found++] = i;
            }
        }
        ids = new uint256[](found);
        for (uint256 j = 0; j < found; j++) ids[j] = temp[j];
    }

    /// @notice Get direct children of a parent deed (paginated)
    function getChildren(uint256 parentTokenId, uint256 startId, uint256 count)
        external view returns (uint256[] memory ids)
    {
        uint256[] memory temp = new uint256[](count);
        uint256 found = 0;
        for (uint256 i = startId; i <= nextTokenId && found < count; i++) {
            if (deeds[i].parentTokenId == parentTokenId) {
                temp[found++] = i;
            }
        }
        ids = new uint256[](found);
        for (uint256 j = 0; j < found; j++) ids[j] = temp[j];
    }

    function setLayerPrice(Layer layer, uint256 newPrice) external {
        if (msg.sender != platform) revert NotPlatform();
        layerMintPrices[uint8(layer)] = newPrice;
        emit LayerPriceUpdated(layer, newPrice);
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
}
