// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {Initializable} from "@openzeppelin-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin-upgradeable/access/OwnableUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {ISplitRouter} from "../interfaces/ISplitRouter.sol";
import {IPaymentRouter} from "../interfaces/IPaymentRouter.sol";

/// @title ContentLicensing
/// @notice Manages individual content piece licensing: buy (permanent), rent (time-bound),
///         or license (usage rights with royalties). Revenue is routed through SplitRouter
///         so universe creators and content generators both earn.
contract ContentLicensing is Initializable, UUPSUpgradeable, OwnableUpgradeable, ReentrancyGuardUpgradeable {
    enum DealType { BUY, RENT, LICENSE }
    enum DealStatus { ACTIVE, EXPIRED, REVOKED }

    struct ContentRegistration {
        bytes32 contentHash;
        address creator;
        uint256 universeId;
        bytes32 splitEntityHash;    // entityHash in SplitRouter for revenue splits
        uint256 buyPrice;           // 0 = not for sale
        uint256 rentPricePerDay;    // 0 = not for rent
        uint256 licenseFee;         // 0 = not licensable
        uint16 licenseRoyaltyBps;   // ongoing royalty BPS for LICENSE deals
        bool active;
    }

    struct Deal {
        uint256 id;
        bytes32 contentHash;
        bytes32 splitEntityHash;    // stored so royalty routing works without reverse lookup
        DealType dealType;
        DealStatus status;
        address buyer;
        uint256 pricePaid;
        uint256 startTime;
        uint256 endTime;            // 0 for BUY (permanent)
    }

    ISplitRouter public splitRouter;
    IPaymentRouter public paymentRouter;
    address public platform;
    uint16 public platformFeeBps;

    mapping(bytes32 => ContentRegistration) public registrations;
    mapping(uint256 => Deal) public deals;
    uint256 public nextDealId;

    // contentHash => deal IDs
    mapping(bytes32 => uint256[]) internal _contentDeals;

    // contentHash => current owner (set on BUY)
    mapping(bytes32 => address) public contentOwner;

    // splitEntityHash => contentHash (reverse lookup for payment routing)
    mapping(bytes32 => bytes32) public splitToContent;

    event ContentRegistered(bytes32 indexed contentHash, address creator, uint256 universeId, bytes32 splitEntityHash);
    event ContentBought(uint256 indexed dealId, bytes32 contentHash, address buyer, uint256 price);
    event ContentRented(uint256 indexed dealId, bytes32 contentHash, address buyer, uint256 price, uint256 endTime);
    event ContentLicensed(uint256 indexed dealId, bytes32 contentHash, address buyer, uint256 fee, uint256 endTime);
    event RoyaltyPaid(uint256 indexed dealId, uint256 amount);
    event ContentDeactivated(bytes32 indexed contentHash);
    event PricingUpdated(bytes32 indexed contentHash);

    error NotCreator();
    error ContentNotActive();
    error NotForSale();
    error NotForRent();
    error NotLicensable();
    error InsufficientPayment();
    error InvalidDuration();
    error DealNotActive();
    error AlreadyRegistered();
    error NotRegistered();
    error FeeTooHigh();
    error ZeroAddress();
    error ZeroHash();
    error SplitRouterFailed();
    error RefundFailed();

    uint16 public constant MAX_FEE_BPS = 5000;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function initialize(
        address _platform,
        address _splitRouter,
        address _paymentRouter,
        uint16 _platformFeeBps
    ) external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        if (_platform == address(0) || _splitRouter == address(0) || _paymentRouter == address(0)) revert ZeroAddress();
        if (_platformFeeBps > MAX_FEE_BPS) revert FeeTooHigh();
        platform = _platform;
        splitRouter = ISplitRouter(_splitRouter);
        paymentRouter = IPaymentRouter(_paymentRouter);
        platformFeeBps = _platformFeeBps;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // ── Registration ────────────────────────────────────────────────────

    /// @notice Register content for the marketplace. Creator must have splits
    ///         configured in SplitRouter for the splitEntityHash.
    function registerContent(
        bytes32 contentHash,
        uint256 universeId,
        bytes32 splitEntityHash,
        uint256 buyPrice,
        uint256 rentPricePerDay,
        uint256 licenseFee,
        uint16 licenseRoyaltyBps
    ) external {
        if (contentHash == bytes32(0)) revert ZeroHash();
        if (registrations[contentHash].creator != address(0)) revert AlreadyRegistered();
        if (licenseRoyaltyBps > MAX_FEE_BPS) revert FeeTooHigh();

        registrations[contentHash] = ContentRegistration({
            contentHash: contentHash,
            creator: msg.sender,
            universeId: universeId,
            splitEntityHash: splitEntityHash,
            buyPrice: buyPrice,
            rentPricePerDay: rentPricePerDay,
            licenseFee: licenseFee,
            licenseRoyaltyBps: licenseRoyaltyBps,
            active: true
        });

        contentOwner[contentHash] = msg.sender;

        // Store reverse lookup so payment routing can find the creator
        if (splitEntityHash != bytes32(0)) {
            splitToContent[splitEntityHash] = contentHash;
        }

        emit ContentRegistered(contentHash, msg.sender, universeId, splitEntityHash);
    }

    // ── Deal Execution ──────────────────────────────────────────────────

    /// @notice Buy content permanently. Payment routed through SplitRouter.
    function buyContent(bytes32 contentHash) external payable nonReentrant returns (uint256 dealId) {
        ContentRegistration storage reg = registrations[contentHash];
        if (!reg.active) revert ContentNotActive();
        if (reg.buyPrice == 0) revert NotForSale();
        if (msg.value < reg.buyPrice) revert InsufficientPayment();

        dealId = nextDealId++;
        deals[dealId] = Deal({
            id: dealId,
            contentHash: contentHash,
            splitEntityHash: reg.splitEntityHash,
            dealType: DealType.BUY,
            status: DealStatus.ACTIVE,
            buyer: msg.sender,
            pricePaid: msg.value,
            startTime: block.timestamp,
            endTime: 0 // permanent
        });
        _contentDeals[contentHash].push(dealId);

        // Transfer ownership
        contentOwner[contentHash] = msg.sender;

        // Route exact price through splits; refund overpayment
        _routePayment(reg.splitEntityHash, reg.buyPrice);
        _refundExcess(msg.value, reg.buyPrice);

        emit ContentBought(dealId, contentHash, msg.sender, reg.buyPrice);
    }

    /// @notice Rent content for a duration. Payment through SplitRouter.
    function rentContent(bytes32 contentHash, uint256 durationDays) external payable nonReentrant returns (uint256 dealId) {
        ContentRegistration storage reg = registrations[contentHash];
        if (!reg.active) revert ContentNotActive();
        if (reg.rentPricePerDay == 0) revert NotForRent();
        if (durationDays == 0) revert InvalidDuration();

        uint256 totalCost = reg.rentPricePerDay * durationDays;
        if (msg.value < totalCost) revert InsufficientPayment();

        uint256 endTime = block.timestamp + (durationDays * 1 days);

        dealId = nextDealId++;
        deals[dealId] = Deal({
            id: dealId,
            contentHash: contentHash,
            splitEntityHash: reg.splitEntityHash,
            dealType: DealType.RENT,
            status: DealStatus.ACTIVE,
            buyer: msg.sender,
            pricePaid: msg.value,
            startTime: block.timestamp,
            endTime: endTime
        });
        _contentDeals[contentHash].push(dealId);

        _routePayment(reg.splitEntityHash, totalCost);
        _refundExcess(msg.value, totalCost);

        emit ContentRented(dealId, contentHash, msg.sender, totalCost, endTime);
    }

    /// @notice License content for usage rights with potential ongoing royalties.
    function licenseContent(bytes32 contentHash, uint256 durationDays) external payable nonReentrant returns (uint256 dealId) {
        ContentRegistration storage reg = registrations[contentHash];
        if (!reg.active) revert ContentNotActive();
        if (reg.licenseFee == 0) revert NotLicensable();
        if (durationDays == 0) revert InvalidDuration();
        if (msg.value < reg.licenseFee) revert InsufficientPayment();

        uint256 endTime = block.timestamp + (durationDays * 1 days);

        dealId = nextDealId++;
        deals[dealId] = Deal({
            id: dealId,
            contentHash: contentHash,
            splitEntityHash: reg.splitEntityHash,
            dealType: DealType.LICENSE,
            status: DealStatus.ACTIVE,
            buyer: msg.sender,
            pricePaid: msg.value,
            startTime: block.timestamp,
            endTime: endTime
        });
        _contentDeals[contentHash].push(dealId);

        _routePayment(reg.splitEntityHash, reg.licenseFee);
        _refundExcess(msg.value, reg.licenseFee);

        emit ContentLicensed(dealId, contentHash, msg.sender, reg.licenseFee, endTime);
    }

    error DealExpired();

    /// @notice Pay ongoing royalty for a LICENSE deal.
    /// @dev Enforces endTime — auto-expires the deal if past deadline.
    function payRoyalty(uint256 dealId) external payable nonReentrant {
        Deal storage deal = deals[dealId];
        if (deal.dealType != DealType.LICENSE) revert DealNotActive();
        if (deal.status != DealStatus.ACTIVE) revert DealNotActive();

        // Enforce expiry — auto-transition to EXPIRED, revert with clear error
        if (deal.endTime > 0 && block.timestamp > deal.endTime) {
            deal.status = DealStatus.EXPIRED;
            revert DealExpired();
        }

        ContentRegistration storage reg = registrations[deal.contentHash];
        _routePayment(reg.splitEntityHash, msg.value);

        emit RoyaltyPaid(dealId, msg.value);
    }

    /// @notice Check if a user has active access (view-only, does not auto-expire)
    function hasAccess(bytes32 contentHash, address user) external view returns (bool) {
        uint256[] storage dealIds = _contentDeals[contentHash];
        for (uint256 i = dealIds.length; i > 0; i--) {
            Deal storage deal = deals[dealIds[i - 1]];
            if (deal.buyer != user) continue;
            if (deal.status != DealStatus.ACTIVE) continue;
            if (deal.dealType == DealType.BUY) return true;
            if (deal.endTime == 0 || block.timestamp <= deal.endTime) return true;
        }
        return false;
    }

    /// @notice Check if a user has active access to rented/licensed content
    /// @dev Auto-expires deals past their endTime (state-changing)
    function checkAccess(bytes32 contentHash, address user) external returns (bool hasAccess) {
        uint256[] storage dealIds = _contentDeals[contentHash];
        for (uint256 i = dealIds.length; i > 0; i--) {
            Deal storage deal = deals[dealIds[i - 1]];
            if (deal.buyer != user) continue;
            if (deal.status != DealStatus.ACTIVE) continue;

            // BUY deals never expire
            if (deal.dealType == DealType.BUY) return true;

            // RENT/LICENSE — check expiry, auto-expire if past
            if (deal.endTime > 0 && block.timestamp > deal.endTime) {
                deal.status = DealStatus.EXPIRED;
                continue;
            }
            return true;
        }
        return false;
    }

    // ── Management ──────────────────────────────────────────────────────

    /// @notice Update pricing (content creator only)
    function updatePricing(
        bytes32 contentHash,
        uint256 buyPrice,
        uint256 rentPricePerDay,
        uint256 licenseFee,
        uint16 licenseRoyaltyBps
    ) external {
        ContentRegistration storage reg = registrations[contentHash];
        if (reg.creator != msg.sender) revert NotCreator();
        if (licenseRoyaltyBps > MAX_FEE_BPS) revert FeeTooHigh();

        reg.buyPrice = buyPrice;
        reg.rentPricePerDay = rentPricePerDay;
        reg.licenseFee = licenseFee;
        reg.licenseRoyaltyBps = licenseRoyaltyBps;

        emit PricingUpdated(contentHash);
    }

    /// @notice Deactivate content from marketplace
    function deactivateContent(bytes32 contentHash) external {
        ContentRegistration storage reg = registrations[contentHash];
        if (reg.creator != msg.sender && msg.sender != platform) revert NotCreator();
        reg.active = false;
        emit ContentDeactivated(contentHash);
    }

    // ── Views ───────────────────────────────────────────────────────────

    /// @notice Check if a deal is currently active (not expired/revoked)
    function isDealActive(uint256 dealId) external view returns (bool) {
        Deal storage deal = deals[dealId];
        if (deal.status != DealStatus.ACTIVE) return false;
        if (deal.dealType == DealType.BUY) return true; // permanent
        return block.timestamp <= deal.endTime;
    }

    function getContentDeals(bytes32 contentHash) external view returns (uint256[] memory) {
        return _contentDeals[contentHash];
    }

    /// @notice Paginated deal query for a content piece
    function getContentDealsPaginated(bytes32 contentHash, uint256 offset, uint256 limit)
        external view returns (uint256[] memory ids, uint256 total)
    {
        uint256[] storage all = _contentDeals[contentHash];
        total = all.length;
        if (offset >= total) return (new uint256[](0), total);
        uint256 end = offset + limit;
        if (end > total) end = total;
        ids = new uint256[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            ids[i - offset] = all[i];
        }
    }

    function getRegistration(bytes32 contentHash) external view returns (ContentRegistration memory) {
        return registrations[contentHash];
    }

    // ── Admin ───────────────────────────────────────────────────────────

    function setPlatformFee(uint16 newFeeBps) external onlyOwner {
        if (newFeeBps > MAX_FEE_BPS) revert FeeTooHigh();
        platformFeeBps = newFeeBps;
    }

    // ── Internal ────────────────────────────────────────────────────────

    /// @dev Reserved storage gap for future upgrades
    uint256[40] private __gap;

    /// @dev Refund any overpayment to the buyer
    function _refundExcess(uint256 paid, uint256 price) internal {
        if (paid > price) {
            (bool ok,) = msg.sender.call{value: paid - price}("");
            if (!ok) revert RefundFailed();
        }
    }

    /// @dev Route payment through SplitRouter if splits are configured,
    ///      otherwise fall back to PaymentRouter direct routing.
    function _routePayment(bytes32 splitEntityHash, uint256 amount) internal {
        if (amount == 0) return;

        // Try SplitRouter first (handles multi-recipient splits)
        if (splitEntityHash != bytes32(0)) {
            try splitRouter.getSplits(splitEntityHash) returns (ISplitRouter.Split[] memory splits) {
                if (splits.length > 0) {
                    splitRouter.routeWithSplits{value: amount}(splitEntityHash, platformFeeBps);
                    return;
                }
            } catch (bytes memory reason) {
                // Only swallow "no splits configured" — revert on real failures
                // Empty reason = function reverted without data (e.g. not found)
                if (reason.length > 0) revert SplitRouterFailed();
            }
        }

        // Fallback: use reverse mapping to find the content creator
        bytes32 contentHash = splitToContent[splitEntityHash];
        ContentRegistration storage reg = registrations[contentHash];
        if (reg.creator != address(0)) {
            paymentRouter.route{value: amount}(reg.creator, platformFeeBps);
        } else {
            paymentRouter.routeToTreasury{value: amount}();
        }
    }
}
