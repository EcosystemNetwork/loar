// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {BondingCurve} from "../BondingCurve.sol";

/// @title BondingCurveFactory
/// @notice Deploys BondingCurve instances for UniverseTokenDeployerV3.
/// @dev Follows the same factory pattern as GovernorFactory and GovernanceTokenFactory.
contract BondingCurveFactory {
    event BondingCurveCreated(
        address indexed bondingCurve,
        address indexed token,
        address indexed universeManager,
        uint256 universeId,
        uint256 totalCurveSupply,
        uint256 graduationEth
    );

    /// @notice Deploy a new BondingCurve for a universe token.
    /// @param token The governance token sold on the curve.
    /// @param universeManager The UniverseManager that receives graduation calls.
    /// @param universeId The universe this curve belongs to.
    /// @param totalCurveSupply Total tokens available for sale on the curve.
    /// @param graduationEth ETH threshold that triggers graduation to Uniswap v4 LP.
    /// @param maxBuyBps Maximum tokens per tx in basis points of totalCurveSupply.
    function deployBondingCurve(
        address token,
        address universeManager,
        uint256 universeId,
        uint256 totalCurveSupply,
        uint256 graduationEth,
        uint16 maxBuyBps
    ) external returns (address) {
        BondingCurve curve = new BondingCurve(
            token,
            universeManager,
            universeId,
            totalCurveSupply,
            graduationEth,
            maxBuyBps
        );

        emit BondingCurveCreated(
            address(curve),
            token,
            universeManager,
            universeId,
            totalCurveSupply,
            graduationEth
        );

        return address(curve);
    }
}
