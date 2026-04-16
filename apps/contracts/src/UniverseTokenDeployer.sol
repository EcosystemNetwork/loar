// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {LoarDeployer} from "./utils/LoarDeployer.sol";
import {GovernorDeployer} from "./utils/GovernorDeployer.sol";
import {BondingCurve} from "./BondingCurve.sol";
import {IUniverseManager} from "./interfaces/IUniverseManager.sol";
import {ReentrancyGuard} from "solady/src/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/interfaces/IERC20.sol";
import {SafeERC20} from "@openzeppelin/token/ERC20/utils/SafeERC20.sol";
import {IGovernor} from "@openzeppelin/governance/IGovernor.sol";

/**
 * @title UniverseTokenDeployer
 * @notice Deploys universe tokens with a graduated bonding curve.
 * @dev Tokens are sold via a linear bonding curve. When the curve fills,
 *      unsold tokens + raised ETH auto-migrate to Uniswap v4 LP.
 */
contract UniverseTokenDeployer is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IUniverseManager public immutable universeManager;
    uint256 public constant TOKEN_SUPPLY = 1_000_000_000e18; // 1B with 18 decimals

    // Default allocation splits (basis points, must sum to 10000)
    uint16 public constant DEFAULT_CURVE_BPS = 8000;       // 80% → bonding curve
    uint16 public constant DEFAULT_CREATOR_BPS = 1000;     // 10% → universe creator
    uint16 public constant DEFAULT_TREASURY_BPS = 500;     // 5%  → protocol treasury
    uint16 public constant DEFAULT_COMMUNITY_BPS = 500;    // 5%  → community rewards

    // Allocation constraints
    uint16 public constant MIN_CURVE_BPS = 5000;       // Curve must be ≥ 50%
    uint16 public constant MIN_TREASURY_BPS = 200;     // Treasury must be ≥ 2%
    uint16 public constant MAX_CREATOR_BPS = 4000;     // Creator can't exceed 40%

    // Bonding curve defaults
    uint256 public constant DEFAULT_GRADUATION_ETH = 4 ether;
    uint16 public constant DEFAULT_MAX_BUY_BPS = 200;  // 2% of curve supply per tx

    error InvalidAllocation();
    error AllocationSupplyMismatch();

    event TokenDeployed(
        uint256 indexed universeId,
        address indexed tokenAddress,
        address indexed bondingCurve,
        address governor
    );
    event TokenAllocation(
        uint256 indexed universeId,
        uint256 curveAmount,
        uint256 creatorAmount,
        uint256 treasuryAmount,
        uint256 communityAmount
    );

    constructor(address _universeManager) {
        universeManager = IUniverseManager(_universeManager);
    }

    /**
     * @notice Deploy a token, governance, and bonding curve for a universe.
     * @param deploymentConfig Configuration for token, pool (used at graduation), locker, and allocation.
     * @param universeId ID of the universe to deploy token for.
     * @return tokenAddress Address of the deployed token.
     * @return governor Address of the deployed governor.
     * @return bondingCurveAddress Address of the deployed bonding curve.
     */
    function deployTokenAndGovernance(
        IUniverseManager.DeploymentConfig memory deploymentConfig,
        uint256 universeId
    ) external nonReentrant returns (
        address tokenAddress,
        address governor,
        address bondingCurveAddress
    ) {
        require(msg.sender == address(universeManager), "Only UniverseManager can call");

        tokenAddress = LoarDeployer.deployToken(
            deploymentConfig.tokenConfig,
            TOKEN_SUPPLY
        );

        // Resolve allocation: use custom if provided, otherwise defaults
        IUniverseManager.AllocationConfig memory alloc = deploymentConfig.allocationConfig;
        uint16 curveBps = alloc.curveBps;
        uint16 creatorBps = alloc.creatorBps;
        uint16 treasuryBps = alloc.treasuryBps;
        uint16 communityBps = alloc.communityBps;

        // If all zeros, use defaults
        if (curveBps == 0 && creatorBps == 0 && treasuryBps == 0 && communityBps == 0) {
            curveBps = DEFAULT_CURVE_BPS;
            creatorBps = DEFAULT_CREATOR_BPS;
            treasuryBps = DEFAULT_TREASURY_BPS;
            communityBps = DEFAULT_COMMUNITY_BPS;
        }

        // Validate allocation
        if (curveBps + creatorBps + treasuryBps + communityBps != 10000) revert InvalidAllocation();
        if (curveBps < MIN_CURVE_BPS) revert InvalidAllocation();
        if (treasuryBps < MIN_TREASURY_BPS) revert InvalidAllocation();
        if (creatorBps > MAX_CREATOR_BPS) revert InvalidAllocation();

        // Calculate allocation splits
        uint256 curveAmount = (TOKEN_SUPPLY * curveBps) / 10000;
        uint256 creatorAmount = (TOKEN_SUPPLY * creatorBps) / 10000;
        uint256 treasuryAmount = (TOKEN_SUPPLY * treasuryBps) / 10000;
        uint256 communityAmount = TOKEN_SUPPLY - curveAmount - creatorAmount - treasuryAmount;
        if (curveAmount + creatorAmount + treasuryAmount + communityAmount != TOKEN_SUPPLY) revert AllocationSupplyMismatch();

        // Deploy bonding curve
        BondingCurve curve = new BondingCurve(
            tokenAddress,
            address(universeManager),
            universeId,
            curveAmount,
            DEFAULT_GRADUATION_ETH,
            DEFAULT_MAX_BUY_BPS
        );
        bondingCurveAddress = address(curve);

        // Curve tokens go to the BondingCurve contract
        IERC20(tokenAddress).safeTransfer(bondingCurveAddress, curveAmount);

        // Creator gets tokens for governance voting power from day 1
        address creator = deploymentConfig.tokenConfig.tokenAdmin;
        if (creator != address(0)) {
            IERC20(tokenAddress).safeTransfer(creator, creatorAmount);
        } else {
            IERC20(tokenAddress).safeTransfer(address(universeManager), creatorAmount);
        }

        // Treasury + community go to team fee recipient on UniverseManager
        IERC20(tokenAddress).safeTransfer(address(universeManager), treasuryAmount + communityAmount);

        governor = GovernorDeployer.deployGovernance(tokenAddress, address(this));

        emit TokenDeployed(universeId, tokenAddress, bondingCurveAddress, governor);
        emit TokenAllocation(universeId, curveAmount, creatorAmount, treasuryAmount, communityAmount);

        return (tokenAddress, governor, bondingCurveAddress);
    }
}
