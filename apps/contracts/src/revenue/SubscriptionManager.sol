// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Initializable} from "@openzeppelin-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin-upgradeable/access/OwnableUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin-upgradeable/utils/PausableUpgradeable.sol";
import {IPaymentRouter} from "../interfaces/IPaymentRouter.sol";

/// @title SubscriptionManager
/// @notice Manages subscriptions to universes. Subscribers get early episodes,
///         voting rights, premium content, and behind-the-scenes access.
contract SubscriptionManager is Initializable, UUPSUpgradeable, OwnableUpgradeable, ReentrancyGuardUpgradeable, PausableUpgradeable {
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
    address public platform;
    IPaymentRouter public paymentRouter;
    uint16 public platformFeeBps;

    // Universe creator receives revenue
    mapping(uint256 => address) public universeCreators;

    event TierConfigured(uint256 indexed universeId, SubscriptionTier tier, uint256 pricePerMonth);
    event TierDeactivated(uint256 indexed universeId, SubscriptionTier tier);
    event Subscribed(address indexed user, uint256 indexed universeId, SubscriptionTier tier, uint256 expiresAt);
    event SubscriptionRenewed(address indexed user, uint256 indexed universeId, uint256 newExpiry);
    event SubscriptionCancelled(address indexed user, uint256 indexed universeId);

    error InvalidTier();
    error InsufficientPayment();
    error TierNotActive();
    error NotPlatform();
    error NotCreator();
    error AlreadySubscribed();
    error NoActiveSubscription();
    error NoRevenue();
    error TransferFailed();
    error FeeTooHigh();

    uint16 public constant MAX_FEE_BPS = 5000;

    modifier onlyPlatform() {
        _checkPlatform();
        _;
    }

    function _checkPlatform() internal view {
        if (msg.sender != platform) revert NotPlatform();
    }

    error ZeroAddress();
    error MonthsTooHigh();
    error CreatorNotRegistered();
    error RefundFailed();

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

    error NotAuthorized();

    /// @notice Deactivate a subscription tier
    function deactivateTier(uint256 universeId, SubscriptionTier tier) external {
        if (msg.sender != universeCreators[universeId] && msg.sender != platform) revert NotAuthorized();
        tierConfigs[universeId][tier].active = false;
        emit TierDeactivated(universeId, tier);
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
        if (msg.sender != universeCreators[universeId] && msg.sender != platform) revert NotAuthorized();

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

    event UniverseRegistered(uint256 indexed universeId, address creator);

    /// @notice Register a universe creator
    function registerUniverse(uint256 universeId, address creator) external onlyPlatform {
        if (creator == address(0)) revert ZeroAddress();
        universeCreators[universeId] = creator;
        emit UniverseRegistered(universeId, creator);
    }

    /// @notice Subscribe to a universe tier
    function subscribe(uint256 universeId, SubscriptionTier tier, uint256 months) external payable nonReentrant whenNotPaused {
        if (months == 0 || months > 120) revert MonthsTooHigh(); // max 10 years
        TierConfig storage config = tierConfigs[universeId][tier];
        if (!config.active) revert TierNotActive();

        address creator = universeCreators[universeId];
        if (creator == address(0)) revert CreatorNotRegistered();

        uint256 totalPrice = config.pricePerMonth * months;
        if (msg.value < totalPrice) revert InsufficientPayment();

        Subscription storage sub = subscriptions[msg.sender][universeId];

        uint256 startTime = block.timestamp;
        if (sub.expiresAt > block.timestamp) {
            // Extend existing subscription — still active
            startTime = sub.expiresAt;
            // If changing tiers on an active subscription, adjust counts
            if (sub.tier != tier) {
                if (subscriberCount[universeId][sub.tier] > 0) {
                    subscriberCount[universeId][sub.tier]--;
                }
                subscriberCount[universeId][tier]++;
            }
        } else if (sub.expiresAt > 0) {
            // Previous subscription expired — safe decrement (guard underflow)
            if (subscriberCount[universeId][sub.tier] > 0) {
                subscriberCount[universeId][sub.tier]--;
            }
            subscriberCount[universeId][tier]++;
        } else {
            // Brand new subscriber
            subscriberCount[universeId][tier]++;
        }

        uint256 expiry = startTime + (months * 30 days);

        // Read startedAt before overwriting — sub is a storage ref to the same slot
        uint256 preservedStartedAt = sub.startedAt;

        subscriptions[msg.sender][universeId] = Subscription({
            universeId: universeId,
            tier: tier,
            startedAt: preservedStartedAt == 0 ? block.timestamp : preservedStartedAt,
            expiresAt: expiry,
            autoRenew: true
        });

        // Route only totalPrice through PaymentRouter (not full msg.value)
        if (totalPrice > 0) {
            paymentRouter.route{value: totalPrice}(creator, platformFeeBps);
        }

        // Refund overpayment
        uint256 overpaid = msg.value - totalPrice;
        if (overpaid > 0) {
            (bool ok,) = msg.sender.call{value: overpaid}("");
            if (!ok) revert RefundFailed();
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
