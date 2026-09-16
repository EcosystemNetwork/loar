// SPDX-License-Identifier: MIT
pragma solidity =0.8.30;

import {Universe} from "../Universe.sol";
import {IUniverseFactory} from "../interfaces/IUniverseFactory.sol";
import {IUniverseManager} from "../interfaces/IUniverseManager.sol";
import {Ownable} from "@openzeppelin/access/Ownable.sol";

/// @title UniverseFactory
/// @notice Deploys Universe contracts on behalf of UniverseManager.
///         Extracted to keep UniverseManager under the EIP-170 contract size limit
///         (Universe creation bytecode is ~8.5 KB).
contract UniverseFactory is IUniverseFactory, Ownable {
    /// @notice FACTORY-01: Only UniverseManager can create universes.
    ///         Prevents orphan universe creation bypassing NFT mint, LP seed, and fees.
    address public immutable manager;

    /// @notice Relayer authorized to call backupContent/batchBackupContent on
    ///         every Universe this factory deploys — see IUniverseFactory.
    address public backupRelayer;

    error OnlyManager();

    event BackupRelayerUpdated(address oldRelayer, address newRelayer);

    constructor(address _manager) Ownable(msg.sender) {
        require(_manager != address(0), "Zero manager address");
        manager = _manager;
    }

    function createUniverse(IUniverseManager.UniverseConfig memory config)
        external
        returns (address)
    {
        if (msg.sender != manager) revert OnlyManager();
        Universe universe = new Universe(config, address(this));
        return address(universe);
    }

    /// @notice Update the backup relayer. Every already-deployed Universe from
    ///         this factory reads it live, so this rotates for all of them at
    ///         once. Settable to address(0) to disable backupContent across
    ///         this factory's universes as an emergency stop.
    function setBackupRelayer(address _relayer) external onlyOwner {
        address old = backupRelayer;
        backupRelayer = _relayer;
        emit BackupRelayerUpdated(old, _relayer);
    }
}
