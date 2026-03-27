// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {ReentrancyGuard} from "@openzeppelin/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/interfaces/IERC20.sol";

/// @title CreditManager
/// @notice Manages AI generation credits. Users purchase credits to generate
///         side stories, spinoffs, and fan episodes within universes.
contract CreditManager is ReentrancyGuard {
    struct CreditTier {
        uint256 id;
        string name;
        uint256 credits;
        uint256 priceWei;
        bool active;
    }

    struct UserCredits {
        uint256 balance;
        uint256 totalPurchased;
        uint256 totalSpent;
    }

    uint256 public nextTierId;

    mapping(uint256 => CreditTier) public tiers;
    mapping(address => UserCredits) public userCredits;

    // Universe token holders get discount
    mapping(address => uint16) public holderDiscountBps; // token => discount bps

    address public platform;
    address public treasury;

    // Credit costs per generation type
    uint256 public imageGenerationCost = 1;
    uint256 public videoGenerationCost = 5;
    uint256 public storyGenerationCost = 2;
    uint256 public spinoffGenerationCost = 10;

    event TierCreated(uint256 indexed tierId, string name, uint256 credits, uint256 priceWei);
    event CreditsPurchased(address indexed user, uint256 tierId, uint256 credits, uint256 paid);
    event CreditsSpent(address indexed user, uint256 amount, string generationType, uint256 universeId);
    event CreditsGranted(address indexed user, uint256 amount, string reason);

    error InsufficientCredits();
    error InsufficientPayment();
    error TierNotActive();
    error NotPlatform();
    error TransferFailed();

    modifier onlyPlatform() {
        if (msg.sender != platform) revert NotPlatform();
        _;
    }

    constructor(address _platform, address _treasury) {
        platform = _platform;
        treasury = _treasury;
    }

    /// @notice Create a credit purchase tier
    function createTier(
        string calldata name,
        uint256 credits,
        uint256 priceWei
    ) external onlyPlatform returns (uint256 tierId) {
        tierId = nextTierId++;
        tiers[tierId] = CreditTier({
            id: tierId,
            name: name,
            credits: credits,
            priceWei: priceWei,
            active: true
        });
        emit TierCreated(tierId, name, credits, priceWei);
    }

    /// @notice Purchase credits from a tier
    function purchaseCredits(uint256 tierId) external payable nonReentrant {
        CreditTier storage tier = tiers[tierId];
        if (!tier.active) revert TierNotActive();

        uint256 price = tier.priceWei;

        // Apply holder discount if applicable
        // (caller can hold any recognized universe token)
        // Discount is checked off-chain and applied via discounted tier

        if (msg.value < price) revert InsufficientPayment();

        userCredits[msg.sender].balance += tier.credits;
        userCredits[msg.sender].totalPurchased += tier.credits;

        (bool success,) = treasury.call{value: msg.value}("");
        if (!success) revert TransferFailed();

        emit CreditsPurchased(msg.sender, tierId, tier.credits, msg.value);
    }

    /// @notice Spend credits for AI generation (called by platform)
    function spendCredits(
        address user,
        uint256 amount,
        string calldata generationType,
        uint256 universeId
    ) external onlyPlatform {
        if (userCredits[user].balance < amount) revert InsufficientCredits();

        userCredits[user].balance -= amount;
        userCredits[user].totalSpent += amount;

        emit CreditsSpent(user, amount, generationType, universeId);
    }

    /// @notice Grant free credits (rewards, promotions)
    function grantCredits(
        address user,
        uint256 amount,
        string calldata reason
    ) external onlyPlatform {
        userCredits[user].balance += amount;
        userCredits[user].totalPurchased += amount;

        emit CreditsGranted(user, amount, reason);
    }

    /// @notice Set holder discount for a universe token
    function setHolderDiscount(address token, uint16 discountBps) external onlyPlatform {
        holderDiscountBps[token] = discountBps;
    }

    /// @notice Update generation costs
    function setGenerationCosts(
        uint256 _image,
        uint256 _video,
        uint256 _story,
        uint256 _spinoff
    ) external onlyPlatform {
        imageGenerationCost = _image;
        videoGenerationCost = _video;
        storyGenerationCost = _story;
        spinoffGenerationCost = _spinoff;
    }

    /// @notice Deactivate a tier
    function deactivateTier(uint256 tierId) external onlyPlatform {
        tiers[tierId].active = false;
    }

    /// @notice Get user credit balance
    function getBalance(address user) external view returns (uint256) {
        return userCredits[user].balance;
    }

    /// @notice Get generation cost by type
    function getGenerationCost(string calldata genType) external view returns (uint256) {
        bytes32 h = keccak256(abi.encodePacked(genType));
        if (h == keccak256("image")) return imageGenerationCost;
        if (h == keccak256("video")) return videoGenerationCost;
        if (h == keccak256("story")) return storyGenerationCost;
        if (h == keccak256("spinoff")) return spinoffGenerationCost;
        return 0;
    }
}
