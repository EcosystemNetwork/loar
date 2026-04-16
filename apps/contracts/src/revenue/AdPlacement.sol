// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Initializable} from "@openzeppelin-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin-upgradeable/access/OwnableUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin-upgradeable/utils/PausableUpgradeable.sol";
import {IPaymentRouter} from "../interfaces/IPaymentRouter.sol";

/// @title AdPlacement
/// @notice Manages programmatic product placement and sponsorships inside
///         AI-generated episodes. Sponsors bid for placement slots.
contract AdPlacement is Initializable, UUPSUpgradeable, OwnableUpgradeable, ReentrancyGuardUpgradeable, PausableUpgradeable {
    enum PlacementType { BILLBOARD, PRODUCT, SPONSORED_CHARACTER, AUDIO_MENTION }

    struct AdSlot {
        uint256 id;
        uint256 universeId;
        PlacementType placementType;
        uint256 minBid;
        uint256 currentBid;
        address currentBidder;
        string metadata;           // placement details/constraints
        uint256 episodesRemaining;
        bool active;
    }

    struct Sponsorship {
        uint256 id;
        uint256 adSlotId;
        address sponsor;
        uint256 totalPaid;
        uint256 impressions;
        uint256 startedAt;
        bool active;
    }

    uint256 public nextSlotId;
    uint256 public nextSponsorshipId;

    mapping(uint256 => AdSlot) public adSlots;
    mapping(uint256 => Sponsorship) public sponsorships;

    // universeId => slot IDs
    mapping(uint256 => uint256[]) public universeSlots;

    address public platform;
    IPaymentRouter public paymentRouter;
    uint16 public platformFeeBps;

    mapping(uint256 => address) public universeCreators;

    /// @notice Pending withdrawals for outbid bidders (pull pattern)
    mapping(address => uint256) public pendingWithdrawals;

    event AdSlotCreated(uint256 indexed slotId, uint256 universeId, PlacementType placementType, uint256 minBid);
    event BidPlaced(uint256 indexed slotId, address bidder, uint256 amount);
    event SponsorshipActivated(uint256 indexed sponsorshipId, uint256 slotId, address sponsor);
    event ImpressionRecorded(uint256 indexed sponsorshipId, uint256 totalImpressions);
    event RefundWithdrawn(address indexed bidder, uint256 amount);

    error NotPlatform();
    error NotCreator();
    error BidTooLow();
    error SlotNotActive();
    error NoRevenue();
    error TransferFailed();
    error FeeTooHigh();
    error NoPendingWithdrawal();

    uint16 public constant MAX_FEE_BPS = 5000;

    modifier onlyPlatform() {
        _checkPlatform();
        _;
    }

    function _checkPlatform() internal view {
        if (msg.sender != platform) revert NotPlatform();
    }

    error ZeroAddress();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function initialize(address _platform, address _paymentRouter, uint16 _platformFeeBps) external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        __Pausable_init();
        if (_platform == address(0) || _paymentRouter == address(0)) revert ZeroAddress();
        if (_platformFeeBps > MAX_FEE_BPS) revert FeeTooHigh();
        platform = _platform;
        paymentRouter = IPaymentRouter(_paymentRouter);
        platformFeeBps = _platformFeeBps;
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    event UniverseRegistered(uint256 indexed universeId, address creator);

    /// @notice Register a universe for ad placements
    function registerUniverse(uint256 universeId, address creator) external onlyPlatform {
        if (creator == address(0)) revert ZeroAddress();
        universeCreators[universeId] = creator;
        emit UniverseRegistered(universeId, creator);
    }

    /// @notice Create an ad placement slot
    function createAdSlot(
        uint256 universeId,
        PlacementType placementType,
        uint256 minBid,
        uint256 episodes,
        string calldata metadata
    ) external whenNotPaused returns (uint256 slotId) {
        require(universeCreators[universeId] != address(0), "Universe not registered");
        require(
            msg.sender == universeCreators[universeId] || msg.sender == platform,
            "Not authorized"
        );

        slotId = nextSlotId++;
        adSlots[slotId] = AdSlot({
            id: slotId,
            universeId: universeId,
            placementType: placementType,
            minBid: minBid,
            currentBid: 0,
            currentBidder: address(0),
            metadata: metadata,
            episodesRemaining: episodes,
            active: true
        });

        universeSlots[universeId].push(slotId);
        emit AdSlotCreated(slotId, universeId, placementType, minBid);
    }

    /// @notice Bid on an ad slot. Outbid refunds use pull pattern (withdrawRefund).
    function bid(uint256 slotId) external payable nonReentrant whenNotPaused {
        AdSlot storage slot = adSlots[slotId];
        if (!slot.active) revert SlotNotActive();
        if (msg.value < slot.minBid || msg.value <= slot.currentBid) revert BidTooLow();

        // Credit previous bidder for withdrawal (pull pattern — no external call)
        address previousBidder = slot.currentBidder;
        uint256 previousBid = slot.currentBid;
        if (previousBidder != address(0) && previousBid > 0) {
            pendingWithdrawals[previousBidder] += previousBid;
        }

        slot.currentBid = msg.value;
        slot.currentBidder = msg.sender;

        emit BidPlaced(slotId, msg.sender, msg.value);
    }

    /// @notice Withdraw refund from being outbid (pull pattern)
    function withdrawRefund() external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        if (amount == 0) revert NoPendingWithdrawal();

        pendingWithdrawals[msg.sender] = 0;

        (bool sent,) = msg.sender.call{value: amount}("");
        if (!sent) revert TransferFailed();

        emit RefundWithdrawn(msg.sender, amount);
    }

    /// @notice Accept winning bid and activate sponsorship
    function acceptBid(uint256 slotId) external nonReentrant whenNotPaused returns (uint256 sponsorshipId) {
        AdSlot storage slot = adSlots[slotId];
        require(
            msg.sender == universeCreators[slot.universeId] || msg.sender == platform,
            "Not authorized"
        );
        require(slot.currentBidder != address(0), "No bids");

        // Cache values before clearing state (CEI pattern)
        address bidder = slot.currentBidder;
        uint256 bidAmount = slot.currentBid;
        address creator = universeCreators[slot.universeId];

        // Effects: reset slot state before external calls
        slot.currentBid = 0;
        slot.currentBidder = address(0);

        sponsorshipId = nextSponsorshipId++;
        sponsorships[sponsorshipId] = Sponsorship({
            id: sponsorshipId,
            adSlotId: slotId,
            sponsor: bidder,
            totalPaid: bidAmount,
            impressions: 0,
            startedAt: block.timestamp,
            active: true
        });

        // Interactions: external call after state is settled
        if (bidAmount > 0 && creator != address(0)) {
            paymentRouter.route{value: bidAmount}(creator, platformFeeBps);
        }

        emit SponsorshipActivated(sponsorshipId, slotId, bidder);
    }

    /// @notice Record an ad impression (called by platform per episode)
    function recordImpression(uint256 sponsorshipId) external onlyPlatform {
        Sponsorship storage sp = sponsorships[sponsorshipId];
        sp.impressions++;

        AdSlot storage slot = adSlots[sp.adSlotId];
        if (slot.episodesRemaining > 0) {
            slot.episodesRemaining--;
            if (slot.episodesRemaining == 0) {
                sp.active = false;
            }
        }

        emit ImpressionRecorded(sponsorshipId, sp.impressions);
    }

    /// @notice Get ad slots for a universe
    function getUniverseSlots(uint256 universeId) external view returns (uint256[] memory) {
        return universeSlots[universeId];
    }

    /// @notice Paginated ad slot query
    function getUniverseSlotsPaginated(uint256 universeId, uint256 offset, uint256 limit)
        external view returns (uint256[] memory ids, uint256 total)
    {
        uint256[] storage all = universeSlots[universeId];
        total = all.length;
        if (offset >= total) return (new uint256[](0), total);
        uint256 end = offset + limit;
        if (end > total) end = total;
        ids = new uint256[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            ids[i - offset] = all[i];
        }
    }

    /// @notice Get total slot count for a universe
    function getSlotCount(uint256 universeId) external view returns (uint256) {
        return universeSlots[universeId].length;
    }
}
