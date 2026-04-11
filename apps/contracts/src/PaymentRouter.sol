// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {Initializable} from "@openzeppelin-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin-upgradeable/access/OwnableUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin-upgradeable/utils/PausableUpgradeable.sol";
import {IPaymentRouter} from "./interfaces/IPaymentRouter.sol";
import {IERC20} from "@openzeppelin/interfaces/IERC20.sol";
import {SafeERC20} from "@openzeppelin/token/ERC20/utils/SafeERC20.sol";

/// @title PaymentRouter
/// @notice Centralizes all ETH revenue routing across the LOAR platform.
///         Callers (revenue contracts) send ETH here via route(). The platform
///         fee goes immediately to treasury; the creator's cut accrues and is
///         pulled via claim().
///
///         Replaces the scattered platform.call + creator.call patterns in each
///         revenue contract, giving a single place to adjust fees and routing.
contract PaymentRouter is IPaymentRouter, Initializable, UUPSUpgradeable, OwnableUpgradeable, ReentrancyGuardUpgradeable, PausableUpgradeable {
    using SafeERC20 for IERC20;

    address public treasury;
    uint16 public defaultPlatformFeeBps;

    /// @notice Accumulated ETH per creator, claimable via pull pattern
    mapping(address => uint256) public claimable;

    /// @notice $LOAR token for dual-currency payments
    IERC20 public loarToken;

    /// @notice Accumulated $LOAR per creator, claimable via pull pattern
    mapping(address => uint256) public claimableLoar;

    /// @notice Fee discount for $LOAR payments (default 500 = 5% discount)
    uint16 public loarFeeDiscountBps;

    event PaymentRouted(
        address indexed creator,
        uint256 creatorAmount,
        uint256 platformAmount,
        uint16 feeBps
    );
    event LoarPaymentRouted(
        address indexed creator,
        uint256 creatorAmount,
        uint256 platformAmount,
        uint16 feeBps
    );
    event Claimed(address indexed creator, uint256 amount);
    event LoarClaimed(address indexed creator, uint256 amount);
    event TreasuryUpdated(address oldTreasury, address newTreasury);
    event DefaultFeeUpdated(uint16 newFeeBps);
    event LoarTokenUpdated(address newToken);
    event LoarFeeDiscountUpdated(uint16 newDiscountBps);

    error ZeroAddress();
    error NothingToClaim();
    error TransferFailed();
    error FeeTooHigh();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    /// @param _treasury Receives the platform's fee cut immediately on each route()
    /// @param _defaultPlatformFeeBps Default fee in basis points (e.g. 1000 = 10%)
    /// @param _loarToken $LOAR token for dual-currency payments (can be address(0) initially)
    /// @param _loarFeeDiscountBps Fee discount for $LOAR payments (e.g. 500 = 5%)
    function initialize(
        address _treasury,
        uint16 _defaultPlatformFeeBps,
        address _loarToken,
        uint16 _loarFeeDiscountBps
    ) external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        __Pausable_init();
        if (_treasury == address(0)) revert ZeroAddress();
        if (_defaultPlatformFeeBps > 5000) revert FeeTooHigh();
        treasury = _treasury;
        defaultPlatformFeeBps = _defaultPlatformFeeBps;
        loarToken = IERC20(_loarToken);
        loarFeeDiscountBps = _loarFeeDiscountBps;
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    /// @dev Sentinel value: pass type(uint16).max to use defaultPlatformFeeBps.
    ///      Pass 0 to explicitly route with zero platform fee.
    uint16 public constant USE_DEFAULT_FEE = type(uint16).max;

    /// @notice Route a payment: send platform cut to treasury, accrue creator's cut
    /// @param creator Address that will be able to claim the creator portion
    /// @param feeBps Platform fee in basis points; pass USE_DEFAULT_FEE to use defaultPlatformFeeBps, 0 for no fee
    function route(address creator, uint16 feeBps) external payable nonReentrant whenNotPaused {
        if (msg.value == 0) return;
        uint16 bps = feeBps == USE_DEFAULT_FEE ? defaultPlatformFeeBps : feeBps;
        if (bps > 5000) revert FeeTooHigh();
        uint256 platformCut = (msg.value * bps) / 10_000;
        uint256 creatorCut = msg.value - platformCut;

        if (creatorCut > 0) {
            claimable[creator] += creatorCut;
        }
        if (platformCut > 0) {
            (bool s,) = treasury.call{value: platformCut}("");
            if (!s) revert TransferFailed();
        }

        emit PaymentRouted(creator, creatorCut, platformCut, bps);
    }

    /// @notice Route a payment entirely to treasury (no creator split)
    ///         Used for credit purchases and other platform-only flows.
    function routeToTreasury() external payable nonReentrant whenNotPaused {
        if (msg.value == 0) return;
        (bool s,) = treasury.call{value: msg.value}("");
        if (!s) revert TransferFailed();
    }

    /// @notice Creator pulls accumulated earnings
    function claim() external nonReentrant {
        uint256 amount = claimable[msg.sender];
        if (amount == 0) revert NothingToClaim();
        claimable[msg.sender] = 0;
        (bool success,) = msg.sender.call{value: amount}("");
        if (!success) revert TransferFailed();
        emit Claimed(msg.sender, amount);
    }

    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert ZeroAddress();
        emit TreasuryUpdated(treasury, newTreasury);
        treasury = newTreasury;
    }

    function setDefaultFee(uint16 newFeeBps) external onlyOwner {
        if (newFeeBps > 5000) revert FeeTooHigh();
        defaultPlatformFeeBps = newFeeBps;
        emit DefaultFeeUpdated(newFeeBps);
    }

    // ── $LOAR Dual Payment ──────────────────────────────────────

    /// @notice Route a $LOAR payment with fee discount. Caller must have approved this contract.
    /// @param creator Address that will be able to claim the creator portion
    /// @param feeBps Platform fee in basis points; USE_DEFAULT_FEE to use default (with discount applied)
    /// @param amount $LOAR amount to route
    function routeLoar(address creator, uint16 feeBps, uint256 amount) external nonReentrant whenNotPaused {
        if (amount == 0) return;
        if (address(loarToken) == address(0)) revert ZeroAddress();

        uint16 bps = feeBps == USE_DEFAULT_FEE ? defaultPlatformFeeBps : feeBps;
        if (bps > 5000) revert FeeTooHigh();

        // Apply $LOAR fee discount (incentivizes paying in $LOAR)
        if (loarFeeDiscountBps > 0 && bps > loarFeeDiscountBps) {
            bps -= loarFeeDiscountBps;
        } else if (loarFeeDiscountBps >= bps) {
            bps = 0;
        }

        uint256 platformCut = (amount * bps) / 10_000;
        uint256 creatorCut = amount - platformCut;

        // Pull $LOAR from caller
        loarToken.safeTransferFrom(msg.sender, address(this), amount);

        if (creatorCut > 0) {
            claimableLoar[creator] += creatorCut;
        }
        if (platformCut > 0) {
            loarToken.safeTransfer(treasury, platformCut);
        }

        emit LoarPaymentRouted(creator, creatorCut, platformCut, bps);
    }

    /// @notice Route $LOAR entirely to treasury
    function routeLoarToTreasury(uint256 amount) external nonReentrant whenNotPaused {
        if (amount == 0) return;
        if (address(loarToken) == address(0)) revert ZeroAddress();
        loarToken.safeTransferFrom(msg.sender, address(this), amount);
        loarToken.safeTransfer(treasury, amount);
    }

    /// @notice Creator pulls accumulated $LOAR earnings
    function claimLoar() external nonReentrant {
        uint256 amount = claimableLoar[msg.sender];
        if (amount == 0) revert NothingToClaim();
        claimableLoar[msg.sender] = 0;
        loarToken.safeTransfer(msg.sender, amount);
        emit LoarClaimed(msg.sender, amount);
    }

    // ── $LOAR Admin ─────────────────────────────────────────────

    function setLoarToken(address _loarToken) external onlyOwner {
        if (_loarToken == address(0)) revert ZeroAddress();
        loarToken = IERC20(_loarToken);
        emit LoarTokenUpdated(_loarToken);
    }

    function setLoarFeeDiscount(uint16 newDiscountBps) external onlyOwner {
        require(newDiscountBps <= 2000, "Max 20% discount");
        loarFeeDiscountBps = newDiscountBps;
        emit LoarFeeDiscountUpdated(newDiscountBps);
    }
}
