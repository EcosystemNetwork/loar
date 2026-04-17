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
    function createUniverse(
        IUniverseManager.UniverseConfig memory config
    ) external returns (address) {
        Universe universe = new Universe(config);
        return address(universe);
    }
}
