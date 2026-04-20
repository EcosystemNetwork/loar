// SPDX-License-Identifier: MIT
pragma solidity =0.8.30;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {TransientStateLibrary} from "@uniswap/v4-core/src/libraries/TransientStateLibrary.sol";
import {CurrencySettler} from "@uniswap/v4-core/test/utils/CurrencySettler.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";

/// @title LoarSwapRouter
/// @notice Production swap router for Uniswap v4 pools within the LOAR ecosystem.
/// @dev Implements IUnlockCallback directly (not PoolTestBase) for production use.
///      Supports both exact-input and exact-output swaps with slippage protection and deadlines.
contract LoarSwapRouter is IUnlockCallback, Ownable {
    using CurrencyLibrary for Currency;
    using CurrencySettler for Currency;
    using TransientStateLibrary for IPoolManager;
    using SafeERC20 for IERC20;

    // ──────────────────────────────────────────────────────────────────────
    // State
    // ──────────────────────────────────────────────────────────────────────

    IPoolManager public immutable manager;

    // ──────────────────────────────────────────────────────────────────────
    // Errors
    // ──────────────────────────────────────────────────────────────────────

    error DeadlineExpired();
    error InsufficientOutputAmount(int128 actual, uint128 minimum);
    error ExcessiveInputAmount(int128 actual, uint128 maximum);
    error CallerNotManager();
    error NoSwapOccurred();
    error InsufficientETH();

    // ──────────────────────────────────────────────────────────────────────
    // Events
    // ──────────────────────────────────────────────────────────────────────

    event Swap(
        address indexed sender,
        Currency indexed currencyIn,
        Currency indexed currencyOut,
        int128 amountIn,
        int128 amountOut
    );

    // ──────────────────────────────────────────────────────────────────────
    // Internal types
    // ──────────────────────────────────────────────────────────────────────

    struct CallbackData {
        address sender;
        PoolKey key;
        SwapParams params;
        bytes hookData;
    }

    // ──────────────────────────────────────────────────────────────────────
    // Constructor
    // ──────────────────────────────────────────────────────────────────────

    constructor(IPoolManager _manager) Ownable(msg.sender) {
        manager = _manager;
    }

    // ──────────────────────────────────────────────────────────────────────
    // Receive ETH (for native-ETH swaps and refunds)
    // ──────────────────────────────────────────────────────────────────────

    receive() external payable {}

    // ──────────────────────────────────────────────────────────────────────
    // External swap functions
    // ──────────────────────────────────────────────────────────────────────

    /// @notice Swap an exact amount of input tokens for as many output tokens as possible.
    /// @param key            The Uniswap v4 pool key identifying the pool.
    /// @param zeroForOne     True if swapping token0 -> token1, false for token1 -> token0.
    /// @param amountIn       The exact amount of input tokens to spend.
    /// @param amountOutMinimum The minimum amount of output tokens to receive (slippage protection).
    /// @param deadline       Unix timestamp after which the transaction reverts.
    /// @param hookData       Arbitrary data forwarded to pool hooks.
    /// @return amountOut     The amount of output tokens received (positive value).
    function swapExactInput(
        PoolKey calldata key,
        bool zeroForOne,
        uint128 amountIn,
        uint128 amountOutMinimum,
        uint256 deadline,
        bytes calldata hookData
    ) external payable returns (uint128 amountOut) {
        if (block.timestamp > deadline) revert DeadlineExpired();

        // Snapshot the balance this caller did NOT contribute. _refundETH
        // will only return ETH that accumulated on top of this baseline,
        // so stale/accidental ETH in the contract cannot be swept by the
        // next swap caller — it stays claimable via `rescueETH` only.
        uint256 preSwapBaseline = address(this).balance - msg.value;

        // For exact input, amountSpecified is negative (convention: negative = exact input)
        SwapParams memory params = SwapParams({
            zeroForOne: zeroForOne,
            amountSpecified: -int256(uint256(amountIn)),
            sqrtPriceLimitX96: zeroForOne ? _MIN_SQRT_PRICE_LIMIT : _MAX_SQRT_PRICE_LIMIT
        });

        // Pull ERC20 tokens from sender if the input currency is not native ETH
        Currency inputCurrency = zeroForOne ? key.currency0 : key.currency1;
        if (!inputCurrency.isAddressZero()) {
            IERC20(Currency.unwrap(inputCurrency)).safeTransferFrom(msg.sender, address(this), amountIn);
        } else {
            if (msg.value < amountIn) revert InsufficientETH();
        }

        BalanceDelta delta = abi.decode(
            manager.unlock(abi.encode(CallbackData(msg.sender, key, params, hookData))),
            (BalanceDelta)
        );

        // Determine output amount
        int128 outputDelta = zeroForOne ? delta.amount1() : delta.amount0();
        if (outputDelta <= 0) revert NoSwapOccurred();

        amountOut = uint128(outputDelta);
        if (amountOut < amountOutMinimum) {
            revert InsufficientOutputAmount(outputDelta, amountOutMinimum);
        }

        // Refund only the portion that came from this caller.
        _refundETH(msg.sender, preSwapBaseline);

        emit Swap(
            msg.sender,
            inputCurrency,
            zeroForOne ? key.currency1 : key.currency0,
            delta.amount0(),
            delta.amount1()
        );
    }

    /// @notice Swap tokens to receive an exact amount of output tokens.
    /// @param key              The Uniswap v4 pool key identifying the pool.
    /// @param zeroForOne       True if swapping token0 -> token1, false for token1 -> token0.
    /// @param amountOut        The exact amount of output tokens to receive.
    /// @param amountInMaximum  The maximum amount of input tokens willing to spend (slippage protection).
    /// @param deadline         Unix timestamp after which the transaction reverts.
    /// @param hookData         Arbitrary data forwarded to pool hooks.
    /// @return amountIn        The amount of input tokens spent (positive value).
    function swapExactOutput(
        PoolKey calldata key,
        bool zeroForOne,
        uint128 amountOut,
        uint128 amountInMaximum,
        uint256 deadline,
        bytes calldata hookData
    ) external payable returns (uint128 amountIn) {
        if (block.timestamp > deadline) revert DeadlineExpired();

        // Snapshot the balance this caller did NOT contribute (see swapExactInput).
        uint256 preSwapBaseline = address(this).balance - msg.value;

        // For exact output, amountSpecified is positive (convention: positive = exact output)
        SwapParams memory params = SwapParams({
            zeroForOne: zeroForOne,
            amountSpecified: int256(uint256(amountOut)),
            sqrtPriceLimitX96: zeroForOne ? _MIN_SQRT_PRICE_LIMIT : _MAX_SQRT_PRICE_LIMIT
        });

        // For exact output with native ETH input, caller must send enough ETH
        Currency inputCurrency = zeroForOne ? key.currency0 : key.currency1;
        if (!inputCurrency.isAddressZero()) {
            // Transfer max input; excess will be refunded via the settle/take flow
            IERC20(Currency.unwrap(inputCurrency)).safeTransferFrom(msg.sender, address(this), amountInMaximum);
        } else {
            if (msg.value < amountInMaximum) revert InsufficientETH();
        }

        BalanceDelta delta = abi.decode(
            manager.unlock(abi.encode(CallbackData(msg.sender, key, params, hookData))),
            (BalanceDelta)
        );

        // Determine input amount spent (negative delta = debt/spend)
        int128 inputDelta = zeroForOne ? delta.amount0() : delta.amount1();
        if (inputDelta >= 0) revert NoSwapOccurred();

        amountIn = uint128(uint256(uint128(-inputDelta)));
        if (amountIn > amountInMaximum) {
            revert ExcessiveInputAmount(inputDelta, amountInMaximum);
        }

        // Refund unused ERC20 input tokens
        if (!inputCurrency.isAddressZero()) {
            uint256 remaining = IERC20(Currency.unwrap(inputCurrency)).balanceOf(address(this));
            if (remaining > 0) {
                IERC20(Currency.unwrap(inputCurrency)).safeTransfer(msg.sender, remaining);
            }
        }

        // Refund only the portion that came from this caller.
        _refundETH(msg.sender, preSwapBaseline);

        emit Swap(
            msg.sender,
            inputCurrency,
            zeroForOne ? key.currency1 : key.currency0,
            delta.amount0(),
            delta.amount1()
        );
    }

    // ──────────────────────────────────────────────────────────────────────
    // IUnlockCallback
    // ──────────────────────────────────────────────────────────────────────

    /// @inheritdoc IUnlockCallback
    function unlockCallback(bytes calldata rawData) external returns (bytes memory) {
        if (msg.sender != address(manager)) revert CallerNotManager();

        CallbackData memory data = abi.decode(rawData, (CallbackData));

        BalanceDelta delta = manager.swap(data.key, data.params, data.hookData);

        // Settle negative deltas (pay what we owe to the pool)
        // Take positive deltas (receive what the pool owes us)

        int128 delta0 = delta.amount0();
        int128 delta1 = delta.amount1();

        if (delta0 < 0) {
            // We owe currency0 to the pool
            data.key.currency0.settle(manager, address(this), uint256(uint128(-delta0)), false);
        }
        if (delta1 < 0) {
            // We owe currency1 to the pool
            data.key.currency1.settle(manager, address(this), uint256(uint128(-delta1)), false);
        }
        if (delta0 > 0) {
            // Pool owes us currency0 — take to the original sender
            data.key.currency0.take(manager, data.sender, uint256(uint128(delta0)), false);
        }
        if (delta1 > 0) {
            // Pool owes us currency1 — take to the original sender
            data.key.currency1.take(manager, data.sender, uint256(uint128(delta1)), false);
        }

        return abi.encode(delta);
    }

    // ──────────────────────────────────────────────────────────────────────
    // ERC20 approval helper (one-time setup for pools)
    // ──────────────────────────────────────────────────────────────────────

    /// @notice Approve the PoolManager to spend a token held by this contract.
    /// @dev Useful for settling ERC20 debts. Should be called once per token.
    function approveToken(address token) external onlyOwner {
        IERC20(token).approve(address(manager), type(uint256).max);
    }

    // ──────────────────────────────────────────────────────────────────────
    // Admin: emergency token rescue
    // ──────────────────────────────────────────────────────────────────────

    /// @notice Rescue tokens accidentally sent to this contract.
    function rescueTokens(address token, address to, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(to, amount);
    }

    /// @notice Rescue ETH accidentally sent to this contract.
    function rescueETH(address payable to, uint256 amount) external onlyOwner {
        Address.sendValue(to, amount);
    }

    // ──────────────────────────────────────────────────────────────────────
    // Internal helpers
    // ──────────────────────────────────────────────────────────────────────

    /// @dev Refund only the portion of the contract balance that exceeds
    ///      `baseline`. The baseline is captured at function entry as
    ///      `address(this).balance - msg.value`, so any ETH that was
    ///      already sitting in the contract (accidental sends, stuck
    ///      prior-swap remnants) stays out of reach of the swap caller
    ///      and can only be withdrawn via `rescueETH` by the owner.
    function _refundETH(address recipient, uint256 baseline) internal {
        uint256 balance = address(this).balance;
        if (balance > baseline) {
            Address.sendValue(payable(recipient), balance - baseline);
        }
    }

    // Uniswap v4 sqrt price limits (from TickMath)
    // MIN_SQRT_PRICE + 1 for zeroForOne swaps, MAX_SQRT_PRICE - 1 for oneForZero
    uint160 internal constant _MIN_SQRT_PRICE_LIMIT = 4295128740;
    uint160 internal constant _MAX_SQRT_PRICE_LIMIT = 1461446703485210103287273052203988822378723970341;
}
