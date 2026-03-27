// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

/// @title AnalyticsRegistry
/// @notice On-chain analytics for story engagement data. Records what stories
///         people like, trending characters, and engaging arcs. This data is
///         valuable for training story AIs and for studios.
contract AnalyticsRegistry {
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

    error NotPlatform();

    modifier onlyPlatform() {
        if (msg.sender != platform) revert NotPlatform();
        _;
    }

    constructor(address _platform) {
        platform = _platform;
    }

    /// @notice Record a view on an episode
    function recordView(uint256 universeId, uint256 episodeId) external onlyPlatform {
        episodeMetrics[universeId][episodeId].views++;
        universeMetrics[universeId].totalViews++;
        universeMetrics[universeId].lastUpdated = block.timestamp;

        emit EpisodeViewed(universeId, episodeId, episodeMetrics[universeId][episodeId].views);
    }

    /// @notice Record an episode mint
    function recordMint(uint256 universeId, uint256 episodeId) external onlyPlatform {
        episodeMetrics[universeId][episodeId].mints++;
        universeMetrics[universeId].totalMints++;
        universeMetrics[universeId].lastUpdated = block.timestamp;
    }

    /// @notice Record engagement (like/share)
    function recordEngagement(uint256 universeId, uint256 episodeId, bool isLike) external onlyPlatform {
        if (isLike) {
            episodeMetrics[universeId][episodeId].likes++;
        } else {
            episodeMetrics[universeId][episodeId].shares++;
        }
    }

    /// @notice Update character popularity
    function updateCharacterPopularity(
        uint256 universeId,
        uint256 characterId,
        uint256 newAppearances,
        uint256 newVotes
    ) external onlyPlatform {
        CharacterMetrics storage cm = characterMetrics[universeId][characterId];
        cm.appearances += newAppearances;
        cm.votes += newVotes;
        cm.popularity = (cm.appearances * 3) + (cm.votes * 2); // weighted score

        emit CharacterTrending(universeId, characterId, cm.popularity);
    }

    /// @notice Update universe revenue metrics
    function recordRevenue(uint256 universeId, uint256 amount) external onlyPlatform {
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
    function recordSubscriber(uint256 universeId, bool added) external onlyPlatform {
        if (added) {
            universeMetrics[universeId].totalSubscribers++;
        } else if (universeMetrics[universeId].totalSubscribers > 0) {
            universeMetrics[universeId].totalSubscribers--;
        }
    }

    /// @notice Record vote activity
    function recordVote(uint256 universeId) external onlyPlatform {
        universeMetrics[universeId].totalVotes++;
    }

    /// @notice Set trending universes (computed off-chain, stored on-chain)
    function setTrending(uint256[] calldata universeIds) external onlyPlatform {
        trendingUniverseIds = universeIds;
    }

    /// @notice Request data export (emits event for off-chain processing)
    function requestDataExport(uint256 universeId) external {
        emit DataExportRequested(msg.sender, universeId, block.timestamp);
    }

    /// @notice Get trending universe IDs
    function getTrending() external view returns (uint256[] memory) {
        return trendingUniverseIds;
    }
}
