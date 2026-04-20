// SPDX-License-Identifier: MIT
pragma solidity =0.8.30;

import {IERC721} from "@openzeppelin/interfaces/IERC721.sol";
import {IERC1155} from "@openzeppelin/interfaces/IERC1155.sol";
import {IERC165} from "@openzeppelin/interfaces/IERC165.sol";
import {IERC2981} from "@openzeppelin/interfaces/IERC2981.sol";
import {ReentrancyGuard} from "@openzeppelin/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/access/Ownable.sol";
import {IPaymentRouter} from "../interfaces/IPaymentRouter.sol";
import {IRightsRegistry} from "../interfaces/IRightsRegistry.sol";

/// @title SlopMarket
/// @notice Direct peer-to-peer marketplace for all LOAR entity tokens.
///         No governance vote, no curation — list any ERC-721 or ERC-1155
///         token from the LOAR ecosystem (or any compliant contract) for sale.
///
///         Supported token contracts:
///           ERC-721  — CharacterNFT, EntityNFT, StructuralDeed, EpisodeNFT
///           ERC-1155 — EntityEditionNFT, EpisodeEditionCollection
///
///         Payment flows through PaymentRouter:
///           seller receives (1 - platformFeeBps) of sale price
///           platform treasury receives platformFeeBps cut
///
///         Sellers must approve this contract (setApprovalForAll or approve)
///         before listing. Tokens are transferred at point of sale, not on list.
contract SlopMarket is ReentrancyGuard, Ownable {
    enum TokenStandard {
        ERC721,
        ERC1155
    }

    struct Listing {
        address seller;
        address tokenContract;
        uint256 tokenId;
        TokenStandard standard;
        uint256 amount; // always 1 for ERC721; remaining stock for ERC1155
        uint256 pricePerUnit; // ETH per 1 token unit
        bool active;
    }

    bytes4 private constant ERC721_IFACE = 0x80ac58cd;
    bytes4 private constant ERC1155_IFACE = 0xd9b67a26;

    uint256 public nextListingId;
    mapping(uint256 => Listing) public listings;

    // seller => listingIds
    mapping(address => uint256[]) private _sellerListings;

    // tokenContract => tokenId => active listingId + 1 (0 = none)
    // Prevents double-listing the same ERC721 token
    mapping(address => mapping(uint256 => uint256)) public activeERC721Listing;

    address public immutable platform;
    IPaymentRouter public paymentRouter;
    IRightsRegistry public immutable rightsRegistry;
    uint16 public platformFeeBps;

    event Listed(
        uint256 indexed listingId,
        address indexed seller,
        address indexed tokenContract,
        uint256 tokenId,
        TokenStandard standard,
        uint256 amount,
        uint256 pricePerUnit
    );
    event Sale(uint256 indexed listingId, address indexed buyer, uint256 amount, uint256 totalPaid);
    event Delisted(uint256 indexed listingId);
    event PlatformFeeUpdated(uint16 newFeeBps);

    error NotSeller();
    error ListingNotActive();
    error InsufficientPayment();
    error UnsupportedTokenStandard();
    error InvalidAmount();
    error NotEnoughStock();
    error AlreadyListed();
    error NotTokenOwner();
    error NotApproved();
    error RefundFailed();
    error FeeTooHigh();
    error ContentNotMonetizable();

    uint16 public constant MAX_FEE_BPS = 5000;

    constructor(
        address _platform,
        address _paymentRouter,
        address _rightsRegistry,
        uint16 _platformFeeBps
    ) Ownable(msg.sender) {
        if (_platformFeeBps > MAX_FEE_BPS) revert FeeTooHigh();
        platform = _platform;
        paymentRouter = IPaymentRouter(_paymentRouter);
        rightsRegistry = IRightsRegistry(_rightsRegistry);
        platformFeeBps = _platformFeeBps;
    }

    // ---- Listing ----

    /// @notice List an ERC-721 or ERC-1155 token for sale at a fixed price
    /// @param tokenContract Address of the NFT contract
    /// @param tokenId       Token ID to sell
    /// @param amount        Units to sell (must be 1 for ERC-721)
    /// @param pricePerUnit  ETH price per single unit
    /// @param contentHash   Content hash for rights check (required if pricePerUnit > 0)
    function list(
        address tokenContract,
        uint256 tokenId,
        uint256 amount,
        uint256 pricePerUnit,
        bytes32 contentHash
    ) external returns (uint256 listingId) {
        if (amount == 0) revert InvalidAmount();
        // Paid listings require a valid, monetizable content hash
        if (pricePerUnit > 0) {
            if (contentHash == bytes32(0)) revert ContentNotMonetizable();
            if (!rightsRegistry.isMonetizable(contentHash)) revert ContentNotMonetizable();
        }

        TokenStandard std = _detectStandard(tokenContract);

        if (std == TokenStandard.ERC721) {
            if (amount != 1) revert InvalidAmount();
            if (IERC721(tokenContract).ownerOf(tokenId) != msg.sender) revert NotTokenOwner();
            if (
                !IERC721(tokenContract).isApprovedForAll(msg.sender, address(this))
                    && IERC721(tokenContract).getApproved(tokenId) != address(this)
            ) revert NotApproved();
            // Prevent the same ERC721 token being listed twice
            if (activeERC721Listing[tokenContract][tokenId] != 0) revert AlreadyListed();
        } else {
            if (IERC1155(tokenContract).balanceOf(msg.sender, tokenId) < amount) {
                revert NotEnoughStock();
            }
            if (!IERC1155(tokenContract).isApprovedForAll(msg.sender, address(this))) {
                revert NotApproved();
            }
        }

        listingId = nextListingId++;

        listings[listingId] = Listing({
            seller: msg.sender,
            tokenContract: tokenContract,
            tokenId: tokenId,
            standard: std,
            amount: amount,
            pricePerUnit: pricePerUnit,
            active: true
        });

        _sellerListings[msg.sender].push(listingId);

        if (std == TokenStandard.ERC721) {
            activeERC721Listing[tokenContract][tokenId] = listingId + 1;
        }

        emit Listed(listingId, msg.sender, tokenContract, tokenId, std, amount, pricePerUnit);
    }

    // ---- Buying ----

    /// @notice Buy `amount` units from an active listing
    /// @param listingId Listing to purchase from
    /// @param amount    Number of units to buy (must be 1 for ERC-721 listings)
    function buy(uint256 listingId, uint256 amount) external payable nonReentrant {
        Listing storage l = listings[listingId];
        if (!l.active) revert ListingNotActive();
        if (amount == 0 || amount > l.amount) revert NotEnoughStock();

        uint256 totalPrice = l.pricePerUnit * amount;
        if (msg.value < totalPrice) revert InsufficientPayment();

        // Update state before transfers (checks-effects-interactions)
        if (l.standard == TokenStandard.ERC721) {
            l.active = false;
            activeERC721Listing[l.tokenContract][l.tokenId] = 0;
        } else {
            l.amount -= amount;
            if (l.amount == 0) l.active = false;
        }

        // Transfer tokens
        if (l.standard == TokenStandard.ERC721) {
            IERC721(l.tokenContract).safeTransferFrom(l.seller, msg.sender, l.tokenId);
        } else {
            IERC1155(l.tokenContract).safeTransferFrom(l.seller, msg.sender, l.tokenId, amount, "");
        }

        // MARKET-01: Honor ERC2981 creator royalties
        (address royaltyReceiver, uint256 royaltyAmount) = (address(0), 0);
        try IERC2981(l.tokenContract).royaltyInfo(l.tokenId, totalPrice) returns (
            address receiver, uint256 royaltyAmt
        ) {
            royaltyReceiver = receiver;
            royaltyAmount = royaltyAmt;
        } catch {}

        if (royaltyAmount > 0 && royaltyReceiver != address(0) && royaltyReceiver != l.seller) {
            // Route royalty to creator, remaining to seller
            uint256 sellerAmount = totalPrice - royaltyAmount;
            paymentRouter.route{value: royaltyAmount}(royaltyReceiver, 0);
            paymentRouter.route{value: sellerAmount}(l.seller, platformFeeBps);
        } else {
            // Route payment: platform cut to treasury, rest accrues to seller
            paymentRouter.route{value: totalPrice}(l.seller, platformFeeBps);
        }

        // Refund overpayment
        uint256 overpaid = msg.value - totalPrice;
        if (overpaid > 0) {
            (bool ok,) = msg.sender.call{value: overpaid}("");
            if (!ok) revert RefundFailed();
        }

        emit Sale(listingId, msg.sender, amount, totalPrice);
    }

    // ---- Delisting ----

    /// @notice Seller cancels their listing
    function delist(uint256 listingId) external {
        Listing storage l = listings[listingId];
        if (l.seller != msg.sender) revert NotSeller();
        if (!l.active) revert ListingNotActive();

        l.active = false;

        if (l.standard == TokenStandard.ERC721) {
            activeERC721Listing[l.tokenContract][l.tokenId] = 0;
        }

        emit Delisted(listingId);
    }

    // ---- Views ----

    function getSellerListings(address seller) external view returns (uint256[] memory) {
        return _sellerListings[seller];
    }

    /// @notice Returns all active listing IDs for a seller (filtered client-side via active flag)
    function getListing(uint256 listingId) external view returns (Listing memory) {
        return listings[listingId];
    }

    // ---- Admin ----

    function setPlatformFee(uint16 newFeeBps) external onlyOwner {
        if (newFeeBps > MAX_FEE_BPS) revert FeeTooHigh();
        platformFeeBps = newFeeBps;
        emit PlatformFeeUpdated(newFeeBps);
    }

    error ZeroAddress();

    function setPaymentRouter(address newRouter) external onlyOwner {
        if (newRouter == address(0)) revert ZeroAddress();
        paymentRouter = IPaymentRouter(newRouter);
    }

    // ---- Internals ----

    function _detectStandard(address tokenContract) internal view returns (TokenStandard) {
        try IERC165(tokenContract).supportsInterface(ERC721_IFACE) returns (bool yes) {
            if (yes) return TokenStandard.ERC721;
        } catch {}
        try IERC165(tokenContract).supportsInterface(ERC1155_IFACE) returns (bool yes) {
            if (yes) return TokenStandard.ERC1155;
        } catch {}
        revert UnsupportedTokenStandard();
    }
}
