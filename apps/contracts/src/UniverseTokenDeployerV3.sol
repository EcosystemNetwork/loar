// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ReentrancyGuard} from "solady/src/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

// ─── Minimal interfaces ─────────────────────────────────────────────

interface IUniverseManager {
    struct TokenConfig {
        address tokenAdmin;
        string name;
        string symbol;
        string imageURL;
        string metadata;
        string context;
    }

    struct PoolConfig {
        address hook;
        address pairedToken;
        int24 tickIfToken0IsLoar;
        int24 tickSpacing;
        bytes poolData;
    }

    struct AllocationConfig {
        uint16 lpBps;
        uint16 creatorBps;
        uint16 treasuryBps;
        uint16 communityBps;
    }

    struct LockerConfig {
        address locker;
        address[] rewardAdmins;
        address[] rewardRecipients;
        uint16[] rewardBps;
        int24[] tickLower;
        int24[] tickUpper;
        uint16[] positionBps;
        bytes lockerData;
    }

    struct DeploymentConfig {
        TokenConfig tokenConfig;
        PoolConfig poolConfig;
        LockerConfig lockerConfig;
        AllocationConfig allocationConfig;
    }
}

interface ITokenFactory {
    function deployToken(
        string memory name,
        string memory symbol,
        string memory imageURL,
        string memory metadata,
        string memory context,
        address tokenAdmin,
        uint256 supply,
        address mintTo
    ) external returns (address);
}

interface IGovernorFactory {
    function deployGovernor(address token) external returns (address);
}

/**
 * @title UniverseTokenDeployerV3
 * @notice Split-contract version — token & governor bytecode live in external factories.
 *         Stays well under the 24KB limit.
 */
contract UniverseTokenDeployerV3 is ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public immutable universeManager;
    uint256 public constant TOKEN_SUPPLY = 100_000_000_000e18;

    uint16 public constant DEFAULT_LP_BPS = 8000;
    uint16 public constant DEFAULT_CREATOR_BPS = 1000;
    uint16 public constant DEFAULT_TREASURY_BPS = 500;
    uint16 public constant DEFAULT_COMMUNITY_BPS = 500;
    uint16 public constant MIN_LP_BPS = 5000;
    uint16 public constant MIN_TREASURY_BPS = 200;
    uint16 public constant MAX_CREATOR_BPS = 4000;

    ITokenFactory public tokenFactory;
    IGovernorFactory public governorFactory;
    address public owner;

    error InvalidAllocation();
    error AllocationSupplyMismatch();
    error OnlyUniverseManager();
    error OnlyOwner();

    event TokenDeployed(uint256 indexed universeId, address indexed tokenAddress, address indexed hook, address locker);
    event TokenAllocation(uint256 indexed universeId, uint256 lpAmount, uint256 creatorAmount, uint256 treasuryAmount, uint256 communityAmount);

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    constructor(
        address _universeManager,
        address _tokenFactory,
        address _governorFactory
    ) {
        universeManager = _universeManager;
        tokenFactory = ITokenFactory(_tokenFactory);
        governorFactory = IGovernorFactory(_governorFactory);
        owner = msg.sender;
    }

    function setTokenFactory(address _factory) external onlyOwner {
        tokenFactory = ITokenFactory(_factory);
    }

    function setGovernorFactory(address _factory) external onlyOwner {
        governorFactory = IGovernorFactory(_factory);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        owner = newOwner;
    }

    function deployTokenAndGovernance(
        IUniverseManager.DeploymentConfig memory deploymentConfig,
        uint256 universeId
    ) external nonReentrant returns (address tokenAddress, address governor) {
        if (msg.sender != universeManager) revert OnlyUniverseManager();

        // Deploy token via factory
        tokenAddress = tokenFactory.deployToken(
            deploymentConfig.tokenConfig.name,
            deploymentConfig.tokenConfig.symbol,
            deploymentConfig.tokenConfig.imageURL,
            deploymentConfig.tokenConfig.metadata,
            deploymentConfig.tokenConfig.context,
            deploymentConfig.tokenConfig.tokenAdmin,
            TOKEN_SUPPLY,
            address(this)
        );

        // Resolve allocation
        IUniverseManager.AllocationConfig memory alloc = deploymentConfig.allocationConfig;
        uint16 lpBps = alloc.lpBps;
        uint16 creatorBps = alloc.creatorBps;
        uint16 treasuryBps = alloc.treasuryBps;
        uint16 communityBps = alloc.communityBps;

        if (lpBps == 0 && creatorBps == 0 && treasuryBps == 0 && communityBps == 0) {
            lpBps = DEFAULT_LP_BPS;
            creatorBps = DEFAULT_CREATOR_BPS;
            treasuryBps = DEFAULT_TREASURY_BPS;
            communityBps = DEFAULT_COMMUNITY_BPS;
        }

        if (lpBps + creatorBps + treasuryBps + communityBps != 10000) revert InvalidAllocation();
        if (lpBps < MIN_LP_BPS) revert InvalidAllocation();
        if (treasuryBps < MIN_TREASURY_BPS) revert InvalidAllocation();
        if (creatorBps > MAX_CREATOR_BPS) revert InvalidAllocation();

        uint256 lpAmount = (TOKEN_SUPPLY * lpBps) / 10000;
        uint256 creatorAmount = (TOKEN_SUPPLY * creatorBps) / 10000;
        uint256 treasuryAmount = (TOKEN_SUPPLY * treasuryBps) / 10000;
        uint256 communityAmount = TOKEN_SUPPLY - lpAmount - creatorAmount - treasuryAmount;
        if (lpAmount + creatorAmount + treasuryAmount + communityAmount != TOKEN_SUPPLY) revert AllocationSupplyMismatch();

        // LP → UniverseManager
        IERC20(tokenAddress).safeTransfer(universeManager, lpAmount);

        // Creator → direct transfer
        address creator = deploymentConfig.tokenConfig.tokenAdmin;
        if (creator != address(0) && creatorAmount > 0) {
            IERC20(tokenAddress).safeTransfer(creator, creatorAmount);
        } else {
            IERC20(tokenAddress).safeTransfer(universeManager, creatorAmount);
        }

        // Treasury + community → UniverseManager
        IERC20(tokenAddress).safeTransfer(universeManager, treasuryAmount + communityAmount);

        // Deploy governor via factory
        governor = governorFactory.deployGovernor(tokenAddress);

        emit TokenDeployed(universeId, tokenAddress, deploymentConfig.poolConfig.hook, deploymentConfig.lockerConfig.locker);
        emit TokenAllocation(universeId, lpAmount, creatorAmount, treasuryAmount, communityAmount);
    }
}
