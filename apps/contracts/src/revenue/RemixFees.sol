// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {Initializable} from "@openzeppelin-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin-upgradeable/access/OwnableUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {IERC20} from "@openzeppelin/interfaces/IERC20.sol";
import {SafeERC20} from "@openzeppelin/token/ERC20/utils/SafeERC20.sol";

/// @title RemixFees
/// @notice When someone branches/remixes content from another creator's work,
///         a $LOAR fee is automatically charged and split:
///         - Original creator gets the majority (e.g. 70%)
///         - LP gets a portion (e.g. 20%)
///         - DAO treasury gets the rest (e.g. 10%)
///
///         This creates a royalty layer for derivative content —
///         the more popular your content, the more remixes it attracts,
///         the more $LOAR you earn passively.
///
///         Universe creators can set custom remix fees for their universe.
///         Platform sets a minimum and default.
contract RemixFees is Initializable, UUPSUpgradeable, OwnableUpgradeable, ReentrancyGuardUpgradeable {
    using SafeERC20 for IERC20;

    struct RemixConfig {
        uint256 fee;            // $LOAR cost to remix content from this universe
        bool customFee;         // true if universe creator set a custom fee
    }

    IERC20 public loarToken;
    address public treasury;
    address public liquidityPool;
    address public platform;

    /// @notice Default remix fee when universe hasn't set a custom one
    uint256 public defaultRemixFee;

    /// @notice Minimum remix fee (prevents race to zero)
    uint256 public minRemixFee;

    /// @notice Split ratios (must sum to 10000)
    uint16 public creatorShareBps;    // % to original content creator
    uint16 public lpShareBps;         // % to LP
    uint16 public treasuryShareBps;   // % to DAO treasury

    /// @notice Per-universe remix configs
    mapping(uint256 => RemixConfig) public universeConfigs;

    /// @notice Mapping: universe creator address → universe ID (set by platform)
    mapping(uint256 => address) public universeCreators;

    /// @notice Lifetime stats
    uint256 public totalRemixFees;
    uint256 public totalRemixes;
    uint256 public totalToCreators;
    uint256 public totalToLp;

    event RemixFeeCharged(
        address indexed remixer,
        address indexed originalCreator,
        uint256 indexed universeId,
        uint256 fee,
        uint256 toCreator,
        uint256 toLp,
        uint256 toTreasury
    );
    event UniverseRemixFeeSet(uint256 indexed universeId, uint256 fee);
    event DefaultRemixFeeUpdated(uint256 oldFee, uint256 newFee);

    error ZeroAddress();
    error NotAuthorized();
    error NotCreatorOrPlatform();
    error FeeBelowMinimum();

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

        defaultRemixFee = 25e18;    // 25 $LOAR default
        minRemixFee = 5e18;         // 5 $LOAR minimum

        // Default split: 70% creator, 20% LP, 10% treasury
        creatorShareBps = 7000;
        lpShareBps = 2000;
        treasuryShareBps = 1000;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // ── Charge remix fee ────────────────────────────────────────

    /// @notice Charge a remix fee when someone branches content.
    ///         Called by platform backend after content creation.
    /// @param remixer The user creating the remix/branch
    /// @param originalCreator The creator of the source content
    /// @param universeId The universe the content belongs to
    function chargeRemixFee(
        address remixer,
        address originalCreator,
        uint256 universeId
    ) external nonReentrant {
        if (msg.sender != platform && msg.sender != owner()) revert NotAuthorized();
        if (remixer == address(0) || originalCreator == address(0)) revert ZeroAddress();

        // Skip if remixer is the original creator (no self-fee)
        if (remixer == originalCreator) return;

        uint256 fee = _getRemixFee(universeId);
        if (fee == 0) return;

        // Transfer $LOAR from remixer
        loarToken.safeTransferFrom(remixer, address(this), fee);

        // Calculate splits
        uint256 toCreator = (fee * creatorShareBps) / 10_000;
        uint256 toLp = (fee * lpShareBps) / 10_000;
        uint256 toTreasuryAmount = fee - toCreator - toLp;

        // Distribute
        if (toCreator > 0) {
            loarToken.safeTransfer(originalCreator, toCreator);
            totalToCreators += toCreator;
        }
        if (toLp > 0 && liquidityPool != address(0)) {
            loarToken.safeTransfer(liquidityPool, toLp);
            totalToLp += toLp;
        } else {
            toTreasuryAmount += toLp;
            toLp = 0;
        }
        if (toTreasuryAmount > 0) {
            loarToken.safeTransfer(treasury, toTreasuryAmount);
        }

        totalRemixFees += fee;
        totalRemixes++;

        emit RemixFeeCharged(remixer, originalCreator, universeId, fee, toCreator, toLp, toTreasuryAmount);
    }

    // ── Universe config ─────────────────────────────────────────

    /// @notice Universe creator sets a custom remix fee for their universe
    function setUniverseRemixFee(uint256 universeId, uint256 fee) external {
        if (msg.sender != universeCreators[universeId] && msg.sender != platform && msg.sender != owner()) {
            revert NotCreatorOrPlatform();
        }
        if (fee > 0 && fee < minRemixFee) revert FeeBelowMinimum();

        universeConfigs[universeId] = RemixConfig({fee: fee, customFee: true});
        emit UniverseRemixFeeSet(universeId, fee);
    }

    /// @notice Register universe creator (platform only)
    function registerUniverse(uint256 universeId, address creator) external {
        require(msg.sender == platform || msg.sender == owner(), "Unauthorized");
        universeCreators[universeId] = creator;
    }

    // ── Views ───────────────────────────────────────────────────

    function getRemixFee(uint256 universeId) external view returns (uint256) {
        return _getRemixFee(universeId);
    }

    function _getRemixFee(uint256 universeId) internal view returns (uint256) {
        RemixConfig storage config = universeConfigs[universeId];
        return config.customFee ? config.fee : defaultRemixFee;
    }

    // ── Admin ───────────────────────────────────────────────────

    function setDefaultRemixFee(uint256 newFee) external onlyOwner {
        emit DefaultRemixFeeUpdated(defaultRemixFee, newFee);
        defaultRemixFee = newFee;
    }

    function setMinRemixFee(uint256 newMin) external onlyOwner {
        minRemixFee = newMin;
    }

    function setSplitRatios(uint16 _creator, uint16 _lp, uint16 _treasury) external onlyOwner {
        require(_creator + _lp + _treasury == 10_000, "Must sum to 10000");
        creatorShareBps = _creator;
        lpShareBps = _lp;
        treasuryShareBps = _treasury;
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
