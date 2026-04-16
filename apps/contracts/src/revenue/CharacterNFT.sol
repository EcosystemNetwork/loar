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
import {IRightsRegistry} from "../interfaces/IRightsRegistry.sol";
import {IPaymentRouter} from "../interfaces/IPaymentRouter.sol";

/// @title CharacterNFT
/// @notice Characters as ownable NFTs. Owners earn when their character appears in episodes.
///         Supports appearance tracking and royalty accumulation.
contract CharacterNFT is Initializable, ERC721Enumerable, ERC721URIStorage, ERC2981, ReentrancyGuardUpgradeable, PausableUpgradeable {
    struct Character {
        uint256 universeId;
        string name;
        bytes32 visualHash;        // hash of character visual description/image
        address creator;
        uint256 appearanceCount;
        uint256 accumulatedRoyalties;
    }

    /// @notice The universe this collection belongs to
    uint256 public universeId;

    uint256 public nextCharacterId;
    uint256 public nextTokenId;

    mapping(uint256 => Character) public characters;
    /// @notice Maps edition token IDs back to their character definition ID
    mapping(uint256 => uint256) public tokenToCharacter;
    // universeId => characterName hash => characterId (prevent duplicates)
    mapping(uint256 => mapping(bytes32 => uint256)) public characterByName;

    address public platform;
    IRightsRegistry public rightsRegistry;
    IPaymentRouter public paymentRouter;
    uint16 public appearanceFeeBps;    // fee taken from episode mint when character appears

    event CharacterCreated(uint256 indexed characterId, uint256 universeId, string name, address creator);
    event CharacterAppearance(uint256 indexed characterId, uint256 indexed episodeId, uint256 reward);
    event RoyaltyClaimed(uint256 indexed characterId, address owner, uint256 amount);

    error NotOwner();
    error CharacterExists();
    error NothingToClaim();
    error TransferFailed();
    error FeeTooHigh();
    error ContentNotMonetizable();
    error WrongUniverse();
    error InsufficientPayment();
    error CharacterNotActive();

    uint16 public constant MAX_FEE_BPS = 5000;

    /// @notice Mapping from characterId to mint price (0 = free)
    mapping(uint256 => uint256) public characterMintPrice;
    /// @notice Mapping from characterId to max supply (0 = 1-of-1)
    mapping(uint256 => uint256) public characterMaxSupply;
    /// @notice Mapping from characterId to minted count
    mapping(uint256 => uint256) public characterMinted;
    /// @notice Mapping from characterId to active status
    mapping(uint256 => bool) public characterActive;
    /// @notice Claimable royalties per owner address (from appearance rewards)
    mapping(address => uint256) public claimableRoyalties;
    /// @notice Maps characterId to the original token ID minted for that character
    mapping(uint256 => uint256) public characterOriginalToken;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() ERC721("LOAR Characters", "CHARACTER") { _disableInitializers(); }

    function initialize(
        uint256 _universeId,
        address _platform,
        address _rightsRegistry,
        address _paymentRouter,
        uint16 _appearanceFeeBps
    ) external initializer {
        __ReentrancyGuard_init();
        __Pausable_init();
        if (_appearanceFeeBps > MAX_FEE_BPS) revert FeeTooHigh();
        universeId = _universeId;
        platform = _platform;
        rightsRegistry = IRightsRegistry(_rightsRegistry);
        paymentRouter = IPaymentRouter(_paymentRouter);
        appearanceFeeBps = _appearanceFeeBps;
    }

    function pause() external { require(msg.sender == platform, "Only platform"); _pause(); }
    function unpause() external { require(msg.sender == platform, "Only platform"); _unpause(); }

    /// @notice Create a new character listing (free or paid). Creator becomes first owner.
    /// @param _universeId Universe this character belongs to
    /// @param name Unique character name within the universe
    /// @param visualHash Hash of the character visual description/image
    /// @param metadataURI IPFS URI for NFT metadata
    /// @param mintPrice ETH price for additional mints (0 = free, only creator gets one)
    /// @param maxSupply Max editions (0 = 1-of-1, only creator mint)
    function createCharacter(
        uint256 _universeId,
        string calldata name,
        bytes32 visualHash,
        string calldata metadataURI,
        uint256 mintPrice,
        uint256 maxSupply
    ) external whenNotPaused returns (uint256 characterId) {
        if (_universeId != universeId) revert WrongUniverse();
        if (!rightsRegistry.isMonetizable(visualHash)) revert ContentNotMonetizable();
        bytes32 nameHash = keccak256(abi.encodePacked(name));
        if (characterByName[_universeId][nameHash] != 0) revert CharacterExists();

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

        characterMintPrice[characterId] = mintPrice;
        characterMaxSupply[characterId] = maxSupply;
        characterMinted[characterId] = 1; // creator gets the first one
        characterActive[characterId] = true;

        // Use separate token ID counter to avoid collision with character IDs
        uint256 tokenId = ++nextTokenId;
        tokenToCharacter[tokenId] = characterId;
        characterOriginalToken[characterId] = tokenId;

        _safeMint(msg.sender, tokenId);
        _setTokenURI(tokenId, metadataURI);
        _setTokenRoyalty(tokenId, msg.sender, 500); // 5% secondary royalty

        emit CharacterCreated(characterId, universeId, name, msg.sender);
    }

    /// @notice Mint (purchase) a character NFT edition. Payment routed through PaymentRouter.
    /// @param characterId The character to mint an edition of
    /// @param tokenURI_ Metadata URI for this specific edition token
    function mintCharacter(uint256 characterId, string calldata tokenURI_) external payable nonReentrant whenNotPaused returns (uint256 tokenId) {
        if (!characterActive[characterId]) revert CharacterNotActive();
        uint256 maxSup = characterMaxSupply[characterId];
        if (maxSup > 0 && characterMinted[characterId] >= maxSup) revert CharacterExists();
        uint256 price = characterMintPrice[characterId];
        if (msg.value < price) revert InsufficientPayment();

        tokenId = ++nextTokenId;
        tokenToCharacter[tokenId] = characterId;
        characterMinted[characterId]++;

        _safeMint(msg.sender, tokenId);
        _setTokenURI(tokenId, tokenURI_);
        _setTokenRoyalty(tokenId, characters[characterId].creator, 500);

        // Route payment to creator through PaymentRouter
        if (msg.value > 0) {
            uint256 excess = msg.value - price;
            paymentRouter.route{value: price}(characters[characterId].creator, appearanceFeeBps);
            // Refund excess ETH
            if (excess > 0) {
                (bool refunded,) = msg.sender.call{value: excess}("");
                if (!refunded) revert TransferFailed();
            }
        }

        emit EpisodeMinted(tokenId, characterId, msg.sender, price);
    }

    // Reuse EpisodeMinted event shape for character mints
    event EpisodeMinted(uint256 indexed tokenId, uint256 indexed characterId, address buyer, uint256 price);

    /// @notice Record a character appearance in an episode and accrue reward for owner
    /// @dev Called by the platform when an episode featuring this character is minted
    function recordAppearance(uint256 characterId, uint256 episodeId) external payable whenNotPaused {
        require(msg.sender == platform, "Only platform");
        Character storage c = characters[characterId];
        c.appearanceCount++;
        c.accumulatedRoyalties += msg.value;

        // Accrue claimable royalties for the current owner of the original character token.
        // NOTE: characterId != tokenId — they diverge after edition mints,
        // so ownerOf(characterId) would return the wrong address.
        if (msg.value > 0) {
            address charOwner = ownerOf(characterOriginalToken[characterId]);
            claimableRoyalties[charOwner] += msg.value;
            // Route reward through PaymentRouter (0 fee — platform already took its cut)
            paymentRouter.route{value: msg.value}(charOwner, 0);
        }

        emit CharacterAppearance(characterId, episodeId, msg.value);
    }

    /// @notice Claim accumulated appearance royalties
    /// @dev Royalties are routed through PaymentRouter on appearance, so the owner
    ///      claims from PaymentRouter. This function resets the tracked amount.
    function claimRoyalties() external nonReentrant {
        uint256 amount = claimableRoyalties[msg.sender];
        if (amount == 0) revert NothingToClaim();
        claimableRoyalties[msg.sender] = 0;
        emit RoyaltyClaimed(0, msg.sender, amount);
    }

    /// @notice Deactivate character (creator only)
    function deactivateCharacter(uint256 characterId) external {
        if (characters[characterId].creator != msg.sender) revert NotOwner();
        characterActive[characterId] = false;
    }

    /// @notice Get all characters in a universe
    function getCharactersByUniverse(uint256 _universeId, uint256 startId, uint256 count)
        external view returns (uint256[] memory ids)
    {
        uint256[] memory temp = new uint256[](count);
        uint256 found = 0;
        for (uint256 i = startId; i <= nextCharacterId && found < count; i++) {
            if (characters[i].universeId == _universeId) {
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
