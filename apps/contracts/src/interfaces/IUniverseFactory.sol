// SPDX-License-Identifier: MIT
pragma solidity =0.8.30;

import {IUniverseManager} from "./IUniverseManager.sol";

interface IUniverseFactory {
    function createUniverse(IUniverseManager.UniverseConfig memory config)
        external
        returns (address);

    /// @notice The relayer authorized to call backupContent/batchBackupContent
    ///         on every Universe this factory deploys. Lives on the factory
    ///         (not UniverseManager, which predates this and is itself
    ///         non-upgradeable) so rotating it here retroactively applies to
    ///         every Universe this factory has already created, with one call.
    function backupRelayer() external view returns (address);
}
