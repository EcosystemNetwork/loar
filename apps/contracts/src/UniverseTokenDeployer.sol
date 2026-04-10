// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {LoarDeployer} from "./utils/LoarDeployer.sol";
import {UniverseGovernor} from "./UniverseGovernor.sol";
import {IUniverse} from "./interfaces/IUniverse.sol";
import {IUniverseManager} from "./interfaces/IUniverseManager.sol";
import {ReentrancyGuard} from "solady/src/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/interfaces/IERC20.sol";
import {SafeERC20} from "@openzeppelin/token/ERC20/utils/SafeERC20.sol";
import {ILoarHook} from "./interfaces/ILoarHook.sol";
import {IGovernor} from "@openzeppelin/governance/IGovernor.sol";
import {IOwnable} from "./interfaces/IOwnable.sol";
import {ILoarLpLocker} from "./interfaces/ILoarLpLocker.sol";
import {IVotes} from "@openzeppelin/governance/utils/IVotes.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";

interface IUniverseManagerCallback {
    function initializePoolForToken(
        address hook,
        address token,
        address pairedToken,
        int24 tickIfToken0IsLoar,
        int24 tickSpacing,
        address locker,
        bytes memory poolData
    ) external returns (PoolKey memory poolKey);
}

/**
 * @title UniverseTokenDeployer
 * @notice Handles the heavy lifting of deploying universe tokens, initializing pools, and locking liquidity
 * @dev This contract is separated from UniverseManager to keep both contracts under the 24KB size limit
 */
contract UniverseTokenDeployer is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IUniverseManager public immutable universeManager;
    uint256 public constant TOKEN_SUPPLY = 100_000_000_000e18; // 100b with 18 decimals

    // Default allocation splits (basis points, must sum to 10000)
    uint16 public constant DEFAULT_LP_BPS = 8000;         // 80% → LP locker
    uint16 public constant DEFAULT_CREATOR_BPS = 1000;    // 10% → universe creator
    uint16 public constant DEFAULT_TREASURY_BPS = 500;    // 5%  → protocol treasury
    uint16 public constant DEFAULT_COMMUNITY_BPS = 500;   // 5%  → community rewards

    // Allocation constraints
    uint16 public constant MIN_LP_BPS = 5000;        // LP must be ≥ 50%
    uint16 public constant MIN_TREASURY_BPS = 200;   // Treasury must be ≥ 2%
    uint16 public constant MAX_CREATOR_BPS = 4000;   // Creator can't exceed 40%

    error HookNotEnabled();
    error LockerNotEnabled();
    error InvalidAllocation();

    event TokenDeployed(
        uint256 indexed universeId,
        address indexed tokenAddress,
        address indexed hook,
        address locker
    );
    event TokenAllocation(
        uint256 indexed universeId,
        uint256 lpAmount,
        uint256 creatorAmount,
        uint256 treasuryAmount,
        uint256 communityAmount
    );

    constructor(address _universeManager) {
        universeManager = IUniverseManager(_universeManager);
    }

    /**
     * @notice Deploy a token and governance for a universe
     * @dev Pool initialization and liquidity locking must be done by UniverseManager (the factory)
     * @param deploymentConfig Configuration for token
     * @param universeId ID of the universe to deploy token for
     * @return tokenAddress Address of the deployed token
     * @return governor Address of the deployed governor
     */
    function deployTokenAndGovernance(
        IUniverseManager.DeploymentConfig memory deploymentConfig,
        uint256 universeId
    ) external nonReentrant returns (
        address tokenAddress,
        address governor
    ) {
        require(msg.sender == address(universeManager), "Only UniverseManager can call");

        tokenAddress = LoarDeployer.deployToken(
            deploymentConfig.tokenConfig,
            TOKEN_SUPPLY
        );

        // Resolve allocation: use custom if provided, otherwise defaults
        IUniverseManager.AllocationConfig memory alloc = deploymentConfig.allocationConfig;
        uint16 lpBps = alloc.lpBps;
        uint16 creatorBps = alloc.creatorBps;
        uint16 treasuryBps = alloc.treasuryBps;
        uint16 communityBps = alloc.communityBps;

        // If all zeros, use defaults
        if (lpBps == 0 && creatorBps == 0 && treasuryBps == 0 && communityBps == 0) {
            lpBps = DEFAULT_LP_BPS;
            creatorBps = DEFAULT_CREATOR_BPS;
            treasuryBps = DEFAULT_TREASURY_BPS;
            communityBps = DEFAULT_COMMUNITY_BPS;
        }

        // Validate allocation
        if (lpBps + creatorBps + treasuryBps + communityBps != 10000) revert InvalidAllocation();
        if (lpBps < MIN_LP_BPS) revert InvalidAllocation();
        if (treasuryBps < MIN_TREASURY_BPS) revert InvalidAllocation();
        if (creatorBps > MAX_CREATOR_BPS) revert InvalidAllocation();

        // Calculate allocation splits
        uint256 lpAmount = (TOKEN_SUPPLY * lpBps) / 10000;
        uint256 creatorAmount = (TOKEN_SUPPLY * creatorBps) / 10000;
        uint256 treasuryAmount = (TOKEN_SUPPLY * treasuryBps) / 10000;
        uint256 communityAmount = TOKEN_SUPPLY - lpAmount - creatorAmount - treasuryAmount;
        assert(lpAmount + creatorAmount + treasuryAmount + communityAmount == TOKEN_SUPPLY);

        // LP portion goes to UniverseManager for pool locking
        IERC20(tokenAddress).safeTransfer(address(universeManager), lpAmount);

        // Creator gets tokens for governance voting power from day 1
        address creator = deploymentConfig.tokenConfig.tokenAdmin;
        if (creator != address(0)) {
            IERC20(tokenAddress).safeTransfer(creator, creatorAmount);
        } else {
            IERC20(tokenAddress).safeTransfer(address(universeManager), creatorAmount);
        }

        // Treasury + community go to team fee recipient on UniverseManager
        // (community allocation managed off-chain via treasury)
        IERC20(tokenAddress).safeTransfer(address(universeManager), treasuryAmount + communityAmount);

        governor = address(_deployGovernance(tokenAddress));

        emit TokenDeployed(universeId, tokenAddress, deploymentConfig.poolConfig.hook, deploymentConfig.lockerConfig.locker);
        emit TokenAllocation(universeId, lpAmount, creatorAmount, treasuryAmount, communityAmount);

        return (tokenAddress, governor);
    }

    function _deployGovernance(
        address tokenAddress
    ) internal returns (IGovernor) {
        UniverseGovernor governor = new UniverseGovernor(IVotes(tokenAddress));
        return IGovernor(governor);
    }
}
