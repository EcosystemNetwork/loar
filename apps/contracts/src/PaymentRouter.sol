// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {Initializable} from "@openzeppelin-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin-upgradeable/access/OwnableUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {IPaymentRouter} from "./interfaces/IPaymentRouter.sol";

/// @title PaymentRouter
/// @notice Centralizes all ETH revenue routing across the LOAR platform.
///         Callers (revenue contracts) send ETH here via route(). The platform
///         fee goes immediately to treasury; the creator's cut accrues and is
///         pulled via claim().
///
///         Replaces the scattered platform.call + creator.call patterns in each
///         revenue contract, giving a single place to adjust fees and routing.
contract PaymentRouter is IPaymentRouter, Initializable, UUPSUpgradeable, OwnableUpgradeable, ReentrancyGuardUpgradeable {
    address public treasury;
    uint16 public defaultPlatformFeeBps;

    /// @notice Accumulated ETH per creator, claimable via pull pattern
    mapping(address => uint256) public claimable;

    event PaymentRouted(
        address indexed creator,
        uint256 creatorAmount,
        uint256 platformAmount,
        uint16 feeBps
    );
    event Claimed(address indexed creator, uint256 amount);
    event TreasuryUpdated(address oldTreasury, address newTreasury);
    event DefaultFeeUpdated(uint16 newFeeBps);

    error ZeroAddress();
    error NothingToClaim();
    error TransferFailed();
    error FeeTooHigh();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    /// @param _treasury Receives the platform's fee cut immediately on each route()
    /// @param _defaultPlatformFeeBps Default fee in basis points (e.g. 1000 = 10%)
    function initialize(address _treasury, uint16 _defaultPlatformFeeBps) external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        if (_treasury == address(0)) revert ZeroAddress();
        if (_defaultPlatformFeeBps > 5000) revert FeeTooHigh();
        treasury = _treasury;
        defaultPlatformFeeBps = _defaultPlatformFeeBps;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    /// @dev Sentinel value: pass type(uint16).max to use defaultPlatformFeeBps.
    ///      Pass 0 to explicitly route with zero platform fee.
    uint16 public constant USE_DEFAULT_FEE = type(uint16).max;

    /// @notice Route a payment: send platform cut to treasury, accrue creator's cut
    /// @param creator Address that will be able to claim the creator portion
    /// @param feeBps Platform fee in basis points; pass USE_DEFAULT_FEE to use defaultPlatformFeeBps, 0 for no fee
    function route(address creator, uint16 feeBps) external payable nonReentrant {
        if (msg.value == 0) return;
        uint16 bps = feeBps == USE_DEFAULT_FEE ? defaultPlatformFeeBps : feeBps;
        if (bps > 5000) revert FeeTooHigh();
        uint256 platformCut = (msg.value * bps) / 10_000;
        uint256 creatorCut = msg.value - platformCut;

        if (creatorCut > 0) {
            claimable[creator] += creatorCut;
        }
        if (platformCut > 0) {
            (bool s,) = treasury.call{value: platformCut}("");
            if (!s) revert TransferFailed();
        }

        emit PaymentRouted(creator, creatorCut, platformCut, bps);
    }

    /// @notice Route a payment entirely to treasury (no creator split)
    ///         Used for credit purchases and other platform-only flows.
    function routeToTreasury() external payable nonReentrant {
        if (msg.value == 0) return;
        (bool s,) = treasury.call{value: msg.value}("");
        if (!s) revert TransferFailed();
    }

    /// @notice Creator pulls accumulated earnings
    function claim() external nonReentrant {
        uint256 amount = claimable[msg.sender];
        if (amount == 0) revert NothingToClaim();
        claimable[msg.sender] = 0;
        (bool success,) = msg.sender.call{value: amount}("");
        if (!success) revert TransferFailed();
        emit Claimed(msg.sender, amount);
    }

    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert ZeroAddress();
        emit TreasuryUpdated(treasury, newTreasury);
        treasury = newTreasury;
    }

    function setDefaultFee(uint16 newFeeBps) external onlyOwner {
        if (newFeeBps > 5000) revert FeeTooHigh();
        defaultPlatformFeeBps = newFeeBps;
        emit DefaultFeeUpdated(newFeeBps);
    }
}
