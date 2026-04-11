// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {Initializable} from "@openzeppelin-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin-upgradeable/access/OwnableUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {IERC20} from "@openzeppelin/interfaces/IERC20.sol";
import {SafeERC20} from "@openzeppelin/token/ERC20/utils/SafeERC20.sol";

/// @title LoarBurner
/// @notice Premium action fees — $LOAR is redirected to LP and DAO treasury.
///         NO supply destruction. All $LOAR stays in the ecosystem.
///
///         Burn actions (each configurable cost):
///         - PRIORITY_GENERATION: Skip AI generation queue
///         - PERMANENT_CANON: Make a canon entry immutable (can't be overturned by vote)
///         - PREMIUM_PROFILE: Verified/premium creator badge
///         - REMIX_BOOST: Boost a remix's visibility for 7 days
///         - CUSTOM: Platform-defined future actions
///
///         Split (configurable):
///         - lpRatioBps% → LP address (deepens protocol-owned liquidity)
///         - remainder → DAO treasury (protocol revenue)
///         Default: 50% LP, 50% treasury.
contract LoarBurner is Initializable, UUPSUpgradeable, OwnableUpgradeable, ReentrancyGuardUpgradeable {
    using SafeERC20 for IERC20;

    enum BurnAction {
        PRIORITY_GENERATION,
        PERMANENT_CANON,
        PREMIUM_PROFILE,
        REMIX_BOOST,
        CUSTOM
    }

    struct ActionConfig {
        uint256 cost;           // $LOAR cost for this action
        bool active;
        uint256 totalBurned;    // lifetime $LOAR burned for this action
        uint256 totalCount;     // lifetime usage count
    }

    IERC20 public loarToken;
    address public treasury;
    address public liquidityPool;

    /// @notice Percentage of payment sent to LP (rest goes to DAO treasury). Default 5000 = 50%
    uint16 public lpRatioBps;

    /// @notice Config per burn action
    mapping(BurnAction => ActionConfig) public actions;

    /// @notice Custom action configs by name hash
    mapping(bytes32 => ActionConfig) public customActions;

    /// @notice Total $LOAR collected across all actions (lifetime)
    uint256 public totalCollected;

    /// @notice Total $LOAR sent to LP (lifetime)
    uint256 public totalToLp;

    /// @notice Platform backend address (can execute burns on behalf of users with approval)
    address public platform;

    event ActionExecuted(
        address indexed user,
        BurnAction indexed action,
        uint256 cost,
        uint256 toLp,
        uint256 toTreasury
    );
    event CustomActionExecuted(
        address indexed user,
        bytes32 indexed actionName,
        uint256 cost,
        uint256 toLp,
        uint256 toTreasury
    );
    event ActionConfigUpdated(BurnAction action, uint256 cost, bool active);
    event CustomActionConfigUpdated(bytes32 actionName, uint256 cost, bool active);
    event LpRatioUpdated(uint16 oldRatio, uint16 newRatio);

    error ActionNotActive();
    error InsufficientAllowance();
    error ZeroAddress();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function initialize(
        address _loarToken,
        address _treasury,
        address _liquidityPool,
        address _platform
    ) external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        if (_loarToken == address(0) || _treasury == address(0)) revert ZeroAddress();

        loarToken = IERC20(_loarToken);
        treasury = _treasury;
        liquidityPool = _liquidityPool;
        platform = _platform;
        lpRatioBps = 5000; // 50% to LP, 50% to treasury

        // Default costs (in $LOAR with 18 decimals)
        actions[BurnAction.PRIORITY_GENERATION] = ActionConfig({cost: 50e18, active: true, totalBurned: 0, totalCount: 0});
        actions[BurnAction.PERMANENT_CANON]     = ActionConfig({cost: 500e18, active: true, totalBurned: 0, totalCount: 0});
        actions[BurnAction.PREMIUM_PROFILE]     = ActionConfig({cost: 1000e18, active: true, totalBurned: 0, totalCount: 0});
        actions[BurnAction.REMIX_BOOST]         = ActionConfig({cost: 100e18, active: true, totalBurned: 0, totalCount: 0});
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // ── Core burn functions ─────────────────────────────────────

    /// @notice Execute a premium action — $LOAR split to LP + treasury (requires prior approval)
    /// @param action The action type to execute
    function execute(BurnAction action) external nonReentrant {
        ActionConfig storage config = actions[action];
        if (!config.active) revert ActionNotActive();
        (uint256 toLp, uint256 toTreasury) = _processPayment(msg.sender, config.cost);
        config.totalBurned += config.cost;
        config.totalCount += 1;
        emit ActionExecuted(msg.sender, action, config.cost, toLp, toTreasury);
    }

    /// @notice Platform executes on behalf of a user (user must have approved this contract)
    function executeFor(address user, BurnAction action) external nonReentrant {
        require(msg.sender == platform || msg.sender == owner(), "Unauthorized");
        ActionConfig storage config = actions[action];
        if (!config.active) revert ActionNotActive();
        (uint256 toLp, uint256 toTreasury) = _processPayment(user, config.cost);
        config.totalBurned += config.cost;
        config.totalCount += 1;
        emit ActionExecuted(user, action, config.cost, toLp, toTreasury);
    }

    /// @notice Execute a custom-named action
    function executeCustom(bytes32 actionName) external nonReentrant {
        ActionConfig storage config = customActions[actionName];
        if (!config.active) revert ActionNotActive();
        (uint256 toLp, uint256 toTreasury) = _processPayment(msg.sender, config.cost);
        config.totalBurned += config.cost;
        config.totalCount += 1;
        emit CustomActionExecuted(msg.sender, actionName, config.cost, toLp, toTreasury);
    }

    // ── Internal ────────────────────────────────────────────────

    function _processPayment(address payer, uint256 cost) internal returns (uint256 toLp, uint256 toTreasury) {
        toLp = (cost * lpRatioBps) / 10_000;
        toTreasury = cost - toLp;

        // Transfer from payer to this contract
        loarToken.safeTransferFrom(payer, address(this), cost);

        // LP portion — deepens protocol-owned liquidity
        if (toLp > 0 && liquidityPool != address(0)) {
            loarToken.safeTransfer(liquidityPool, toLp);
            totalToLp += toLp;
        } else {
            // If no LP set, all goes to treasury
            toTreasury += toLp;
            toLp = 0;
        }

        // Treasury portion — DAO revenue
        if (toTreasury > 0) {
            loarToken.safeTransfer(treasury, toTreasury);
        }

        totalCollected += cost;
    }

    // ── Admin ───────────────────────────────────────────────────

    function setActionConfig(BurnAction action, uint256 cost, bool active) external onlyOwner {
        actions[action].cost = cost;
        actions[action].active = active;
        emit ActionConfigUpdated(action, cost, active);
    }

    function setCustomAction(bytes32 actionName, uint256 cost, bool active) external onlyOwner {
        customActions[actionName].cost = cost;
        customActions[actionName].active = active;
        emit CustomActionConfigUpdated(actionName, cost, active);
    }

    function setLpRatio(uint16 newRatio) external onlyOwner {
        require(newRatio <= 10_000, "Invalid ratio");
        emit LpRatioUpdated(lpRatioBps, newRatio);
        lpRatioBps = newRatio;
    }

    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert ZeroAddress();
        treasury = newTreasury;
    }

    function setLiquidityPool(address newPool) external onlyOwner {
        liquidityPool = newPool;
    }

    function setPlatform(address newPlatform) external onlyOwner {
        platform = newPlatform;
    }
}
