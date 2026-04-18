// SPDX-License-Identifier: MIT
pragma solidity =0.8.30;

import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";

/// @title ILoarHook
/// @notice Interface for the base Uniswap v4 hook that manages pool initialization and protocol fee collection.
interface ILoarHook {
    error ETHPoolNotAllowed();
    error OnlyFactory();
    error UnsupportedInitializePath();
    error PastCreationTimestamp();
    error WethCannotBeLoar();

    event PoolCreatedOpen(
        address indexed pairedToken,
        address indexed loar,
        PoolId poolId,
        int24 tickIfToken0IsLoar,
        int24 tickSpacing
    );

    event PoolCreatedFactory(
        address indexed pairedToken,
        address indexed loar,
        PoolId poolId,
        int24 tickIfToken0IsLoar,
        int24 tickSpacing,
        address locker
    );

    event ClaimProtocolFees(address indexed token, uint256 amount);

    // initialize a pool on the hook for a token
    function initializePool(
        address loar,
        address pairedToken,
        int24 tickIfToken0IsLoar,
        int24 tickSpacing,
        address locker,
        bytes calldata poolData
    ) external returns (PoolKey memory);

    // initialize a pool not via the factory
    function poolCreationTimestamp(
        PoolId poolId
    ) external view returns (uint256);

    function supportsInterface(bytes4 interfaceId) external pure returns (bool);
}
