// SPDX-License-Identifier: MIT
pragma solidity =0.8.30;

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

interface ITokenVesting {
    function createVesting(
        address token,
        address beneficiary,
        uint128 totalAmount,
        uint64 cliffDuration,
        uint64 vestingDuration
    ) external returns (uint256 vestingId);
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
    function deployGovernor(address token, address timelock) external returns (address);
}

interface IBondingCurveFactory {
    function deployBondingCurve(
        address token,
        address universeManager,
        uint256 universeId,
        uint256 totalCurveSupply,
        uint256 graduationEth,
        uint16 maxBuyBps
    ) external returns (address);
}

/**
 * @title UniverseTokenDeployerV3
 * @notice Split-contract version — token, governor, and bonding curve bytecode live in
 *         external factories. Stays well under the 24KB limit.
 * @dev Returns (tokenAddress, governor, bondingCurve) matching IUniverseTokenDeployer
 *      so it's compatible with UniverseManager.setTokenDeployer().
 */
contract UniverseTokenDeployerV3 is ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public immutable universeManager;
    uint256 public constant TOKEN_SUPPLY = 1_000_000_000e18; // 1B with 18 decimals (must match UniverseManager)

    uint16 public constant DEFAULT_LP_BPS = 8000;
    uint16 public constant DEFAULT_CREATOR_BPS = 1000;
    uint16 public constant DEFAULT_TREASURY_BPS = 500;
    uint16 public constant DEFAULT_COMMUNITY_BPS = 500;
    uint16 public constant MIN_LP_BPS = 5000;
    uint16 public constant MIN_TREASURY_BPS = 200;
    uint16 public constant MAX_CREATOR_BPS = 4000;

    // Bonding curve defaults
    uint256 public constant DEFAULT_GRADUATION_ETH = 4 ether;
    uint16 public constant DEFAULT_MAX_BUY_BPS = 200; // 2% of curve supply per tx

    ITokenFactory public tokenFactory;
    IGovernorFactory public governorFactory;
    IBondingCurveFactory public bondingCurveFactory;
    address public owner;
    address public timelock;

    /// @notice TOKEN-04: Distinct recipient for community allocations.
    ///         When unset, community share falls back to UniverseManager (legacy behavior).
    ///         Set to a dedicated community treasury / DAO / merkle distributor to prevent
    ///         `claimTeamFee` from sweeping community funds.
    address public communityRecipient;

    // ─── Vesting configuration (mirrors V2) ───────────────────────────
    address public vestingContract;
    uint64 public vestingCliff = 30 days;
    uint64 public vestingDuration = 180 days;

    error InvalidAllocation();
    error AllocationSupplyMismatch();
    error OnlyUniverseManager();
    error OnlyOwner();
    error BondingCurveFactoryNotSet();

    event TokenDeployed(uint256 indexed universeId, address indexed tokenAddress, address indexed hook, address locker);
    event TokenAllocation(uint256 indexed universeId, uint256 lpAmount, uint256 creatorAmount, uint256 treasuryAmount, uint256 communityAmount);
    event CreatorVestingCreated(uint256 indexed universeId, address indexed creator, address indexed token, uint256 vestingId, uint256 amount);
    event VestingConfigUpdated(address vestingContract, uint64 cliff, uint64 duration);

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    constructor(
        address _universeManager,
        address _tokenFactory,
        address _governorFactory,
        address _bondingCurveFactory
    ) {
        universeManager = _universeManager;
        tokenFactory = ITokenFactory(_tokenFactory);
        governorFactory = IGovernorFactory(_governorFactory);
        bondingCurveFactory = IBondingCurveFactory(_bondingCurveFactory);
        owner = msg.sender;
    }

    function setTokenFactory(address _factory) external onlyOwner {
        tokenFactory = ITokenFactory(_factory);
    }

    function setGovernorFactory(address _factory) external onlyOwner {
        governorFactory = IGovernorFactory(_factory);
    }

    function setBondingCurveFactory(address _factory) external onlyOwner {
        bondingCurveFactory = IBondingCurveFactory(_factory);
    }

    function setTimelock(address _timelock) external onlyOwner {
        timelock = _timelock;
    }

    /// @notice TOKEN-04: Set a distinct recipient for the community portion of every
    ///         deployed universe token. Set to address(0) to revert to legacy behavior
    ///         (community merged with treasury in UniverseManager).
    function setCommunityRecipient(address _communityRecipient) external onlyOwner {
        communityRecipient = _communityRecipient;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        owner = newOwner;
    }

    /// @notice Set vesting config for creator token allocation.
    ///         Set vestingContract to address(0) to disable vesting (direct transfer, V1 behavior).
    function setVestingConfig(address _vestingContract, uint64 _cliff, uint64 _duration) external onlyOwner {
        if (_vestingContract != address(0)) {
            uint256 codeSize;
            assembly { codeSize := extcodesize(_vestingContract) }
            require(codeSize > 0, "Vesting contract has no code");
        }
        vestingContract = _vestingContract;
        vestingCliff = _cliff;
        vestingDuration = _duration;
        emit VestingConfigUpdated(_vestingContract, _cliff, _duration);
    }

    /// @notice Deploys token, governor, and bonding curve for a universe.
    /// @dev Returns 3 values matching the IUniverseTokenDeployer interface
    ///      expected by UniverseManager.
    function deployTokenAndGovernance(
        IUniverseManager.DeploymentConfig memory deploymentConfig,
        uint256 universeId
    ) external nonReentrant returns (address tokenAddress, address governor, address bondingCurveAddress) {
        if (msg.sender != universeManager) revert OnlyUniverseManager();
        if (address(bondingCurveFactory) == address(0)) revert BondingCurveFactoryNotSet();

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

        // Deploy bonding curve via factory
        bondingCurveAddress = bondingCurveFactory.deployBondingCurve(
            tokenAddress,
            universeManager,
            universeId,
            lpAmount,
            DEFAULT_GRADUATION_ETH,
            DEFAULT_MAX_BUY_BPS
        );

        // LP (curve) tokens → BondingCurve contract for sale
        IERC20(tokenAddress).safeTransfer(bondingCurveAddress, lpAmount);

        // Creator allocation → vesting contract (if configured) or direct transfer
        address creator = deploymentConfig.tokenConfig.tokenAdmin;
        require(creator != address(0) || creatorAmount == 0, "Creator address required when creatorBps > 0");
        if (creator != address(0) && creatorAmount > 0) {
            if (vestingContract != address(0)) {
                IERC20(tokenAddress).approve(vestingContract, creatorAmount);
                uint256 vestingId = ITokenVesting(vestingContract).createVesting(
                    tokenAddress,
                    creator,
                    uint128(creatorAmount),
                    vestingCliff,
                    vestingDuration
                );
                emit CreatorVestingCreated(universeId, creator, tokenAddress, vestingId, creatorAmount);
            } else {
                IERC20(tokenAddress).safeTransfer(creator, creatorAmount);
            }
        }

        // TOKEN-04: Route treasury to UniverseManager, community to dedicated recipient when set.
        //           Legacy behavior (communityRecipient == address(0)) merges both in UniverseManager
        //           and remains compatible with existing claimTeamFee flow.
        if (communityRecipient != address(0)) {
            if (treasuryAmount > 0) {
                IERC20(tokenAddress).safeTransfer(universeManager, treasuryAmount);
            }
            if (communityAmount > 0) {
                IERC20(tokenAddress).safeTransfer(communityRecipient, communityAmount);
            }
        } else {
            IERC20(tokenAddress).safeTransfer(universeManager, treasuryAmount + communityAmount);
        }

        // Deploy governor via factory
        require(timelock != address(0), "Timelock not set");
        governor = governorFactory.deployGovernor(tokenAddress, timelock);

        emit TokenDeployed(universeId, tokenAddress, deploymentConfig.poolConfig.hook, deploymentConfig.lockerConfig.locker);
        emit TokenAllocation(universeId, lpAmount, creatorAmount, treasuryAmount, communityAmount);
    }
}
