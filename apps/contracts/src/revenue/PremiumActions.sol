// SPDX-License-Identifier: MIT
pragma solidity =0.8.30;

import {Initializable} from "@openzeppelin-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin-upgradeable/access/OwnableUpgradeable.sol";
import {
    ReentrancyGuardUpgradeable
} from "@openzeppelin-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin-upgradeable/utils/PausableUpgradeable.sol";
import {IERC20} from "@openzeppelin/interfaces/IERC20.sol";
import {SafeERC20} from "@openzeppelin/token/ERC20/utils/SafeERC20.sol";

/// @title PremiumActions
/// @notice Premium-action fee collector. **No supply destruction** — every $LOAR
///         collected is split between the protocol-owned liquidity pool and the
///         DAO treasury. The contract was originally named `LoarBurner`; the
///         BURN-01 audit finding (sources E H-28) flagged that name as
///         misleading because no `burn()` is ever called. This is the renamed
///         file. If the DAO later wants to destroy any of its treasury
///         holdings, it does so via a governance proposal calling
///         `loarToken.burn()` (the token is `ERC20Burnable`); this contract is
///         not involved.
/// @dev BURN-01 rename executed 2026-05-16. The `BurnAction` enum and
///      `totalBurned` struct field are retained for ABI continuity — renaming
///      them would change the public getter tuple and break any indexer that
///      decodes by field name. `totalBurned` is "lifetime $LOAR collected for
///      this action" — historical name, NOT supply destruction.
///
///      Action catalogue (`BurnAction` enum — historical name, no destruction):
///      - PRIORITY_GENERATION: Skip AI generation queue
///      - PERMANENT_CANON: Make a canon entry immutable
///      - PREMIUM_PROFILE: Verified/premium creator badge
///      - REMIX_BOOST: Boost a remix's visibility for 7 days
///      - CUSTOM: Platform-defined future actions
///
///      Split (configurable, default 50/50):
///      - lpRatioBps% → liquidity pool
///      - remainder    → DAO treasury
contract PremiumActions is
    Initializable,
    UUPSUpgradeable,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    PausableUpgradeable
{
    using SafeERC20 for IERC20;

    /// @notice Action catalogue. Name retained from the pre-BURN-01 contract
    ///         for ABI continuity — these are NOT supply-destroying burns.
    enum BurnAction {
        PRIORITY_GENERATION,
        PERMANENT_CANON,
        PREMIUM_PROFILE,
        REMIX_BOOST,
        CUSTOM
    }

    struct ActionConfig {
        uint256 cost; // $LOAR cost for this action
        bool active;
        uint256 totalBurned; // lifetime $LOAR collected for this action (field name is historical; no supply destruction — see contract header)
        uint256 totalCount; // lifetime usage count
    }

    IERC20 public loarToken;
    address public treasury;
    address public liquidityPool;

    /// @notice Percentage of payment sent to LP (rest goes to DAO treasury). Default 5000 = 50%
    uint16 public lpRatioBps;

    /// @notice Config per premium action
    mapping(BurnAction => ActionConfig) public actions;

    /// @notice Custom action configs by name hash
    mapping(bytes32 => ActionConfig) public customActions;

    /// @notice Total $LOAR collected across all actions (lifetime)
    uint256 public totalCollected;

    /// @notice Total $LOAR sent to LP (lifetime)
    uint256 public totalToLp;

    /// @notice Platform backend address (can execute actions on behalf of users with approval)
    address public platform;

    /// @dev `cost` = the sticker price (action config) the caller agreed to
    ///      pay. `received` = the actual balance delta after the SafeERC20
    ///      transferFrom (fee-on-transfer protection — see `_processPayment`).
    ///      Indexers that compute sticker revenue should read `cost`; indexers
    ///      that reconcile treasury/LP inflows should read `received`. Pre-H-1
    ///      the contract emitted `received` in the `cost` slot, silently
    ///      breaking sticker-revenue dashboards if $LOAR ever gains transfer
    ///      fees. ABI-breaking change: an extra `uint256 received` field was
    ///      appended after `cost`.
    event ActionExecuted(
        address indexed user,
        BurnAction indexed action,
        uint256 cost,
        uint256 received,
        uint256 toLp,
        uint256 toTreasury
    );
    event CustomActionExecuted(
        address indexed user,
        bytes32 indexed actionName,
        uint256 cost,
        uint256 received,
        uint256 toLp,
        uint256 toTreasury
    );
    event ActionConfigUpdated(BurnAction action, uint256 cost, bool active);
    event CustomActionConfigUpdated(bytes32 actionName, uint256 cost, bool active);
    event LpRatioUpdated(uint16 oldRatio, uint16 newRatio);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event LiquidityPoolUpdated(address indexed oldPool, address indexed newPool);
    event PlatformUpdated(address indexed oldPlatform, address indexed newPlatform);

    error ActionNotActive();
    error InsufficientAllowance();
    error ZeroAddress();
    error NotAuthorized();
    error InvalidRatio();
    error NoTokensReceived();
    error UseCustomActionSetter();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _loarToken,
        address _treasury,
        address _liquidityPool,
        address _platform
    ) external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        __Pausable_init();
        if (_loarToken == address(0) || _treasury == address(0)) revert ZeroAddress();

        loarToken = IERC20(_loarToken);
        treasury = _treasury;
        liquidityPool = _liquidityPool;
        platform = _platform;
        lpRatioBps = 5000; // 50% to LP, 50% to treasury

        // Default costs (in $LOAR with 18 decimals)
        actions[BurnAction.PRIORITY_GENERATION] =
            ActionConfig({cost: 50e18, active: true, totalBurned: 0, totalCount: 0});
        actions[BurnAction.PERMANENT_CANON] =
            ActionConfig({cost: 500e18, active: true, totalBurned: 0, totalCount: 0});
        actions[BurnAction.PREMIUM_PROFILE] =
            ActionConfig({cost: 1000e18, active: true, totalBurned: 0, totalCount: 0});
        actions[BurnAction.REMIX_BOOST] =
            ActionConfig({cost: 100e18, active: true, totalBurned: 0, totalCount: 0});
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // ── Core execute functions ──────────────────────────────────

    /// @notice Execute a premium action — $LOAR split to LP + treasury (requires prior approval)
    /// @param action The action type to execute
    function execute(BurnAction action) external nonReentrant whenNotPaused {
        ActionConfig storage config = actions[action];
        if (!config.active) revert ActionNotActive();
        uint256 cost = config.cost;
        (uint256 received, uint256 toLp, uint256 toTreasury) = _processPayment(msg.sender, cost);
        config.totalBurned += received;
        config.totalCount += 1;
        emit ActionExecuted(msg.sender, action, cost, received, toLp, toTreasury);
    }

    /// @notice Platform executes on behalf of a user (user must have approved this contract)
    function executeFor(address user, BurnAction action) external nonReentrant whenNotPaused {
        if (msg.sender != platform && msg.sender != owner()) revert NotAuthorized();
        ActionConfig storage config = actions[action];
        if (!config.active) revert ActionNotActive();
        uint256 cost = config.cost;
        (uint256 received, uint256 toLp, uint256 toTreasury) = _processPayment(user, cost);
        config.totalBurned += received;
        config.totalCount += 1;
        emit ActionExecuted(user, action, cost, received, toLp, toTreasury);
    }

    /// @notice Execute a custom-named action
    function executeCustom(bytes32 actionName) external nonReentrant whenNotPaused {
        ActionConfig storage config = customActions[actionName];
        if (!config.active) revert ActionNotActive();
        uint256 cost = config.cost;
        (uint256 received, uint256 toLp, uint256 toTreasury) = _processPayment(msg.sender, cost);
        config.totalBurned += received;
        config.totalCount += 1;
        emit CustomActionExecuted(msg.sender, actionName, cost, received, toLp, toTreasury);
    }

    // ── Internal ────────────────────────────────────────────────

    function _processPayment(address payer, uint256 cost)
        internal
        returns (uint256 received, uint256 toLp, uint256 toTreasury)
    {
        // Fee-on-transfer protection (M8): measure actual received amount rather
        // than trusting `cost`. If $LOAR ever gains transfer fees, treasury+LP
        // splits must be re-computed from the real balance delta, otherwise the
        // contract over-promises tokens it never received.
        uint256 balBefore = loarToken.balanceOf(address(this));
        loarToken.safeTransferFrom(payer, address(this), cost);
        received = loarToken.balanceOf(address(this)) - balBefore;
        if (received == 0) revert NoTokensReceived();

        toLp = (received * lpRatioBps) / 10_000;
        toTreasury = received - toLp;

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

        totalCollected += received;
    }

    // ── Admin ───────────────────────────────────────────────────

    function setActionConfig(BurnAction action, uint256 cost, bool active) external onlyOwner {
        if (action == BurnAction.CUSTOM) revert UseCustomActionSetter();
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
        if (newRatio > 10_000) revert InvalidRatio();
        emit LpRatioUpdated(lpRatioBps, newRatio);
        lpRatioBps = newRatio;
    }

    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert ZeroAddress();
        emit TreasuryUpdated(treasury, newTreasury);
        treasury = newTreasury;
    }

    function setLiquidityPool(address newPool) external onlyOwner {
        emit LiquidityPoolUpdated(liquidityPool, newPool);
        liquidityPool = newPool;
    }

    function setPlatform(address newPlatform) external onlyOwner {
        emit PlatformUpdated(platform, newPlatform);
        platform = newPlatform;
    }

    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;
}
