// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IBondingCurve} from "./interfaces/IBondingCurve.sol";
import {IUniverseManager} from "./interfaces/IUniverseManager.sol";
import {ReentrancyGuard} from "solady/src/utils/ReentrancyGuard.sol";
import {FixedPointMathLib} from "solady/src/utils/FixedPointMathLib.sol";
import {IERC20} from "@openzeppelin/interfaces/IERC20.sol";
import {SafeERC20} from "@openzeppelin/token/ERC20/utils/SafeERC20.sol";

interface IUniverseManagerGraduation {
    function graduateFromBondingCurve(
        uint256 universeId,
        uint256 ethAmount,
        uint256 tokenAmount,
        address token
    ) external payable;
}

/// @title BondingCurve
/// @notice Linear bonding curve with anti-whale protection and auto-graduation to Uniswap v4.
/// @dev Price = slope * tokensSold. Cost to buy from a→b = slope * (b² - a²) / 2.
///      Slope is derived so that selling all curve tokens raises exactly GRADUATION_ETH.
///      When ethRaised >= GRADUATION_ETH, the curve graduates: unsold tokens + raised ETH
///      migrate to a Uniswap v4 LP pool via UniverseManager.
contract BondingCurve is IBondingCurve, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using FixedPointMathLib for uint256;

    // ── Immutables ─────────────────────────────────────────────────────
    address public immutable token;
    address public immutable universeManager;
    uint256 public immutable universeId;

    uint256 public immutable TOTAL_CURVE_SUPPLY;
    uint256 public immutable GRADUATION_ETH;
    uint256 public immutable MAX_BUY_AMOUNT; // max tokens per tx

    /// @notice Sell fee in basis points (1% = 100 bps). Fee stays in reserve.
    uint16 public constant SELL_FEE_BPS = 100;
    uint256 public constant BPS = 10_000;

    // ── Precision ──────────────────────────────────────────────────────
    // We store slope scaled by PRECISION to avoid precision loss.
    // slope_scaled = (2 * GRADUATION_ETH * PRECISION) / TOTAL_CURVE_SUPPLY²
    // Cost from a→b = slope_scaled * (b² - a²) / (2 * PRECISION)
    //
    // IMPORTANT: With 1B tokens (1e27 decimals) and 4 ETH graduation, the raw
    // ratio is ~1.25e-17 which rounds to 0 with PRECISION=1e18.
    // PRECISION=1e44 supports both 1B supply (slopeScaled≈1.25e9) and
    // 100B supply (slopeScaled≈125000) with good integral precision.
    uint256 internal constant PRECISION = 1e44;

    /// @notice Pre-computed slope (scaled by PRECISION).
    uint256 public immutable slopeScaled;

    // ── Mutable state ──────────────────────────────────────────────────
    uint256 public tokensSold;
    uint256 public ethRaised;
    bool public graduated;
    bool public tradingHalted;

    /// @notice Pending refunds for buyers whose refund transfer failed (pull pattern, H1 fix)
    mapping(address => uint256) public pendingRefunds;

    event RefundPending(address indexed buyer, uint256 amount);
    event RefundClaimed(address indexed buyer, uint256 amount);

    /// @notice Emergency halt/resume callable by UniverseManager (owner-gated there).
    function setTradingHalted(bool halted) external {
        require(msg.sender == universeManager, "Only universe manager");
        tradingHalted = halted;
        if (halted) {
            emit TradingHalted(universeId);
        } else {
            emit TradingResumed(universeId);
        }
    }

    constructor(
        address _token,
        address _universeManager,
        uint256 _universeId,
        uint256 _totalCurveSupply,
        uint256 _graduationEth,
        uint16 _maxBuyBps
    ) {
        token = _token;
        universeManager = _universeManager;
        universeId = _universeId;
        TOTAL_CURVE_SUPPLY = _totalCurveSupply;
        GRADUATION_ETH = _graduationEth;
        MAX_BUY_AMOUNT = (_totalCurveSupply * _maxBuyBps) / BPS;

        // slope_scaled = (2 * graduationEth * PRECISION) / totalCurveSupply²
        // Uses mulDiv for 512-bit intermediate to avoid overflow/precision loss.
        uint256 denominator = _totalCurveSupply * _totalCurveSupply;
        slopeScaled = FixedPointMathLib.mulDiv(2 * _graduationEth, PRECISION, denominator);
        if (slopeScaled == 0) revert SlopeIsZero();
    }

    // ── Modifiers ──────────────────────────────────────────────────────

    modifier whenActive() {
        if (graduated) revert CurveGraduated();
        if (tradingHalted) revert TradingIsHalted();
        _;
    }

    // ── Buy ────────────────────────────────────────────────────────────

    /// @inheritdoc IBondingCurve
    function buy(uint256 minTokensOut) external payable nonReentrant whenActive {
        if (msg.value == 0) revert ZeroAmount();

        uint256 tokensBought = _getTokensForEth(msg.value, tokensSold);

        // Cap to available supply
        uint256 available = TOTAL_CURVE_SUPPLY - tokensSold;
        if (tokensBought > available) {
            tokensBought = available;
        }

        if (tokensBought > MAX_BUY_AMOUNT) revert ExceedsMaxBuy();
        if (tokensBought < minTokensOut) revert SlippageExceeded();
        if (tokensBought == 0) revert ZeroAmount();

        // Calculate actual cost for the tokens bought (may be less than msg.value if capped)
        uint256 actualCost = _getCostForTokens(tokensBought, tokensSold);

        tokensSold += tokensBought;
        ethRaised += actualCost;

        IERC20(token).safeTransfer(msg.sender, tokensBought);

        // Refund excess ETH (H1 fix: gas-limited call + pull pattern fallback)
        uint256 refund = msg.value - actualCost;
        if (refund > 0) {
            (bool sent,) = msg.sender.call{value: refund, gas: 50000}("");
            if (!sent) {
                // Store for later withdrawal instead of reverting
                pendingRefunds[msg.sender] += refund;
                emit RefundPending(msg.sender, refund);
            }
        }

        uint256 newPrice = _getCurrentPrice();
        emit TokensPurchased(msg.sender, actualCost, tokensBought, newPrice);

        // Auto-graduate if threshold reached
        if (ethRaised >= GRADUATION_ETH) {
            _graduate();
        }
    }

    // ── Sell ────────────────────────────────────────────────────────────

    /// @inheritdoc IBondingCurve
    function sell(uint256 tokenAmount, uint256 minEthOut) external nonReentrant whenActive {
        if (tokenAmount == 0) revert ZeroAmount();
        if (tokenAmount > tokensSold) revert InsufficientTokens();

        // ETH value from the integral: slope * (tokensSold² - (tokensSold - tokenAmount)²) / 2
        uint256 ethReturn = _getCostForTokens(tokenAmount, tokensSold - tokenAmount);

        // Apply sell fee (1%)
        uint256 fee = (ethReturn * SELL_FEE_BPS) / BPS;
        uint256 ethAfterFee = ethReturn - fee;

        if (ethAfterFee < minEthOut) revert SlippageExceeded();

        // Pull tokens from seller
        IERC20(token).safeTransferFrom(msg.sender, address(this), tokenAmount);

        tokensSold -= tokenAmount;
        // Only subtract the pre-fee amount from ethRaised; fee stays as extra reserve
        ethRaised -= ethReturn;

        // Send ETH (minus fee) to seller
        (bool sent,) = msg.sender.call{value: ethAfterFee}("");
        if (!sent) revert TransferFailed();

        uint256 newPrice = _getCurrentPrice();
        emit TokensSold(msg.sender, tokenAmount, ethAfterFee, newPrice);
    }

    // ── Graduate ───────────────────────────────────────────────────────

    /// @inheritdoc IBondingCurve
    function graduate() external nonReentrant {
        if (graduated) revert CurveGraduated();
        if (ethRaised < GRADUATION_ETH) revert NotGraduationReady();
        _graduate();
    }

    function _graduate() internal {
        tradingHalted = true;
        emit TradingHalted(universeId);

        uint256 unsoldTokens = TOTAL_CURVE_SUPPLY - tokensSold;
        uint256 ethForLp = address(this).balance; // includes sell fees as bonus liquidity

        // Approve unsold tokens for UniverseManager
        if (unsoldTokens > 0) {
            IERC20(token).approve(universeManager, unsoldTokens);
        }

        // Send ETH + unsold tokens to UniverseManager for LP creation
        IUniverseManagerGraduation(universeManager).graduateFromBondingCurve{value: ethForLp}(
            universeId,
            ethForLp,
            unsoldTokens,
            token
        );

        graduated = true;

        emit Graduated(universeId, token, ethForLp, unsoldTokens);
    }

    // ── Refund claim (H1 pull pattern) ──────────────────────────────────

    /// @notice Claim pending refund that failed during buy()
    function claimRefund() external nonReentrant {
        uint256 amount = pendingRefunds[msg.sender];
        require(amount > 0, "No pending refund");
        pendingRefunds[msg.sender] = 0;
        (bool sent,) = msg.sender.call{value: amount}("");
        if (!sent) revert TransferFailed();
        emit RefundClaimed(msg.sender, amount);
    }

    // ── View functions ─────────────────────────────────────────────────

    /// @inheritdoc IBondingCurve
    function getCurrentPrice() external view returns (uint256) {
        return _getCurrentPrice();
    }

    /// @inheritdoc IBondingCurve
    function getCurrentPricePerToken() external view returns (uint256) {
        if (tokensSold == 0) return 0;
        // Cost to buy 1 whole token (1e18 units) at current position
        return _getCostForTokens(1e18, tokensSold);
    }

    /// @inheritdoc IBondingCurve
    function getTokensForEth(uint256 ethAmount) external view returns (uint256) {
        return _getTokensForEth(ethAmount, tokensSold);
    }

    /// @inheritdoc IBondingCurve
    function getEthForTokens(uint256 tokenAmount) external view returns (uint256) {
        if (tokenAmount > tokensSold) return 0;
        uint256 ethReturn = _getCostForTokens(tokenAmount, tokensSold - tokenAmount);
        uint256 fee = (ethReturn * SELL_FEE_BPS) / BPS;
        return ethReturn - fee;
    }

    /// @inheritdoc IBondingCurve
    function getProgress() external view returns (uint256 raised, uint256 target, uint256 percentBps) {
        raised = ethRaised;
        target = GRADUATION_ETH;
        percentBps = ethRaised >= GRADUATION_ETH ? BPS : (ethRaised * BPS) / GRADUATION_ETH;
    }

    /// @inheritdoc IBondingCurve
    function curveState() external view returns (
        uint256 _tokensSold,
        uint256 _ethRaised,
        bool _graduated,
        uint256 _currentPrice,
        uint256 _totalCurveSupply,
        uint256 _graduationEth
    ) {
        return (tokensSold, ethRaised, graduated, _getCurrentPrice(), TOTAL_CURVE_SUPPLY, GRADUATION_ETH);
    }

    // ── Internal math ──────────────────────────────────────────────────

    /// @dev Current price = slope * tokensSold = slopeScaled * tokensSold / PRECISION
    function _getCurrentPrice() internal view returns (uint256) {
        return slopeScaled.mulDiv(tokensSold, PRECISION);
    }

    /// @dev Cost to buy `amount` tokens starting from `fromSold`.
    ///      cost = slope * ((fromSold + amount)² - fromSold²) / 2
    ///           = slopeScaled * ((fromSold + amount)² - fromSold²) / (2 * PRECISION)
    function _getCostForTokens(uint256 amount, uint256 fromSold) internal view returns (uint256) {
        uint256 endSold = fromSold + amount;
        // (endSold² - fromSold²) = (endSold + fromSold) * (endSold - fromSold)
        //                        = (endSold + fromSold) * amount
        uint256 squareDiff = (endSold + fromSold) * amount;
        return slopeScaled.mulDiv(squareDiff, 2 * PRECISION);
    }

    /// @dev Given ETH amount and current tokensSold, compute tokens bought.
    ///      ethAmount = slopeScaled * ((tokensSold + bought)² - tokensSold²) / (2 * PRECISION)
    ///      Solving for bought:
    ///      bought = sqrt(tokensSold² + 2 * ethAmount * PRECISION / slopeScaled) - tokensSold
    function _getTokensForEth(uint256 ethAmount, uint256 currentSold) internal view returns (uint256) {
        // inner = currentSold² + (2 * ethAmount * PRECISION) / slopeScaled
        uint256 currentSoldSq = currentSold * currentSold;
        uint256 addend = FixedPointMathLib.mulDiv(2 * ethAmount, PRECISION, slopeScaled);
        uint256 inner = currentSoldSq + addend;
        uint256 sqrtInner = FixedPointMathLib.sqrt(inner);
        if (sqrtInner <= currentSold) return 0;
        return sqrtInner - currentSold;
    }

    /// @dev Accept ETH (for LP seed forwarding from UniverseManager)
    receive() external payable {}
}
