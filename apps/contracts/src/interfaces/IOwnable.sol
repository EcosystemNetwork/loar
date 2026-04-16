// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title IOwnable
/// @notice Minimal ownership interface for querying the contract owner.
interface IOwnable {
    function owner() external view returns (address);
}
