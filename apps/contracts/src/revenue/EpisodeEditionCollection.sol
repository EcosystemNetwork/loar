// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {ERC1155} from "@openzeppelin/token/ERC1155/ERC1155.sol";
import {ERC2981} from "@openzeppelin/token/common/ERC2981.sol";
import {ReentrancyGuard} from "@openzeppelin/utils/ReentrancyGuard.sol";
import {IRightsRegistry} from "../interfaces/IRightsRegistry.sol";
import {IPaymentRouter} from "../interfaces/IPaymentRouter.sol";

/// @title EpisodeEditionCollection
/// @notice Per-universe ERC-1155 collection for episode editions.
///         Each token ID is one episode; multiple mints of the same ID are edition copies.
///         Replaces the global EpisodeNFT (ERC-721) which modeled editions awkwardly.
///
///         Checks RightsRegistry before creating an edition — FUN and FROZEN content
///         cannot be monetized. Routes all payments through PaymentRouter.
contract EpisodeEditionCollection is ERC1155, ERC2981, ReentrancyGuard {
    struct Edition {
        uint256 nodeId;
        bytes32 contentHash;
        address creator;
        uint256 mintPrice;
        uint256 maxSupply;  // 0 = open edition
        uint256 minted;
        bool active;
    }

    /// @notice The universe this collection belongs to
    uint256 public immutable universeId;

    address public platform;
    IRightsRegistry public rightsRegistry;
    IPaymentRouter public paymentRouter;

    uint16 public platformFeeBps;
    uint16 public royaltyBps;

    uint256 public nextEditionId;
    mapping(uint256 => Edition) public editions;
    mapping(uint256 => string) private _editionURIs;

    event EditionCreated(
        uint256 indexed editionId,
        uint256 nodeId,
        bytes32 contentHash,
        address creator,
        uint256 mintPrice,
        uint256 maxSupply
    );
    event EditionMinted(uint256 indexed editionId, address buyer, uint256 amount, uint256 paid);
    event EditionDeactivated(uint256 indexed editionId);

    error NotCreator();
    error EditionNotActive();
    error MaxSupplyReached();
    error InsufficientPayment();
    error ContentNotMonetizable();
    error NotPlatform();
    error FeeTooHigh();

    uint16 public constant MAX_FEE_BPS = 5000;

    modifier onlyPlatform() {
        if (msg.sender != platform) revert NotPlatform();
        _;
    }

    constructor(
        uint256 _universeId,
        address _platform,
        address _rightsRegistry,
        address _paymentRouter,
        uint16 _platformFeeBps,
        uint16 _royaltyBps
    ) ERC1155("") {
        if (_platformFeeBps > MAX_FEE_BPS) revert FeeTooHigh();
        universeId = _universeId;
        platform = _platform;
        rightsRegistry = IRightsRegistry(_rightsRegistry);
        paymentRouter = IPaymentRouter(_paymentRouter);
        platformFeeBps = _platformFeeBps;
        royaltyBps = _royaltyBps;
    }

    /// @notice Register a new episode edition for minting
    /// @dev contentHash must not be classified as FUN or FROZEN in RightsRegistry
    function createEdition(
        uint256 nodeId,
        bytes32 contentHash,
        uint256 mintPrice,
        uint256 maxSupply,
        string calldata metadataURI
    ) external returns (uint256 editionId) {
        if (!rightsRegistry.isMonetizable(contentHash)) revert ContentNotMonetizable();

        editionId = nextEditionId++;
        editions[editionId] = Edition({
            nodeId: nodeId,
            contentHash: contentHash,
            creator: msg.sender,
            mintPrice: mintPrice,
            maxSupply: maxSupply,
            minted: 0,
            active: true
        });
        _editionURIs[editionId] = metadataURI;
        _setTokenRoyalty(editionId, msg.sender, royaltyBps);

        emit EditionCreated(editionId, nodeId, contentHash, msg.sender, mintPrice, maxSupply);
    }

    /// @notice Mint `amount` copies of an edition
    function mint(uint256 editionId, uint256 amount) external payable nonReentrant {
        Edition storage ed = editions[editionId];
        if (!ed.active) revert EditionNotActive();
        if (ed.maxSupply > 0 && ed.minted + amount > ed.maxSupply) revert MaxSupplyReached();

        uint256 totalPrice = ed.mintPrice * amount;
        if (msg.value < totalPrice) revert InsufficientPayment();

        ed.minted += amount;
        _mint(msg.sender, editionId, amount, "");

        // Route payment through PaymentRouter
        paymentRouter.route{value: msg.value}(ed.creator, platformFeeBps);

        emit EditionMinted(editionId, msg.sender, amount, msg.value);
    }

    /// @notice Deactivate an edition (creator or platform)
    function deactivateEdition(uint256 editionId) external {
        Edition storage ed = editions[editionId];
        if (msg.sender != ed.creator && msg.sender != platform) revert NotCreator();
        ed.active = false;
        emit EditionDeactivated(editionId);
    }

    /// @notice Per-edition metadata URI
    function uri(uint256 editionId) public view override returns (string memory) {
        return _editionURIs[editionId];
    }

    function setPlatformFee(uint16 newFeeBps) external onlyPlatform {
        if (newFeeBps > MAX_FEE_BPS) revert FeeTooHigh();
        platformFeeBps = newFeeBps;
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC1155, ERC2981)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
