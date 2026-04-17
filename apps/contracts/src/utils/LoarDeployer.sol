// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {GovernanceERC20} from "../GovernanceERC20.sol";
import {IUniverseManager} from "../interfaces/IUniverseManager.sol";

/// @title LoarDeployer
/// @notice Library for deploying GovernanceERC20 tokens during universe creation.
/// @dev Used by UniverseManager to deploy governance tokens with voting capabilities.
///      Deployed as a library to keep the factory contract size under the EIP-170 limit.
library LoarDeployer {
    function deployToken(
        IUniverseManager.TokenConfig memory tokenConfig,
        uint256 supply
    ) external returns (address tokenAddress) {
        GovernanceERC20 token = new GovernanceERC20(
            tokenConfig.name,
            tokenConfig.symbol,
            supply,
            tokenConfig.tokenAdmin,
            tokenConfig.imageURL,
            tokenConfig.metadata,
            tokenConfig.context
        );
        tokenAddress = address(token);
    }
}
