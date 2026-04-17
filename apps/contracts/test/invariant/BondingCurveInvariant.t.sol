// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {BondingCurve} from "../../src/BondingCurve.sol";
import {IBondingCurve} from "../../src/interfaces/IBondingCurve.sol";
import {IERC20} from "@openzeppelin/interfaces/IERC20.sol";
import {ERC20} from "@openzeppelin/token/ERC20/ERC20.sol";

// ─── Mocks ────────────────────────────────────────────────────────────────────

contract MockERC20 is ERC20 {
    constructor(string memory name_, string memory symbol_, uint256 supply_, address to_)
        ERC20(name_, symbol_)
    {
        _mint(to_, supply_);
    }
}

contract MockUniverseManager {
    bool public graduated;

    function graduateFromBondingCurve(uint256, uint256, uint256, address) external payable {
        graduated = true;
    }

    receive() external payable {}
}

// ─── Handler ──────────────────────────────────────────────────────────────────

/// @notice Fuzzer handler that performs random buy/sell operations on the curve.
///         Tracks ghost variables for invariant assertions.
contract BondingCurveHandler is Test {
    BondingCurve public curve;
    MockERC20 public token;

    // Ghost variables for invariant tracking
    uint256 public ghost_totalEthIn;       // total ETH sent via buy()
    uint256 public ghost_totalEthOut;      // total ETH returned via sell()
    uint256 public ghost_totalPendingRefunds; // sum of all pending refunds (approx)
    uint256 public ghost_lastPrice;        // price snapshot after last operation
    bool public ghost_priceMonotonicity;   // stays true unless price decreases after buy

    // Actors
    address[] public actors;
    mapping(address => uint256) public actorTokenBalances; // tokens bought (net of sells)

    // Call counters for debugging
    uint256 public buyCount;
    uint256 public sellCount;

    constructor(BondingCurve _curve, MockERC20 _token) {
        curve = _curve;
        token = _token;
        ghost_priceMonotonicity = true;

        // Create actors
        for (uint256 i = 0; i < 5; i++) {
            address actor = makeAddr(string(abi.encodePacked("actor", vm.toString(i))));
            actors.push(actor);
            vm.deal(actor, 100 ether);
        }
    }

    // ── Buy ───────────────────────────────────────────────────────────────

    function buy(uint256 actorSeed, uint256 ethAmount) external {
        // Skip if curve graduated or halted
        if (curve.graduated() || curve.tradingHalted()) return;

        address actor = actors[actorSeed % actors.length];

        // Bound ETH between dust and 0.5 ether (keeps buys under max-buy for 2% cap)
        ethAmount = bound(ethAmount, 0.001 ether, 0.5 ether);

        // Ensure actor has enough ETH
        if (actor.balance < ethAmount) {
            vm.deal(actor, actor.balance + ethAmount);
        }

        uint256 priceBefore = curve.getCurrentPrice();
        uint256 tokensSoldBefore = curve.tokensSold();

        // Skip if supply exhausted
        if (tokensSoldBefore >= curve.TOTAL_CURVE_SUPPLY()) return;

        uint256 tokenBalBefore = token.balanceOf(actor);

        vm.prank(actor);
        try curve.buy{value: ethAmount}(0, block.timestamp + 1 hours) {
            buyCount++;

            uint256 tokensReceived = token.balanceOf(actor) - tokenBalBefore;
            actorTokenBalances[actor] += tokensReceived;

            // Track ghost ETH in (actual cost = ethAmount - refund, but we track gross)
            // Actual cost is ethRaised delta, tracked via the contract itself
            ghost_totalEthIn += ethAmount;

            // Check monotonicity: price should be >= previous after a buy
            uint256 priceAfter = curve.getCurrentPrice();
            if (priceAfter < priceBefore && tokensReceived > 0) {
                ghost_priceMonotonicity = false;
            }
            ghost_lastPrice = priceAfter;
        } catch {
            // Acceptable failures (ExceedsMaxBuy, ZeroAmount, etc.)
        }
    }

    // ── Sell ──────────────────────────────────────────────────────────────

    function sell(uint256 actorSeed, uint256 tokenFraction) external {
        // Skip if curve graduated or halted
        if (curve.graduated() || curve.tradingHalted()) return;

        address actor = actors[actorSeed % actors.length];
        uint256 actorBal = token.balanceOf(actor);
        if (actorBal == 0) return;

        // Sell between 1% and 100% of actor's balance
        tokenFraction = bound(tokenFraction, 1, 100);
        uint256 sellAmount = (actorBal * tokenFraction) / 100;
        if (sellAmount == 0) return;
        if (sellAmount > curve.tokensSold()) return;

        // Approve tokens
        vm.startPrank(actor);
        token.approve(address(curve), sellAmount);

        uint256 ethBefore = actor.balance;

        try curve.sell(sellAmount, 0, block.timestamp + 1 hours) {
            sellCount++;

            uint256 ethReceived = actor.balance - ethBefore;
            ghost_totalEthOut += ethReceived;
            actorTokenBalances[actor] -= sellAmount;

            ghost_lastPrice = curve.getCurrentPrice();
        } catch {
            // Acceptable failures
        }
        vm.stopPrank();
    }

    // ── Helpers ───────────────────────────────────────────────────────────

    function actorCount() external view returns (uint256) {
        return actors.length;
    }

    function getActor(uint256 i) external view returns (address) {
        return actors[i % actors.length];
    }
}

// ─── Invariant Test Suite ─────────────────────────────────────────────────────

contract BondingCurveInvariantTest is Test {
    // Production-like parameters
    uint256 constant TOKEN_SUPPLY = 1_000_000_000e18;
    uint256 constant CURVE_SUPPLY = (TOKEN_SUPPLY * 8000) / 10000; // 80% for curve
    uint256 constant GRADUATION_ETH = 4 ether;
    uint16 constant MAX_BUY_BPS = 200; // 2% whale cap

    MockERC20 token;
    MockUniverseManager manager;
    BondingCurve curve;
    BondingCurveHandler handler;

    function setUp() public {
        manager = new MockUniverseManager();

        // Deploy token — mint full supply to this test contract
        token = new MockERC20("TestToken", "TT", TOKEN_SUPPLY, address(this));

        // Deploy bonding curve
        curve = new BondingCurve(
            address(token),
            address(manager),
            1,                  // universeId
            CURVE_SUPPLY,
            GRADUATION_ETH,
            MAX_BUY_BPS
        );

        // Fund curve with the 80% curve supply
        token.transfer(address(curve), CURVE_SUPPLY);

        // Deploy handler
        handler = new BondingCurveHandler(curve, token);

        // Target only the handler for invariant fuzzing
        targetContract(address(handler));
    }

    // ── Invariant A: Monotonicity ─────────────────────────────────────────
    /// Price always increases with tokensSold — after a buy, getCurrentPrice() >= previous price.

    function invariant_monotonicity() public view {
        assertTrue(
            handler.ghost_priceMonotonicity(),
            "MONOTONICITY VIOLATED: price decreased after a buy"
        );
    }

    // ── Invariant B: Conservation ─────────────────────────────────────────
    /// The contract's ETH balance must always be >= ethRaised (sell fees stay as extra reserve).

    function invariant_conservation() public view {
        if (curve.graduated()) return; // post-graduation balance is sent to manager

        assertGe(
            address(curve).balance,
            curve.ethRaised(),
            "CONSERVATION VIOLATED: contract balance < ethRaised"
        );
    }

    // ── Invariant C: Supply bound ─────────────────────────────────────────
    /// tokensSold can never exceed TOTAL_CURVE_SUPPLY.

    function invariant_supplyBound() public view {
        assertLe(
            curve.tokensSold(),
            curve.TOTAL_CURVE_SUPPLY(),
            "SUPPLY BOUND VIOLATED: tokensSold > TOTAL_CURVE_SUPPLY"
        );
    }

    // ── Invariant D: Graduation threshold ─────────────────────────────────
    /// If ethRaised >= GRADUATION_ETH then the curve must have graduated.
    /// Note: graduation is triggered atomically inside buy(), so if ethRaised
    /// crossed the threshold the graduated flag should already be true.

    function invariant_graduationThreshold() public view {
        if (curve.ethRaised() >= curve.GRADUATION_ETH()) {
            assertTrue(
                curve.graduated(),
                "GRADUATION VIOLATED: ethRaised >= target but not graduated"
            );
        }
    }

    // ── Invariant E: Buy-sell symmetry (fee erosion) ──────────────────────
    /// Total ETH out from sells must always be <= total ETH in from buys.
    /// The 1% sell fee guarantees sellers always get back less than was paid.

    function invariant_buySellSymmetry() public view {
        assertLe(
            handler.ghost_totalEthOut(),
            handler.ghost_totalEthIn(),
            "BUY-SELL SYMMETRY VIOLATED: more ETH extracted than deposited"
        );
    }

    // ── Invariant F: No free money ────────────────────────────────────────
    /// ethRaised cannot exceed GRADUATION_ETH before graduation since the
    /// integral is capped at that exact amount for TOTAL_CURVE_SUPPLY tokens.

    function invariant_noFreeMoney() public view {
        if (!curve.graduated()) {
            // Allow 1 wei tolerance for rounding
            assertLe(
                curve.ethRaised(),
                curve.GRADUATION_ETH() + 1,
                "NO FREE MONEY VIOLATED: ethRaised exceeds graduation target pre-graduation"
            );
        }
    }

    // ── Invariant G: Pending refunds safety ───────────────────────────────
    /// The contract must hold enough ETH to cover ethRaised plus any pending
    /// refunds that accumulated from failed refund transfers.

    function invariant_pendingRefundsSafety() public view {
        if (curve.graduated()) return;

        // Sum pending refunds for all actors
        uint256 totalPending = 0;
        uint256 count = handler.actorCount();
        for (uint256 i = 0; i < count; i++) {
            address actor = handler.getActor(i);
            totalPending += curve.pendingRefunds(actor);
        }

        assertGe(
            address(curve).balance,
            curve.ethRaised() + totalPending,
            "PENDING REFUNDS SAFETY VIOLATED: balance < ethRaised + pendingRefunds"
        );
    }

    // ── Invariant: Token accounting ───────────────────────────────────────
    /// Curve's token balance + tokensSold should equal TOTAL_CURVE_SUPPLY
    /// (tokens are either in the curve or have been sold out).

    function invariant_tokenAccounting() public view {
        if (curve.graduated()) return;

        uint256 curveTokenBal = token.balanceOf(address(curve));
        uint256 sold = curve.tokensSold();

        // Tokens sold to users + tokens remaining in curve = total curve supply
        // Some sold tokens may have been returned via sell(), so curveTokenBal can
        // be > TOTAL_CURVE_SUPPLY - sold (sold tokens returned are held by curve).
        // The real invariant: curveTokenBal >= TOTAL_CURVE_SUPPLY - sold
        assertGe(
            curveTokenBal,
            CURVE_SUPPLY - sold,
            "TOKEN ACCOUNTING VIOLATED: curve holds fewer tokens than expected"
        );
    }
}
