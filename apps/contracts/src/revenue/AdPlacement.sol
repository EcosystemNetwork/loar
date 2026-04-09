// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {Initializable} from "@openzeppelin-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin-upgradeable/access/OwnableUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {IPaymentRouter} from "../interfaces/IPaymentRouter.sol";

/// @title AdPlacement
/// @notice Manages programmatic product placement and sponsorships inside
///         AI-generated episodes. Sponsors bid for placement slots.
contract AdPlacement is Initializable, UUPSUpgradeable, OwnableUpgradeable, ReentrancyGuardUpgradeable {
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

    event AdSlotCreated(uint256 indexed slotId, uint256 universeId, PlacementType placementType, uint256 minBid);
    event BidPlaced(uint256 indexed slotId, address bidder, uint256 amount);
    event SponsorshipActivated(uint256 indexed sponsorshipId, uint256 slotId, address sponsor);
    event ImpressionRecorded(uint256 indexed sponsorshipId, uint256 totalImpressions);

    error NotPlatform();
    error NotCreator();
    error BidTooLow();
    error SlotNotActive();
    error NoRevenue();
    error TransferFailed();
    error FeeTooHigh();

    uint16 public constant MAX_FEE_BPS = 5000;

    modifier onlyPlatform() {
        if (msg.sender != platform) revert NotPlatform();
        _;
    }

    error ZeroAddress();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function initialize(address _platform, address _paymentRouter, uint16 _platformFeeBps) external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        if (_platform == address(0) || _paymentRouter == address(0)) revert ZeroAddress();
        if (_platformFeeBps > MAX_FEE_BPS) revert FeeTooHigh();
        platform = _platform;
        paymentRouter = IPaymentRouter(_paymentRouter);
        platformFeeBps = _platformFeeBps;
    }

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
    ) external returns (uint256 slotId) {
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

    /// @notice Bid on an ad slot (checks-effects-interactions safe)
    function bid(uint256 slotId) external payable nonReentrant {
        AdSlot storage slot = adSlots[slotId];
        if (!slot.active) revert SlotNotActive();
        if (msg.value < slot.minBid || msg.value <= slot.currentBid) revert BidTooLow();

        // Cache previous bidder for refund (effects before interactions)
        address previousBidder = slot.currentBidder;
        uint256 previousBid = slot.currentBid;

        // Update state BEFORE external call
        slot.currentBid = msg.value;
        slot.currentBidder = msg.sender;

        // Refund previous bidder (interaction after state update)
        if (previousBidder != address(0) && previousBid > 0) {
            (bool refund,) = previousBidder.call{value: previousBid}("");
            if (!refund) revert TransferFailed();
        }

        emit BidPlaced(slotId, msg.sender, msg.value);
    }

    /// @notice Accept winning bid and activate sponsorship
    function acceptBid(uint256 slotId) external nonReentrant returns (uint256 sponsorshipId) {
        AdSlot storage slot = adSlots[slotId];
        require(
            msg.sender == universeCreators[slot.universeId] || msg.sender == platform,
            "Not authorized"
        );
        require(slot.currentBidder != address(0), "No bids");

        // Cache values for use after state reset (CEI)
        address winner = slot.currentBidder;
        uint256 winningBid = slot.currentBid;
        address creator = universeCreators[slot.universeId];

        sponsorshipId = nextSponsorshipId++;
        sponsorships[sponsorshipId] = Sponsorship({
            id: sponsorshipId,
            adSlotId: slotId,
            sponsor: winner,
            totalPaid: winningBid,
            impressions: 0,
            startedAt: block.timestamp,
            active: true
        });

        // Reset slot state BEFORE external call (checks-effects-interactions)
        slot.currentBid = 0;
        slot.currentBidder = address(0);

        // Route revenue through PaymentRouter (external call last)
        if (winningBid > 0 && creator != address(0)) {
            paymentRouter.route{value: winningBid}(creator, platformFeeBps);
        }

        emit SponsorshipActivated(sponsorshipId, slotId, winner);
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
}
