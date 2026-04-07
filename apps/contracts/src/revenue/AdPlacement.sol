// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {ReentrancyGuard} from "@openzeppelin/utils/ReentrancyGuard.sol";

/// @title AdPlacement
/// @notice Manages programmatic product placement and sponsorships inside
///         AI-generated episodes. Sponsors bid for placement slots.
contract AdPlacement is ReentrancyGuard {
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
    uint16 public platformFeeBps;

    // Universe creator revenue from ads
    mapping(uint256 => uint256) public adRevenue;
    mapping(uint256 => address) public universeCreators;

    event AdSlotCreated(uint256 indexed slotId, uint256 universeId, PlacementType placementType, uint256 minBid);
    event BidPlaced(uint256 indexed slotId, address bidder, uint256 amount);
    event SponsorshipActivated(uint256 indexed sponsorshipId, uint256 slotId, address sponsor);
    event ImpressionRecorded(uint256 indexed sponsorshipId, uint256 totalImpressions);
    event AdRevenueWithdrawn(uint256 indexed universeId, address creator, uint256 amount);

    error NotPlatform();
    error NotCreator();
    error BidTooLow();
    error SlotNotActive();
    error NoRevenue();
    error TransferFailed();

    modifier onlyPlatform() {
        if (msg.sender != platform) revert NotPlatform();
        _;
    }

    constructor(address _platform, uint16 _platformFeeBps) {
        platform = _platform;
        platformFeeBps = _platformFeeBps;
    }

    /// @notice Register a universe for ad placements
    function registerUniverse(uint256 universeId, address creator) external onlyPlatform {
        universeCreators[universeId] = creator;
    }

    /// @notice Create an ad placement slot
    function createAdSlot(
        uint256 universeId,
        PlacementType placementType,
        uint256 minBid,
        uint256 episodes,
        string calldata metadata
    ) external returns (uint256 slotId) {
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

    /// @notice Bid on an ad slot
    function bid(uint256 slotId) external payable nonReentrant {
        AdSlot storage slot = adSlots[slotId];
        if (!slot.active) revert SlotNotActive();
        if (msg.value < slot.minBid || msg.value <= slot.currentBid) revert BidTooLow();

        // Refund previous bidder
        if (slot.currentBidder != address(0)) {
            (bool refund,) = slot.currentBidder.call{value: slot.currentBid}("");
            if (!refund) revert TransferFailed();
        }

        slot.currentBid = msg.value;
        slot.currentBidder = msg.sender;

        emit BidPlaced(slotId, msg.sender, msg.value);
    }

    /// @notice Accept winning bid and activate sponsorship
    function acceptBid(uint256 slotId) external returns (uint256 sponsorshipId) {
        AdSlot storage slot = adSlots[slotId];
        require(
            msg.sender == universeCreators[slot.universeId] || msg.sender == platform,
            "Not authorized"
        );
        require(slot.currentBidder != address(0), "No bids");

        sponsorshipId = nextSponsorshipId++;
        sponsorships[sponsorshipId] = Sponsorship({
            id: sponsorshipId,
            adSlotId: slotId,
            sponsor: slot.currentBidder,
            totalPaid: slot.currentBid,
            impressions: 0,
            startedAt: block.timestamp,
            active: true
        });

        // Revenue split
        uint256 platformCut = (slot.currentBid * platformFeeBps) / 10000;
        uint256 creatorCut = slot.currentBid - platformCut;
        adRevenue[slot.universeId] += creatorCut;

        if (platformCut > 0) {
            (bool s,) = platform.call{value: platformCut}("");
            if (!s) revert TransferFailed();
        }

        // Reset slot for next round
        slot.currentBid = 0;
        slot.currentBidder = address(0);

        emit SponsorshipActivated(sponsorshipId, slotId, sponsorships[sponsorshipId].sponsor);
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

    /// @notice Universe creator withdraws ad revenue
    function withdrawAdRevenue(uint256 universeId) external nonReentrant {
        if (msg.sender != universeCreators[universeId]) revert NotCreator();
        uint256 amount = adRevenue[universeId];
        if (amount == 0) revert NoRevenue();

        adRevenue[universeId] = 0;
        (bool success,) = msg.sender.call{value: amount}("");
        if (!success) revert TransferFailed();

        emit AdRevenueWithdrawn(universeId, msg.sender, amount);
    }

    /// @notice Get ad slots for a universe
    function getUniverseSlots(uint256 universeId) external view returns (uint256[] memory) {
        return universeSlots[universeId];
    }
}
