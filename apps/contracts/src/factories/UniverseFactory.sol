// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Universe} from "../Universe.sol";
import {IUniverseFactory} from "../interfaces/IUniverseFactory.sol";
import {IUniverseManager} from "../interfaces/IUniverseManager.sol";

/// @title UniverseFactory
/// @notice Deploys Universe contracts on behalf of UniverseManager.
///         Extracted to keep UniverseManager under the EIP-170 contract size limit
///         (Universe creation bytecode is ~8.5 KB).
contract UniverseFactory is IUniverseFactory {
    /// @notice FACTORY-01: Only UniverseManager can create universes.
    ///         Prevents orphan universe creation bypassing NFT mint, LP seed, and fees.
    address public immutable manager;

    error OnlyManager();

    constructor(address _manager) {
        require(_manager != address(0), "Zero manager address");
        manager = _manager;
    }

    function createUniverse(
        IUniverseManager.UniverseConfig memory config
    ) external returns (address) {
        if (msg.sender != manager) revert OnlyManager();
        Universe universe = new Universe(config);
        return address(universe);
    }
}
