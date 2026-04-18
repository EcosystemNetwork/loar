// SPDX-License-Identifier: MIT
pragma solidity =0.8.30;

import {Initializable} from "@openzeppelin-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin-upgradeable/access/OwnableUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin-upgradeable/utils/PausableUpgradeable.sol";

/// @title AnalyticsRegistry
/// @notice On-chain analytics for story engagement data. Records what stories
///         people like, trending characters, and engaging arcs. This data is
///         valuable for training story AIs and for studios.
contract AnalyticsRegistry is Initializable, UUPSUpgradeable, OwnableUpgradeable, PausableUpgradeable {
    struct UniverseMetrics {
        uint256 totalViews;
        uint256 totalMints;
        uint256 totalVotes;
        uint256 totalSubscribers;
        uint256 totalRevenue;
        uint256 lastUpdated;
    }

    struct EpisodeMetrics {
        uint256 views;
        uint256 mints;
        uint256 likes;
        uint256 shares;
    }

    struct CharacterMetrics {
        uint256 appearances;
        uint256 votes;
        uint256 popularity;        // composite score
    }

    // universeId => metrics
    mapping(uint256 => UniverseMetrics) public universeMetrics;
    // universeId => episodeId => metrics
    mapping(uint256 => mapping(uint256 => EpisodeMetrics)) public episodeMetrics;
    // universeId => characterId => metrics
    mapping(uint256 => mapping(uint256 => CharacterMetrics)) public characterMetrics;

    // Trending: top universes by recent activity
    uint256[] public trendingUniverseIds;

    address public platform;

    event UniverseMetricsUpdated(uint256 indexed universeId, uint256 totalViews, uint256 totalMints, uint256 totalRevenue);
    event EpisodeViewed(uint256 indexed universeId, uint256 indexed episodeId, uint256 totalViews);
    event CharacterTrending(uint256 indexed universeId, uint256 indexed characterId, uint256 popularity);
    event DataExportRequested(address indexed requester, uint256 universeId, uint256 timestamp);
    event MintRecorded(uint256 indexed universeId, uint256 indexed episodeId, uint256 totalMints);
    event EngagementRecorded(uint256 indexed universeId, uint256 indexed episodeId, bool isLike);
    event SubscriberUpdated(uint256 indexed universeId, bool added, uint256 totalSubscribers);
    event VoteRecorded(uint256 indexed universeId, uint256 totalVotes);
    event TrendingUpdated(uint256[] universeIds);

    error NotPlatform();

    modifier onlyPlatform() {
        _checkPlatform();
        _;
    }

    function _checkPlatform() internal view {
        if (msg.sender != platform) revert NotPlatform();
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function initialize(address _platform) external initializer {
        require(_platform != address(0), "Zero address");
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __Pausable_init();
        platform = _platform;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    /// @notice Record a view on an episode
    function recordView(uint256 universeId, uint256 episodeId) external onlyPlatform whenNotPaused {
        episodeMetrics[universeId][episodeId].views++;
        universeMetrics[universeId].totalViews++;
        universeMetrics[universeId].lastUpdated = block.timestamp;

        emit EpisodeViewed(universeId, episodeId, episodeMetrics[universeId][episodeId].views);
    }

    /// @notice Record an episode mint
    function recordMint(uint256 universeId, uint256 episodeId) external onlyPlatform whenNotPaused {
        episodeMetrics[universeId][episodeId].mints++;
        universeMetrics[universeId].totalMints++;
        universeMetrics[universeId].lastUpdated = block.timestamp;

        emit MintRecorded(universeId, episodeId, universeMetrics[universeId].totalMints);
    }

    /// @notice Record engagement (like/share)
    function recordEngagement(uint256 universeId, uint256 episodeId, bool isLike) external onlyPlatform whenNotPaused {
        if (isLike) {
            episodeMetrics[universeId][episodeId].likes++;
        } else {
            episodeMetrics[universeId][episodeId].shares++;
        }

        emit EngagementRecorded(universeId, episodeId, isLike);
    }

    /// @notice Update character popularity
    function updateCharacterPopularity(
        uint256 universeId,
        uint256 characterId,
        uint256 newAppearances,
        uint256 newVotes
    ) external onlyPlatform whenNotPaused {
        CharacterMetrics storage cm = characterMetrics[universeId][characterId];
        cm.appearances += newAppearances;
        cm.votes += newVotes;
        cm.popularity = (cm.appearances * 3) + (cm.votes * 2); // weighted score

        emit CharacterTrending(universeId, characterId, cm.popularity);
    }

    /// @notice Update universe revenue metrics
    function recordRevenue(uint256 universeId, uint256 amount) external onlyPlatform whenNotPaused {
        universeMetrics[universeId].totalRevenue += amount;
        universeMetrics[universeId].lastUpdated = block.timestamp;

        emit UniverseMetricsUpdated(
            universeId,
            universeMetrics[universeId].totalViews,
            universeMetrics[universeId].totalMints,
            universeMetrics[universeId].totalRevenue
        );
    }

    /// @notice Update subscriber count
    function recordSubscriber(uint256 universeId, bool added) external onlyPlatform whenNotPaused {
        if (added) {
            universeMetrics[universeId].totalSubscribers++;
        } else if (universeMetrics[universeId].totalSubscribers > 0) {
            universeMetrics[universeId].totalSubscribers--;
        }

        emit SubscriberUpdated(universeId, added, universeMetrics[universeId].totalSubscribers);
    }

    /// @notice Record vote activity
    function recordVote(uint256 universeId) external onlyPlatform whenNotPaused {
        universeMetrics[universeId].totalVotes++;

        emit VoteRecorded(universeId, universeMetrics[universeId].totalVotes);
    }

    uint256 public constant MAX_TRENDING = 100;

    /// @notice Set trending universes. Capped at 100.
    /// @dev ANALYTICS-01: "Trending" is PLATFORM-CURATED, not algorithmic. The `platform`
    ///      address publishes the list computed off-chain. Consumers should treat this as
    ///      an editorial signal, not a neutral ranking. Transparency is enforced by the
    ///      `TrendingUpdated(ids)` event and the `onlyPlatform` gate.
    function setTrending(uint256[] calldata universeIds) external onlyPlatform whenNotPaused {
        require(universeIds.length <= MAX_TRENDING, "Too many trending");
        trendingUniverseIds = universeIds;

        emit TrendingUpdated(universeIds);
    }

    /// @notice Request data export (emits event for off-chain processing)
    function requestDataExport(uint256 universeId) external whenNotPaused {
        emit DataExportRequested(msg.sender, universeId, block.timestamp);
    }

    /// @notice Get trending universe IDs
    function getTrending() external view returns (uint256[] memory) {
        return trendingUniverseIds;
    }

    /// @dev Reserved storage gap for future upgrades
    uint256[49] private __gap;
}
