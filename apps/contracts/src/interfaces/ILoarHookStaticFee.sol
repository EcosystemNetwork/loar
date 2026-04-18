// SPDX-License-Identifier: MIT
pragma solidity =0.8.30;

import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";

/// @title ILoarHookStaticFee
/// @notice Interface for the static-fee variant of the Uniswap v4 hook with per-pool fee configuration.
interface ILoarHookStaticFee {
    error LoarFeeTooHigh();
    error PairedFeeTooHigh();

    event PoolInitialized(PoolId poolId, uint24 loarFee, uint24 pairedFee);

    struct PoolStaticConfigVars {
        uint24 loarFee;
        uint24 pairedFee;
    }

    function loarFee(PoolId poolId) external view returns (uint24);

    function pairedFee(PoolId poolId) external view returns (uint24);
}
