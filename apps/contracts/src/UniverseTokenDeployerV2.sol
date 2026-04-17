// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ReentrancyGuard} from "solady/src/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IVotes} from "@openzeppelin/contracts/governance/utils/IVotes.sol";
import {IGovernor} from "@openzeppelin/contracts/governance/IGovernor.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";

// ─── Minimal interfaces to avoid importing 0.8.30 contracts ──────────

interface ITokenVesting {
    function createVesting(
        address token,
        address beneficiary,
        uint128 totalAmount,
        uint64 cliffDuration,
        uint64 vestingDuration
    ) external returns (uint256 vestingId);
}

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

interface ILoarDeployer {
    function deployToken(
        IUniverseManager.TokenConfig memory config,
        uint256 supply
    ) external returns (address);
}

interface IUniverseGovernorFactory {
    function deployGovernor(address token) external returns (address);
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
 * @title UniverseTokenDeployerV2
 * @notice Token deployer with optional creator vesting via TokenVesting contract.
 * @dev Drop-in replacement for UniverseTokenDeployer. Set via UniverseManager.setTokenDeployer().
 *      When vestingContract is set, creator tokens are locked with a cliff + linear vest.
 *      When vestingContract is address(0), behaves identically to V1 (direct transfer).
 */
contract UniverseTokenDeployerV2 is ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public immutable universeManager;
    uint256 public constant TOKEN_SUPPLY = 1_000_000_000e18; // 1B with 18 decimals (must match UniverseManager)

    // Default allocation splits
    uint16 public constant DEFAULT_LP_BPS = 8000;
    uint16 public constant DEFAULT_CREATOR_BPS = 1000;
    uint16 public constant DEFAULT_TREASURY_BPS = 500;
    uint16 public constant DEFAULT_COMMUNITY_BPS = 500;

    // Allocation constraints
    uint16 public constant MIN_LP_BPS = 5000;
    uint16 public constant MIN_TREASURY_BPS = 200;
    uint16 public constant MAX_CREATOR_BPS = 4000;

    // Bonding curve defaults
    uint256 public constant DEFAULT_GRADUATION_ETH = 4 ether;
    uint16 public constant DEFAULT_MAX_BUY_BPS = 200; // 2% of curve supply per tx

    // ─── Vesting configuration ─────────────────────────────────────────
    ITokenVesting public vestingContract;
    uint64 public vestingCliff = 30 days;      // 30-day cliff
    uint64 public vestingDuration = 180 days;  // 6-month linear vest

    IBondingCurveFactory public bondingCurveFactory;
    address public owner;

    error HookNotEnabled();
    error LockerNotEnabled();
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

    constructor(address _universeManager, address _vestingContract, address _bondingCurveFactory) {
        universeManager = _universeManager;
        vestingContract = ITokenVesting(_vestingContract);
        bondingCurveFactory = IBondingCurveFactory(_bondingCurveFactory);
        owner = msg.sender;
    }

    // ─── Admin ─────────────────────────────────────────────────────────

    error InvalidVestingContract();

    function setVestingConfig(
        address _vestingContract,
        uint64 _cliff,
        uint64 _duration
    ) external onlyOwner {
        // Allow setting to address(0) to disable vesting (V1 behavior)
        if (_vestingContract != address(0)) {
            // Validate the contract has code (not an EOA)
            uint256 codeSize;
            assembly { codeSize := extcodesize(_vestingContract) }
            if (codeSize == 0) revert InvalidVestingContract();
        }
        vestingContract = ITokenVesting(_vestingContract);
        vestingCliff = _cliff;
        vestingDuration = _duration;
        emit VestingConfigUpdated(_vestingContract, _cliff, _duration);
    }

    function setBondingCurveFactory(address _factory) external onlyOwner {
        bondingCurveFactory = IBondingCurveFactory(_factory);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        owner = newOwner;
    }

    // ─── Token deployment ──────────────────────────────────────────────

    function deployTokenAndGovernance(
        IUniverseManager.DeploymentConfig memory deploymentConfig,
        uint256 universeId
    ) external nonReentrant returns (address tokenAddress, address governor, address bondingCurveAddress) {
        if (msg.sender != universeManager) revert OnlyUniverseManager();
        if (address(bondingCurveFactory) == address(0)) revert BondingCurveFactoryNotSet();

        // Deploy the ERC20 token (uses LoarDeployer library via delegatecall pattern)
        tokenAddress = _deployToken(deploymentConfig.tokenConfig);

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

        // Creator allocation → vesting contract (if configured) or direct
        address creator = deploymentConfig.tokenConfig.tokenAdmin;
        require(creator != address(0) || creatorAmount == 0, "Creator address required when creatorBps > 0");
        if (creator != address(0) && creatorAmount > 0) {
            if (address(vestingContract) != address(0)) {
                // Route through vesting: approve + create schedule
                IERC20(tokenAddress).approve(address(vestingContract), creatorAmount);
                uint256 vestingId = vestingContract.createVesting(
                    tokenAddress,
                    creator,
                    uint128(creatorAmount),
                    vestingCliff,
                    vestingDuration
                );
                emit CreatorVestingCreated(universeId, creator, tokenAddress, vestingId, creatorAmount);
            } else {
                // No vesting — direct transfer (V1 behavior)
                IERC20(tokenAddress).safeTransfer(creator, creatorAmount);
            }
        }

        // Treasury + community → UniverseManager
        IERC20(tokenAddress).safeTransfer(universeManager, treasuryAmount + communityAmount);

        // Deploy governor
        governor = _deployGovernance(tokenAddress);

        emit TokenDeployed(universeId, tokenAddress, deploymentConfig.poolConfig.hook, deploymentConfig.lockerConfig.locker);
        emit TokenAllocation(universeId, lpAmount, creatorAmount, treasuryAmount, communityAmount);
    }

    function _deployToken(IUniverseManager.TokenConfig memory config) internal returns (address) {
        // Deploy GovernanceERC20 with full supply minted to this contract
        // This uses CREATE2 via the same LoarDeployer pattern as V1
        bytes memory bytecode = abi.encodePacked(
            type(GovernanceERC20Minimal).creationCode,
            abi.encode(
                config.name,
                config.symbol,
                config.imageURL,
                config.metadata,
                config.context,
                config.tokenAdmin,
                TOKEN_SUPPLY,
                address(this) // mint to this contract
            )
        );
        address token;
        assembly {
            token := create(0, add(bytecode, 0x20), mload(bytecode))
        }
        require(token != address(0), "Token deployment failed");
        return token;
    }

    function _deployGovernance(address tokenAddress) internal returns (address) {
        // Deploy a TimelockController with a 24h delay — prevents instant execution
        // of hostile proposals, giving community time to exit.
        address[] memory proposers = new address[](0);
        address[] memory executors = new address[](0);
        TimelockController timelock = new TimelockController(
            24 hours,  // minDelay
            proposers, // filled by governor later
            executors, // open executor
            address(this) // admin (renounced below)
        );

        UniverseGovernorMinimal governor = new UniverseGovernorMinimal(
            IVotes(tokenAddress),
            timelock
        );

        // Grant governor roles on the timelock, then renounce admin
        timelock.grantRole(timelock.PROPOSER_ROLE(), address(governor));
        timelock.grantRole(timelock.EXECUTOR_ROLE(), address(0)); // anyone can execute after delay
        timelock.grantRole(timelock.CANCELLER_ROLE(), address(governor));
        timelock.revokeRole(timelock.DEFAULT_ADMIN_ROLE(), address(this));

        return address(governor);
    }
}

// ─── Minimal token contract (same as GovernanceERC20 but self-contained) ──

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {ERC20Votes} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import {Nonces} from "@openzeppelin/contracts/utils/Nonces.sol";

contract GovernanceERC20Minimal is ERC20, ERC20Permit, ERC20Votes {
    string public imageUrl;
    string public metadata;
    string public context;
    address public tokenAdmin;

    constructor(
        string memory _name,
        string memory _symbol,
        string memory _imageUrl,
        string memory _metadata,
        string memory _context,
        address _tokenAdmin,
        uint256 _supply,
        address _mintTo
    ) ERC20(_name, _symbol) ERC20Permit(_name) {
        imageUrl = _imageUrl;
        metadata = _metadata;
        context = _context;
        tokenAdmin = _tokenAdmin;
        _mint(_mintTo, _supply);
    }

    function _update(address from, address to, uint256 value)
        internal override(ERC20, ERC20Votes) {
        super._update(from, to, value);
    }

    function nonces(address owner) public view override(ERC20Permit, Nonces) returns (uint256) {
        return super.nonces(owner);
    }
}

// ─── Minimal governor (with TimelockController for safe execution delay) ──

import {Governor} from "@openzeppelin/contracts/governance/Governor.sol";
import {GovernorVotes} from "@openzeppelin/contracts/governance/extensions/GovernorVotes.sol";
import {GovernorCountingSimple} from "@openzeppelin/contracts/governance/extensions/GovernorCountingSimple.sol";
import {GovernorVotesQuorumFraction} from "@openzeppelin/contracts/governance/extensions/GovernorVotesQuorumFraction.sol";
import {GovernorTimelockControl} from "@openzeppelin/contracts/governance/extensions/GovernorTimelockControl.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";

contract UniverseGovernorMinimal is Governor, GovernorCountingSimple, GovernorVotes, GovernorVotesQuorumFraction, GovernorTimelockControl {

    /// @notice Block at which this governor was deployed.
    uint256 public immutable deployedAtBlock;

    /// @notice Early-life period: ~30 days on Base L2 at 2s blocks.
    uint256 public constant EARLY_LIFE_BLOCKS = 1_296_000;

    /// @notice Quorum during early-life period (20% of total supply).
    uint256 public constant EARLY_LIFE_QUORUM_FRACTION = 20;

    constructor(IVotes _token, TimelockController _timelock)
        Governor("UniverseGovernor")
        GovernorVotes(_token)
        GovernorVotesQuorumFraction(10) // steady-state = 10%
        GovernorTimelockControl(_timelock)
    {
        deployedAtBlock = block.number;
    }

    function votingDelay() public pure override(Governor) returns (uint256) { return 7200; }
    function votingPeriod() public pure override(Governor) returns (uint256) { return 50400; }
    function proposalThreshold() public pure override(Governor) returns (uint256) { return 1_000_000e18; }

    /// @notice Early-life quorum boost: 20% for first ~30 days, then 10%.
    function quorum(uint256 timepoint)
        public
        view
        override(Governor, GovernorVotesQuorumFraction)
        returns (uint256)
    {
        if (block.number < deployedAtBlock + EARLY_LIFE_BLOCKS) {
            return (token().getPastTotalSupply(timepoint) * EARLY_LIFE_QUORUM_FRACTION) / 100;
        }
        return super.quorum(timepoint);
    }

    // ── Required overrides for GovernorTimelockControl ──

    function state(uint256 proposalId)
        public view override(Governor, GovernorTimelockControl)
        returns (ProposalState)
    { return super.state(proposalId); }

    function proposalNeedsQueuing(uint256 proposalId)
        public view override(Governor, GovernorTimelockControl)
        returns (bool)
    { return super.proposalNeedsQueuing(proposalId); }

    function _queueOperations(uint256 proposalId, address[] memory targets, uint256[] memory values, bytes[] memory calldatas, bytes32 descriptionHash)
        internal override(Governor, GovernorTimelockControl)
        returns (uint48)
    { return super._queueOperations(proposalId, targets, values, calldatas, descriptionHash); }

    function _executeOperations(uint256 proposalId, address[] memory targets, uint256[] memory values, bytes[] memory calldatas, bytes32 descriptionHash)
        internal override(Governor, GovernorTimelockControl)
    { super._executeOperations(proposalId, targets, values, calldatas, descriptionHash); }

    function _cancel(address[] memory targets, uint256[] memory values, bytes[] memory calldatas, bytes32 descriptionHash)
        internal override(Governor, GovernorTimelockControl)
        returns (uint256)
    { return super._cancel(targets, values, calldatas, descriptionHash); }

    function _executor()
        internal view override(Governor, GovernorTimelockControl)
        returns (address)
    { return super._executor(); }
}
