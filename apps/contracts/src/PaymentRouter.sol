// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {ReentrancyGuard} from "@openzeppelin/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/access/Ownable.sol";
import {IPaymentRouter} from "./interfaces/IPaymentRouter.sol";

/// @title PaymentRouter
/// @notice Centralizes all ETH revenue routing across the LOAR platform.
///         Callers (revenue contracts) send ETH here via route(). The platform
///         fee goes immediately to treasury; the creator's cut accrues and is
///         pulled via claim().
///
///         Replaces the scattered platform.call + creator.call patterns in each
///         revenue contract, giving a single place to adjust fees and routing.
contract PaymentRouter is IPaymentRouter, ReentrancyGuard, Ownable {
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

    /// @param _treasury Receives the platform's fee cut immediately on each route()
    /// @param _defaultPlatformFeeBps Default fee in basis points (e.g. 1000 = 10%)
    constructor(address _treasury, uint16 _defaultPlatformFeeBps) Ownable(msg.sender) {
        if (_treasury == address(0)) revert ZeroAddress();
        if (_defaultPlatformFeeBps > 5000) revert FeeTooHigh();
        treasury = _treasury;
        defaultPlatformFeeBps = _defaultPlatformFeeBps;
    }

    /// @notice Route a payment: send platform cut to treasury, accrue creator's cut
    /// @param creator Address that will be able to claim the creator portion
    /// @param feeBps Platform fee in basis points; pass 0 to use defaultPlatformFeeBps
    function route(address creator, uint16 feeBps) external payable nonReentrant {
        if (msg.value == 0) return;
        if (feeBps > 5000) revert FeeTooHigh();
        uint16 bps = feeBps == 0 ? defaultPlatformFeeBps : feeBps;
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
