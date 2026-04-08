// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ILoarFeeLocker} from "./interfaces/ILoarFeeLocker.sol";

import {Ownable} from "@openzeppelin/access/Ownable.sol";
import {IERC20} from "@openzeppelin/token/ERC20/IERC20.sol";

import {SafeERC20} from "@openzeppelin/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/utils/ReentrancyGuard.sol";

/// @title LoarFeeLocker
/// @notice Escrow contract that holds protocol fees (ERC20 tokens) on behalf of fee owners.
/// @dev Only whitelisted depositors (e.g., Uniswap hooks) can store fees. Fee owners can claim anytime.
///      Uses balance deltas to safely handle fee-on-transfer tokens.
contract LoarFeeLocker is ILoarFeeLocker, ReentrancyGuard, Ownable {
    mapping(address feeOwner => mapping(address token => uint256 balance)) public feesToClaim;
    mapping(address depositor => bool isAllowed) public allowedDepositors;

    constructor(address owner_) Ownable(owner_) {}

    function addDepositor(address depositor) external onlyOwner {
        allowedDepositors[depositor] = true;
        emit AddDepositor(depositor);
    }

    function removeDepositor(address depositor) external onlyOwner {
        allowedDepositors[depositor] = false;
        emit RemoveDepositor(depositor);
    }

    function storeFees(address feeOwner, address token, uint256 amount) external nonReentrant {
        if (!allowedDepositors[msg.sender]) revert Unauthorized();

        // use balance deltas to support fee on transfer and weird tokens
        uint256 balanceBefore = IERC20(token).balanceOf(address(this));
        SafeERC20.safeTransferFrom(IERC20(token), msg.sender, address(this), amount);
        uint256 balanceAfter = IERC20(token).balanceOf(address(this));

        uint256 receivedAmount = balanceAfter - balanceBefore;

        feesToClaim[feeOwner][token] += receivedAmount;
        emit StoreTokens(msg.sender, feeOwner, token, feesToClaim[feeOwner][token], amount);
    }

    // helper function to check available fees
    function availableFees(address feeOwner, address token) external view returns (uint256) {
        return feesToClaim[feeOwner][token];
    }

    // claim fees — only the fee owner themselves can trigger withdrawal
    function claim(address token) external nonReentrant {
        uint256 balance = feesToClaim[msg.sender][token];
        if (balance == 0) revert NoFeesToClaim();

        // debit account
        feesToClaim[msg.sender][token] = 0;

        // transfer funds
        SafeERC20.safeTransfer(IERC20(token), msg.sender, balance);

        emit ClaimTokens(msg.sender, token, balance);
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(ILoarFeeLocker).interfaceId;
    }
}
