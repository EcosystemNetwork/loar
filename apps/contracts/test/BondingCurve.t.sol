// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {BondingCurve} from "../src/BondingCurve.sol";
import {IBondingCurve} from "../src/interfaces/IBondingCurve.sol";
import {IERC20} from "@openzeppelin/interfaces/IERC20.sol";
import {ERC20} from "@openzeppelin/token/ERC20/ERC20.sol";

/// @dev Minimal ERC20 for testing
contract MockToken is ERC20 {
    constructor(string memory name, string memory symbol, uint256 supply, address to)
        ERC20(name, symbol)
    {
        _mint(to, supply);
    }
}

/// @dev Mock UniverseManager that accepts graduation calls
contract MockUniverseManager {
    bool public graduated;
    uint256 public lastUniverseId;
    uint256 public lastEthAmount;
    uint256 public lastTokenAmount;

    function graduateFromBondingCurve(
        uint256 universeId,
        uint256 ethAmount,
        uint256 tokenAmount,
        address
    ) external payable {
        graduated = true;
        lastUniverseId = universeId;
        lastEthAmount = ethAmount;
        lastTokenAmount = tokenAmount;
    }

    // Accept ETH
    receive() external payable {}
}

contract BondingCurveTest is Test {
    // ── V1 params: 1B supply ──
    uint256 constant TOKEN_SUPPLY_V1 = 1_000_000_000e18;
    uint256 constant CURVE_SUPPLY_V1 = (TOKEN_SUPPLY_V1 * 8000) / 10000; // 80%

    // ── V2/V3 params: 100B supply ──
    uint256 constant TOKEN_SUPPLY_V3 = 100_000_000_000e18;
    uint256 constant CURVE_SUPPLY_V3 = (TOKEN_SUPPLY_V3 * 8000) / 10000;

    uint256 constant GRADUATION_ETH = 4 ether;
    uint16 constant MAX_BUY_BPS = 10000; // 100% — no whale limit for math tests
    uint16 constant REAL_MAX_BUY_BPS = 200; // 2% — production value

    MockToken tokenV1;
    MockToken tokenV3;
    MockUniverseManager manager;
    BondingCurve curveV1;
    BondingCurve curveV3;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        manager = new MockUniverseManager();

        // Deploy V1 curve (1B supply)
        tokenV1 = new MockToken("TokenV1", "TV1", TOKEN_SUPPLY_V1, address(this));
        curveV1 = new BondingCurve(
            address(tokenV1), address(manager), 1,
            CURVE_SUPPLY_V1, GRADUATION_ETH, MAX_BUY_BPS
        );
        tokenV1.transfer(address(curveV1), CURVE_SUPPLY_V1);

        // Deploy V3 curve (100B supply)
        tokenV3 = new MockToken("TokenV3", "TV3", TOKEN_SUPPLY_V3, address(this));
        curveV3 = new BondingCurve(
            address(tokenV3), address(manager), 2,
            CURVE_SUPPLY_V3, GRADUATION_ETH, MAX_BUY_BPS
        );
        tokenV3.transfer(address(curveV3), CURVE_SUPPLY_V3);

        // Fund test users
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
    }

    // ═══════════════════════════════════════════════════════════════
    // UNIT TESTS — Constructor & slopeScaled
    // ═══════════════════════════════════════════════════════════════

    function test_slopeScaled_nonZero_V1() public view {
        assertGt(curveV1.slopeScaled(), 0, "V1 slopeScaled must be > 0");
    }

    function test_slopeScaled_nonZero_V3() public view {
        assertGt(curveV3.slopeScaled(), 0, "V3 slopeScaled must be > 0");
    }

    function test_constructor_reverts_if_slope_zero() public {
        // An absurdly large supply with tiny graduation would round to zero
        // even with PRECISION=1e44. Test the guard.
        // supply = 1e38 (way beyond any real use), graduation = 1 wei
        // slopeScaled = mulDiv(2, 1e44, 1e76) = 2e44/1e76 = 0
        vm.expectRevert(IBondingCurve.SlopeIsZero.selector);
        new BondingCurve(
            address(tokenV1), address(manager), 99,
            1e38, 1, 200
        );
    }

    // ═══════════════════════════════════════════════════════════════
    // UNIT TESTS — Buy / Sell / Graduate
    // ═══════════════════════════════════════════════════════════════

    function test_buy_basic_V1() public {
        vm.prank(alice);
        curveV1.buy{value: 0.1 ether}(0);

        assertGt(curveV1.tokensSold(), 0, "Should have sold tokens");
        assertGt(curveV1.ethRaised(), 0, "Should have raised ETH");
        assertGt(tokenV1.balanceOf(alice), 0, "Alice should have tokens");
    }

    function test_buy_basic_V3() public {
        vm.prank(alice);
        curveV3.buy{value: 0.1 ether}(0);

        assertGt(curveV3.tokensSold(), 0, "Should have sold tokens");
        assertGt(curveV3.ethRaised(), 0, "Should have raised ETH");
        assertGt(tokenV3.balanceOf(alice), 0, "Alice should have tokens");
    }

    function test_buy_then_sell_V1() public {
        vm.startPrank(alice);
        curveV1.buy{value: 0.5 ether}(0);

        uint256 bought = tokenV1.balanceOf(alice);
        assertGt(bought, 0);

        // Sell half
        uint256 sellAmount = bought / 2;
        tokenV1.approve(address(curveV1), sellAmount);
        uint256 ethBefore = alice.balance;
        curveV1.sell(sellAmount, 0);

        assertGt(alice.balance, ethBefore, "Should have received ETH");
        assertEq(tokenV1.balanceOf(alice), bought - sellAmount);
        vm.stopPrank();
    }

    function test_graduation_V1() public {
        // Buy with enough ETH to fill the curve and trigger graduation.
        // No maxBuy limit on curveV1 (MAX_BUY_BPS=10000). Excess ETH is refunded.
        vm.deal(alice, 10 ether);
        vm.prank(alice);
        curveV1.buy{value: 5 ether}(0);

        assertTrue(curveV1.graduated(), "Should have graduated");
        assertTrue(manager.graduated(), "Manager should have received graduation");
        // Excess ETH refunded
        assertGt(alice.balance, 4 ether, "Should have received refund");
    }

    function test_emergencyHalt_onlyManager() public {
        vm.prank(alice);
        vm.expectRevert("Only universe manager");
        curveV1.setTradingHalted(true);

        vm.prank(address(manager));
        curveV1.setTradingHalted(true);
        assertTrue(curveV1.tradingHalted());

        // Can't buy when halted
        vm.prank(alice);
        vm.expectRevert(IBondingCurve.TradingIsHalted.selector);
        curveV1.buy{value: 0.1 ether}(0);

        // Resume
        vm.prank(address(manager));
        curveV1.setTradingHalted(false);
        assertFalse(curveV1.tradingHalted());

        // Can buy again
        vm.prank(alice);
        curveV1.buy{value: 0.1 ether}(0);
    }

    function test_getCurrentPricePerToken() public {
        vm.prank(alice);
        curveV1.buy{value: 0.5 ether}(0);

        uint256 pricePerToken = curveV1.getCurrentPricePerToken();
        assertGt(pricePerToken, 0, "Price per token should be non-zero after buys");
    }

    // ═══════════════════════════════════════════════════════════════
    // FUZZ TESTS — BondingCurve math invariants
    // ═══════════════════════════════════════════════════════════════

    /// @dev Invariant: tokensSold never exceeds TOTAL_CURVE_SUPPLY
    function testFuzz_tokensSold_bounded(uint256 ethAmount) public {
        ethAmount = bound(ethAmount, 0.001 ether, 10 ether);
        vm.deal(alice, ethAmount);
        vm.prank(alice);

        try curveV1.buy{value: ethAmount}(0) {} catch {}

        assertLe(curveV1.tokensSold(), CURVE_SUPPLY_V1, "tokensSold > supply");
    }

    /// @dev Invariant: contract balance >= ethRaised (sell fees add extra)
    ///      Only valid before graduation — after graduation ETH moves to manager.
    function testFuzz_balance_geq_ethRaised(uint256 ethAmount) public {
        ethAmount = bound(ethAmount, 0.001 ether, 3.5 ether); // below graduation
        vm.deal(alice, ethAmount);
        vm.prank(alice);

        try curveV1.buy{value: ethAmount}(0) {} catch {}

        if (!curveV1.graduated()) {
            assertGe(
                address(curveV1).balance,
                curveV1.ethRaised(),
                "balance < ethRaised"
            );
        }
    }

    /// @dev Invariant: buy then sell full amount yields less ETH than paid (sell fee)
    function testFuzz_sell_returns_less_than_paid(uint256 ethAmount) public {
        ethAmount = bound(ethAmount, 0.01 ether, 3 ether);
        vm.deal(alice, ethAmount);

        vm.startPrank(alice);
        curveV1.buy{value: ethAmount}(0);

        uint256 tokensBought = tokenV1.balanceOf(alice);
        if (tokensBought == 0) return;

        tokenV1.approve(address(curveV1), tokensBought);

        uint256 ethBefore = alice.balance;
        curveV1.sell(tokensBought, 0);
        uint256 ethReceived = alice.balance - ethBefore;
        vm.stopPrank();

        // Must receive less due to 1% sell fee
        assertLt(ethReceived, ethAmount, "Should lose to sell fee");
    }

    /// @dev Invariant: getCostForTokens is monotonically increasing with tokensSold
    function testFuzz_cost_monotonic(uint256 seed1, uint256 seed2) public {
        uint256 eth1 = bound(seed1, 0.01 ether, 1 ether);
        uint256 eth2 = bound(seed2, 0.01 ether, 1 ether);

        vm.deal(alice, eth1);
        vm.prank(alice);
        try curveV1.buy{value: eth1}(0) {} catch { return; }

        uint256 tokens1 = tokenV1.balanceOf(alice);
        if (tokens1 == 0) return;

        uint256 sold1 = curveV1.tokensSold();

        vm.deal(bob, eth2);
        vm.prank(bob);
        try curveV1.buy{value: eth2}(0) {} catch { return; }

        uint256 tokens2 = tokenV1.balanceOf(bob);
        if (tokens2 == 0) return;

        // Price should increase: tokens per ETH should decrease (or stay same)
        // Equivalently: tokens1/eth1 >= tokens2/eth2 → tokens1*eth2 >= tokens2*eth1
        assertGe(
            tokens1 * eth2,
            tokens2 * eth1,
            "Price should increase or stay flat"
        );
    }

    /// @dev Invariant: getTokensForEth and getCostForTokens are inverses (within rounding)
    function testFuzz_inverse_consistency(uint256 ethAmount) public view {
        ethAmount = bound(ethAmount, 0.001 ether, 3 ether);

        uint256 tokens = curveV1.getTokensForEth(ethAmount);
        if (tokens == 0) return;

        uint256 cost = _getCostExternally(curveV1, tokens);

        // Cost should be <= ethAmount (rounding down in token count)
        assertLe(cost, ethAmount, "Cost exceeds input ETH");

        // But not off by more than 0.1% relative error
        if (ethAmount > 0) {
            uint256 diff = ethAmount - cost;
            // Allow up to 0.1% or 1 wei tolerance
            assertLe(diff * 1000, ethAmount + 1, "Inverse error > 0.1%");
        }
    }

    /// @dev Invariant: full curve purchase costs exactly GRADUATION_ETH (within rounding)
    function test_fullCurve_costs_graduationEth_V1() public view {
        uint256 cost = _getCostExternally(curveV1, CURVE_SUPPLY_V1);

        // Should be within 0.01% of GRADUATION_ETH
        uint256 diff = cost > GRADUATION_ETH
            ? cost - GRADUATION_ETH
            : GRADUATION_ETH - cost;

        assertLe(
            diff * 10000,
            GRADUATION_ETH,
            "Full curve cost deviates > 0.01% from GRADUATION_ETH"
        );
    }

    function test_fullCurve_costs_graduationEth_V3() public view {
        uint256 cost = _getCostExternally(curveV3, CURVE_SUPPLY_V3);

        uint256 diff = cost > GRADUATION_ETH
            ? cost - GRADUATION_ETH
            : GRADUATION_ETH - cost;

        assertLe(
            diff * 10000,
            GRADUATION_ETH,
            "Full curve cost deviates > 0.01% from GRADUATION_ETH"
        );
    }

    /// @dev Invariant: can't sell more than was bought (global)
    function testFuzz_cantSellMoreThanBought(uint256 ethAmount, uint256 sellExtra) public {
        ethAmount = bound(ethAmount, 0.01 ether, 2 ether);
        sellExtra = bound(sellExtra, 1, 1e24);

        vm.deal(alice, ethAmount);
        vm.startPrank(alice);
        curveV1.buy{value: ethAmount}(0);

        uint256 bought = tokenV1.balanceOf(alice);
        if (bought == 0) return;

        uint256 tryToSell = bought + sellExtra;
        tokenV1.approve(address(curveV1), tryToSell);

        vm.expectRevert(IBondingCurve.InsufficientTokens.selector);
        curveV1.sell(tryToSell, 0);
        vm.stopPrank();
    }

    /// @dev Fuzz: various supply/graduation combos produce valid slopeScaled
    function testFuzz_constructor_various_params(
        uint256 supply,
        uint256 gradEth
    ) public {
        supply = bound(supply, 1e20, 1e29);   // 100 tokens to 100B tokens
        gradEth = bound(gradEth, 0.1 ether, 100 ether);

        MockToken t = new MockToken("T", "T", supply, address(this));

        try new BondingCurve(
            address(t), address(manager), 99,
            supply, gradEth, 10000
        ) returns (BondingCurve c) {
            assertGt(c.slopeScaled(), 0, "slopeScaled must be > 0");

            // Verify full curve cost ~ gradEth (within 1% for reasonable params)
            uint256 cost = _getCostExternally(c, supply);
            uint256 diff = cost > gradEth
                ? cost - gradEth
                : gradEth - cost;
            assertLe(diff * 100, gradEth + 1, "Full curve cost off by > 1%");
        } catch {
            // SlopeIsZero is acceptable for extreme params
        }
    }

    /// @dev Anti-whale: buying more than MAX_BUY_AMOUNT reverts
    function test_antiWhale_maxBuy() public {
        MockToken whaleToken = new MockToken("WT", "WT", TOKEN_SUPPLY_V1, address(this));
        BondingCurve whaleCurve = new BondingCurve(
            address(whaleToken), address(manager), 99,
            CURVE_SUPPLY_V1, GRADUATION_ETH, REAL_MAX_BUY_BPS
        );
        whaleToken.transfer(address(whaleCurve), CURVE_SUPPLY_V1);

        // A large buy should revert
        vm.deal(alice, 10 ether);
        vm.prank(alice);
        vm.expectRevert(IBondingCurve.ExceedsMaxBuy.selector);
        whaleCurve.buy{value: 1 ether}(0);
    }

    // ── Helpers ──────────────────────────────────────────────────────

    /// @dev Call getCostForTokens externally by computing via getEthForTokens
    ///      Since getEthForTokens includes sell fee, we use getTokensForEth inverse
    function _getCostExternally(BondingCurve c, uint256 amount) internal view returns (uint256) {
        // Use the curveState to access internal math indirectly
        // cost = slopeScaled * ((0 + amount)^2 - 0^2) / (2 * PRECISION)
        // This matches _getCostForTokens(amount, 0) exactly
        uint256 slopeScaled = c.slopeScaled();
        uint256 squareDiff = amount * amount; // fromSold=0, so (amount+0)*amount = amount²
        // Replicate mulDiv: slopeScaled * squareDiff / (2 * PRECISION)
        // PRECISION = 1e44
        return (slopeScaled * squareDiff) / (2 * 1e44);
    }
}
