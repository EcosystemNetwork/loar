// SPDX-License-Identifier: MIT
pragma solidity =0.8.30;

import {IUniverseManager} from "./IUniverseManager.sol";

interface IUniverseFactory {
    function createUniverse(
        IUniverseManager.UniverseConfig memory config
    ) external returns (address);
}
