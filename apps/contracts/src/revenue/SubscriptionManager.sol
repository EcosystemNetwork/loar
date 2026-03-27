// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {ReentrancyGuard} from "@openzeppelin/utils/ReentrancyGuard.sol";

/// @title SubscriptionManager
/// @notice Manages subscriptions to universes. Subscribers get early episodes,
///         voting rights, premium content, and behind-the-scenes access.
contract SubscriptionManager is ReentrancyGuard {
    enum SubscriptionTier { FREE, BASIC, PREMIUM, VIP }

    struct TierConfig {
        uint256 pricePerMonth;     // in wei
        bool earlyAccess;
        bool votingBoost;
        bool premiumContent;
        bool behindTheScenes;
        uint16 creditBonus;        // bonus credits per month
        bool active;
    }

    struct Subscription {
        uint256 universeId;
        SubscriptionTier tier;
        uint256 startedAt;
        uint256 expiresAt;
        bool autoRenew;
    }

    // universeId => tier => config
    mapping(uint256 => mapping(SubscriptionTier => TierConfig)) public tierConfigs;
    // user => universeId => subscription
    mapping(address => mapping(uint256 => Subscription)) public subscriptions;
    // universeId => subscriber count per tier
    mapping(uint256 => mapping(SubscriptionTier => uint256)) public subscriberCount;
    // universeId => total revenue
    mapping(uint256 => uint256) public universeRevenue;

    address public platform;
    uint16 public platformFeeBps;

    // Universe creator receives revenue
    mapping(uint256 => address) public universeCreators;

    event TierConfigured(uint256 indexed universeId, SubscriptionTier tier, uint256 pricePerMonth);
    event Subscribed(address indexed user, uint256 indexed universeId, SubscriptionTier tier, uint256 expiresAt);
    event SubscriptionRenewed(address indexed user, uint256 indexed universeId, uint256 newExpiry);
    event SubscriptionCancelled(address indexed user, uint256 indexed universeId);
    event RevenueWithdrawn(uint256 indexed universeId, address creator, uint256 amount);

    error InvalidTier();
    error InsufficientPayment();
    error TierNotActive();
    error NotPlatform();
    error NotCreator();
    error AlreadySubscribed();
    error NoActiveSubscription();
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

    /// @notice Configure a subscription tier for a universe
    function configureTier(
        uint256 universeId,
        SubscriptionTier tier,
        uint256 pricePerMonth,
        bool earlyAccess,
        bool votingBoost,
        bool premiumContent,
        bool behindTheScenes,
        uint16 creditBonus
    ) external {
        // Must be universe creator or platform
        require(
            msg.sender == universeCreators[universeId] || msg.sender == platform,
            "Not authorized"
        );

        tierConfigs[universeId][tier] = TierConfig({
            pricePerMonth: pricePerMonth,
            earlyAccess: earlyAccess,
            votingBoost: votingBoost,
            premiumContent: premiumContent,
            behindTheScenes: behindTheScenes,
            creditBonus: creditBonus,
            active: true
        });

        emit TierConfigured(universeId, tier, pricePerMonth);
    }

    /// @notice Register a universe creator
    function registerUniverse(uint256 universeId, address creator) external onlyPlatform {
        universeCreators[universeId] = creator;
    }

    /// @notice Subscribe to a universe tier
    function subscribe(uint256 universeId, SubscriptionTier tier, uint256 months) external payable nonReentrant {
        TierConfig storage config = tierConfigs[universeId][tier];
        if (!config.active) revert TierNotActive();

        uint256 totalPrice = config.pricePerMonth * months;
        if (msg.value < totalPrice) revert InsufficientPayment();

        Subscription storage sub = subscriptions[msg.sender][universeId];

        uint256 startTime = block.timestamp;
        if (sub.expiresAt > block.timestamp) {
            // Extend existing subscription
            startTime = sub.expiresAt;
        } else if (sub.expiresAt > 0) {
            // Previous subscription expired, decrement old tier count
            subscriberCount[universeId][sub.tier]--;
        }

        uint256 expiry = startTime + (months * 30 days);

        subscriptions[msg.sender][universeId] = Subscription({
            universeId: universeId,
            tier: tier,
            startedAt: sub.startedAt == 0 ? block.timestamp : sub.startedAt,
            expiresAt: expiry,
            autoRenew: true
        });

        if (sub.expiresAt == 0 || sub.expiresAt <= block.timestamp) {
            subscriberCount[universeId][tier]++;
        }

        // Revenue split
        uint256 platformCut = (msg.value * platformFeeBps) / 10000;
        uint256 creatorCut = msg.value - platformCut;
        universeRevenue[universeId] += creatorCut;

        if (platformCut > 0) {
            (bool s,) = platform.call{value: platformCut}("");
            if (!s) revert TransferFailed();
        }

        emit Subscribed(msg.sender, universeId, tier, expiry);
    }

    /// @notice Cancel auto-renewal
    function cancelSubscription(uint256 universeId) external {
        Subscription storage sub = subscriptions[msg.sender][universeId];
        if (sub.expiresAt == 0) revert NoActiveSubscription();
        sub.autoRenew = false;
        emit SubscriptionCancelled(msg.sender, universeId);
    }

    /// @notice Universe creator withdraws accumulated revenue
    function withdrawRevenue(uint256 universeId) external nonReentrant {
        if (msg.sender != universeCreators[universeId]) revert NotCreator();
        uint256 amount = universeRevenue[universeId];
        if (amount == 0) revert NoRevenue();

        universeRevenue[universeId] = 0;
        (bool success,) = msg.sender.call{value: amount}("");
        if (!success) revert TransferFailed();

        emit RevenueWithdrawn(universeId, msg.sender, amount);
    }

    /// @notice Check if user has active subscription at or above a tier
    function hasAccess(address user, uint256 universeId, SubscriptionTier minTier) external view returns (bool) {
        Subscription storage sub = subscriptions[user][universeId];
        return sub.expiresAt > block.timestamp && uint8(sub.tier) >= uint8(minTier);
    }

    /// @notice Get subscription details
    function getSubscription(address user, uint256 universeId) external view returns (
        SubscriptionTier tier,
        uint256 expiresAt,
        bool active,
        bool autoRenew
    ) {
        Subscription storage sub = subscriptions[user][universeId];
        return (
            sub.tier,
            sub.expiresAt,
            sub.expiresAt > block.timestamp,
            sub.autoRenew
        );
    }
}
