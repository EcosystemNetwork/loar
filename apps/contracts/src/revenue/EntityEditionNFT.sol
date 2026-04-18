// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC1155Upgradeable} from "@openzeppelin-upgradeable/token/ERC1155/ERC1155Upgradeable.sol";
import {ERC2981Upgradeable} from "@openzeppelin-upgradeable/token/common/ERC2981Upgradeable.sol";
import {Initializable} from "@openzeppelin-upgradeable/proxy/utils/Initializable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin-upgradeable/utils/PausableUpgradeable.sol";
import {IPaymentRouter} from "../interfaces/IPaymentRouter.sol";
import {IRightsRegistry} from "../interfaces/IRightsRegistry.sol";

/// @title EntityEditionNFT
/// @notice ERC-1155 edition NFTs for world-building entities that can exist
///         in multiples: things, lore, species, technology.
///         Each token ID is a unique entity definition; minting copies = edition.
///         Free or paid — payment routed through PaymentRouter.
contract EntityEditionNFT is Initializable, ERC1155Upgradeable, ERC2981Upgradeable, ReentrancyGuardUpgradeable, PausableUpgradeable {
    enum EntityKind { THING, LORE, SPECIES, TECHNOLOGY }

    struct Edition {
        uint256 universeId;
        EntityKind kind;
        string name;
        bytes32 contentHash;
        address creator;
        uint256 mintPrice;   // ETH per copy (0 = free)
        uint256 maxSupply;   // 0 = open edition
        uint256 minted;
        bool active;
    }

    /// @notice The universe this collection belongs to
    uint256 public universeId;

    uint256 public nextEditionId;

    mapping(uint256 => Edition) public editions;
    mapping(uint256 => string) private _uris;

    address public platform;
    IPaymentRouter public paymentRouter;
    IRightsRegistry public rightsRegistry;
    uint16 public platformFeeBps;
    uint16 public royaltyBps;

    event EditionCreated(
        uint256 indexed editionId,
        uint256 indexed universeId,
        EntityKind kind,
        string name,
        address creator,
        uint256 mintPrice,
        uint256 maxSupply
    );
    event EditionMinted(uint256 indexed editionId, address buyer, uint256 amount, uint256 paid);
    event EditionDeactivated(uint256 indexed editionId);

    error EditionNotActive();
    error MaxSupplyReached();
    error InsufficientPayment();
    error NotCreatorOrPlatform();
    error NotPlatform();
    error FeeTooHigh();
    error ContentNotMonetizable();
    error WrongUniverse();
    error RefundFailed();

    uint16 public constant MAX_FEE_BPS = 5000;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function initialize(
        uint256 _universeId,
        address _platform,
        address _paymentRouter,
        address _rightsRegistry,
        uint16 _platformFeeBps,
        uint16 _royaltyBps
    ) external initializer {
        __ERC1155_init("");
        __ERC2981_init();
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

    /// @notice Register a new edition for minting
    /// @param _universeId Universe this entity belongs to
    /// @param kind        EntityKind enum value
    /// @param name        Display name for the entity
    /// @param contentHash SHA-256 of full entity content
    /// @param mintPrice   ETH per copy (0 = free)
    /// @param maxSupply   Edition cap (0 = unlimited)
    /// @param metadataURI IPFS URI for token metadata
    function createEdition(
        uint256 _universeId,
        EntityKind kind,
        string calldata name,
        bytes32 contentHash,
        uint256 mintPrice,
        uint256 maxSupply,
        string calldata metadataURI
    ) external whenNotPaused returns (uint256 editionId) {
        if (_universeId != universeId) revert WrongUniverse();
        if (!rightsRegistry.isMonetizable(contentHash)) revert ContentNotMonetizable();
        editionId = nextEditionId++;

        editions[editionId] = Edition({
            universeId: universeId,
            kind: kind,
            name: name,
            contentHash: contentHash,
            creator: msg.sender,
            mintPrice: mintPrice,
            maxSupply: maxSupply,
            minted: 0,
            active: true
        });
        _uris[editionId] = metadataURI;
        _setTokenRoyalty(editionId, msg.sender, royaltyBps);

        emit EditionCreated(editionId, universeId, kind, name, msg.sender, mintPrice, maxSupply);
    }

    /// @notice Mint `amount` copies of an edition
    function mint(uint256 editionId, uint256 amount) external payable nonReentrant whenNotPaused {
        Edition storage ed = editions[editionId];
        if (!ed.active) revert EditionNotActive();
        if (ed.maxSupply > 0 && ed.minted + amount > ed.maxSupply) revert MaxSupplyReached();

        uint256 totalPrice = ed.mintPrice * amount;
        if (msg.value < totalPrice) revert InsufficientPayment();

        ed.minted += amount;
        _mint(msg.sender, editionId, amount, "");

        // Route only totalPrice through PaymentRouter
        if (totalPrice > 0) {
            paymentRouter.route{value: totalPrice}(ed.creator, platformFeeBps);
        }

        // Refund excess ETH to buyer
        uint256 excess = msg.value - totalPrice;
        if (excess > 0) {
            (bool refunded,) = msg.sender.call{value: excess}("");
            if (!refunded) revert RefundFailed();
        }

        emit EditionMinted(editionId, msg.sender, amount, totalPrice);
    }

    /// @notice Deactivate an edition — stops new mints, existing tokens unchanged
    function deactivate(uint256 editionId) external {
        Edition storage ed = editions[editionId];
        if (msg.sender != ed.creator && msg.sender != platform) revert NotCreatorOrPlatform();
        ed.active = false;
        emit EditionDeactivated(editionId);
    }

    /// @notice Get editions in a universe filtered by kind (paginated)
    function getByUniverse(uint256 _universeId, EntityKind kind, uint256 startId, uint256 count)
        external view returns (uint256[] memory ids)
    {
        uint256[] memory temp = new uint256[](count);
        uint256 found = 0;
        for (uint256 i = startId; i < nextEditionId && found < count; i++) {
            if (editions[i].universeId == _universeId && editions[i].kind == kind) {
                temp[found++] = i;
            }
        }
        ids = new uint256[](found);
        for (uint256 j = 0; j < found; j++) ids[j] = temp[j];
    }

    function uri(uint256 editionId) public view override returns (string memory) {
        return _uris[editionId];
    }

    function setPlatformFee(uint16 newFeeBps) external {
        if (msg.sender != platform) revert NotPlatform();
        if (newFeeBps > MAX_FEE_BPS) revert FeeTooHigh();
        platformFeeBps = newFeeBps;
    }

    function supportsInterface(bytes4 interfaceId)
        public view override(ERC1155Upgradeable, ERC2981Upgradeable) returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;
}
