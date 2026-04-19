// SPDX-License-Identifier: MIT
pragma solidity =0.8.30;

/// @title IBondingCurve
/// @notice Interface for graduated bonding curves that auto-migrate to Uniswap v4 LP.
interface IBondingCurve {
    // ── Events ─────────────────────────────────────────────────────────
    event TokensPurchased(
        address indexed buyer,
        uint256 ethAmount,
        uint256 tokenAmount,
        uint256 newPrice
    );
    event TokensSold(
        address indexed seller,
        uint256 tokenAmount,
        uint256 ethReturned,
        uint256 newPrice
    );
    event Graduated(
        uint256 indexed universeId,
        address indexed token,
        uint256 ethRaised,
        uint256 lpTokens
    );
    event TradingHalted(uint256 indexed universeId);
    event TradingResumed(uint256 indexed universeId);
    event TradingHaltedByManager(uint256 indexed universeId, bool halted);

    // ── Errors ─────────────────────────────────────────────────────────
    error CurveGraduated();
    error TradingIsHalted();
    error ExceedsMaxBuy();
    error SlippageExceeded();
    error InsufficientTokens();
    error ZeroAmount();
    error TransferFailed();
    error NotGraduationReady();
    error SlopeIsZero();

    // ── Write functions ────────────────────────────────────────────────

    /// @notice Buy tokens from the bonding curve with ETH.
    /// @param minTokensOut Minimum tokens to receive (slippage protection).
    /// @param deadline Timestamp after which the transaction reverts (MEV protection).
    function buy(uint256 minTokensOut, uint256 deadline) external payable;

    /// @notice Sell tokens back to the bonding curve for ETH.
    /// @param tokenAmount Amount of tokens to sell.
    /// @param minEthOut Minimum ETH to receive (slippage protection).
    /// @param deadline Timestamp after which the transaction reverts (MEV protection).
    function sell(uint256 tokenAmount, uint256 minEthOut, uint256 deadline) external;

    /// @notice Trigger graduation to Uniswap v4 LP pool.
    /// @dev Can be called by anyone once ethRaised >= graduationEth.
    function graduate() external;

    /// @notice Queue a halt or resume. Executable after `HALT_TIMELOCK` (48h).
    /// @dev Manager-only. Replaces the old instant `setTradingHalted` so users
    ///      always have a window to exit positions before trading freezes.
    function queueHalt(bool halted) external;

    /// @notice Cancel a queued halt/resume before its timelock elapses.
    function cancelHalt() external;

    /// @notice Execute a queued halt/resume once the timelock has elapsed.
    /// @dev Permissionless so a queued state can't be silently starved.
    function executeHalt() external;

    /// @notice Bypass the timelock for live-exploit response. Halts only.
    /// @dev One-shot per halt cycle; consumed on use, reset by a resume.
    function emergencyHalt() external;

    // ── View functions ─────────────────────────────────────────────────

    /// @notice Current marginal price per token-unit (slope * tokensSold).
    ///         Returns 0 for most of the curve due to sub-wei precision.
    ///         Use getCurrentPricePerToken() for frontend display.
    function getCurrentPrice() external view returns (uint256);

    /// @notice Cost in wei to buy 1 whole token (1e18 units) at the current position.
    ///         Suitable for frontend price display.
    function getCurrentPricePerToken() external view returns (uint256);

    /// @notice Preview how many tokens an ETH amount would buy.
    function getTokensForEth(uint256 ethAmount) external view returns (uint256);

    /// @notice Preview how much ETH selling tokens would return (before fee).
    function getEthForTokens(uint256 tokenAmount) external view returns (uint256);

    /// @notice Graduation progress.
    /// @return raised ETH raised so far.
    /// @return target ETH needed for graduation.
    /// @return percentBps Progress in basis points (0-10000).
    function getProgress() external view returns (uint256 raised, uint256 target, uint256 percentBps);

    /// @notice Full state snapshot for frontends.
    function curveState() external view returns (
        uint256 _tokensSold,
        uint256 _ethRaised,
        bool _graduated,
        uint256 _currentPrice,
        uint256 _totalCurveSupply,
        uint256 _graduationEth
    );
}
