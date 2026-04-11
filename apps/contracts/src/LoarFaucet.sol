// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {IERC20} from "@openzeppelin/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/access/Ownable.sol";

/// @title LoarFaucet — Testnet $LOAR token faucet
/// @notice Allows users to claim a fixed amount of $LOAR per cooldown period.
///         Intended for testnet use only so users can try credit purchases.
contract LoarFaucet is Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable loarToken;

    /// @notice Amount of $LOAR dispensed per claim (default: 1000 tokens)
    uint256 public claimAmount = 1_000 * 1e18;

    /// @notice Cooldown between claims per address (default: 24 hours)
    uint256 public cooldown = 24 hours;

    /// @notice Last claim timestamp per address
    mapping(address => uint256) public lastClaimed;

    event Claimed(address indexed user, uint256 amount);
    event ClaimAmountUpdated(uint256 oldAmount, uint256 newAmount);
    event CooldownUpdated(uint256 oldCooldown, uint256 newCooldown);
    event Drained(address indexed to, uint256 amount);

    error CooldownNotElapsed(uint256 availableAt);
    error InsufficientFaucetBalance();

    constructor(address _loarToken) Ownable(msg.sender) {
        loarToken = IERC20(_loarToken);
    }

    /// @notice Claim $LOAR tokens from the faucet
    function claim() external {
        uint256 nextClaimAt = lastClaimed[msg.sender] + cooldown;
        if (block.timestamp < nextClaimAt) {
            revert CooldownNotElapsed(nextClaimAt);
        }

        uint256 balance = loarToken.balanceOf(address(this));
        if (balance < claimAmount) {
            revert InsufficientFaucetBalance();
        }

        lastClaimed[msg.sender] = block.timestamp;
        loarToken.safeTransfer(msg.sender, claimAmount);

        emit Claimed(msg.sender, claimAmount);
    }

    /// @notice Check if an address can claim right now
    function canClaim(address user) external view returns (bool ok, uint256 availableAt) {
        uint256 nextClaimAt = lastClaimed[user] + cooldown;
        if (block.timestamp >= nextClaimAt && loarToken.balanceOf(address(this)) >= claimAmount) {
            return (true, 0);
        }
        return (false, nextClaimAt);
    }

    /// @notice Faucet balance
    function faucetBalance() external view returns (uint256) {
        return loarToken.balanceOf(address(this));
    }

    // ── Owner controls ──────────────────────────────────────────────

    function setClaimAmount(uint256 newAmount) external onlyOwner {
        emit ClaimAmountUpdated(claimAmount, newAmount);
        claimAmount = newAmount;
    }

    function setCooldown(uint256 newCooldown) external onlyOwner {
        emit CooldownUpdated(cooldown, newCooldown);
        cooldown = newCooldown;
    }

    /// @notice Drain remaining tokens back to owner (for redeployment or shutdown)
    function drain() external onlyOwner {
        uint256 balance = loarToken.balanceOf(address(this));
        loarToken.safeTransfer(owner(), balance);
        emit Drained(owner(), balance);
    }
}
