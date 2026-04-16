// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/proxy/ERC1967/ERC1967Proxy.sol";
import {UUPSUpgradeable} from "@openzeppelin-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin-upgradeable/access/OwnableUpgradeable.sol";
import {PaymentRouter} from "../src/PaymentRouter.sol";
import {CreditManager} from "../src/revenue/CreditManager.sol";
import {LoarToken} from "../src/LoarToken.sol";
import {IERC20} from "@openzeppelin/interfaces/IERC20.sol";
import {ERC20} from "@openzeppelin/token/ERC20/ERC20.sol";

// ── Helper: a malicious discount token that reverts on balanceOf ──
contract MaliciousToken {
    function balanceOf(address) external pure returns (uint256) {
        revert("malicious revert");
    }
}

// ── Helper: a discount token that consumes excessive gas ──
contract GasGuzzlerToken {
    function balanceOf(address) external view returns (uint256) {
        // Burn gas in an infinite-ish loop; CreditManager wraps in try/catch
        uint256 x;
        for (uint256 i = 0; i < type(uint256).max; i++) {
            x += i;
        }
        return x;
    }
}

// ── Helper: simple ERC20 for discount token testing ──
contract SimpleToken is ERC20 {
    constructor() ERC20("Discount", "DISC") {
        _mint(msg.sender, 1_000_000e18);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

// ── Helper: CreditManager V2 mock for upgrade testing ──
contract CreditManagerV2 is CreditManager {
    function version() external pure returns (string memory) {
        return "v2";
    }
}

contract CreditManagerTest is Test {
    CreditManager public credits;
    PaymentRouter public router;
    LoarToken public loarToken;

    address deployer = makeAddr("deployer");
    address platform = makeAddr("platform");
    address treasury = makeAddr("treasury");
    address user = makeAddr("user");
    address user2 = makeAddr("user2");
    address stranger = makeAddr("stranger");

    function setUp() public {
        vm.startPrank(deployer);

        // Deploy PaymentRouter
        PaymentRouter routerImpl = new PaymentRouter();
        router = PaymentRouter(address(new ERC1967Proxy(
            address(routerImpl),
            abi.encodeCall(PaymentRouter.initialize, (treasury, 1000, address(0), 0))
        )));

        // Deploy real LoarToken — treasury gets 70%, deployer (initialHolder) gets 30%
        loarToken = new LoarToken(treasury, deployer);

        // Set loar token on PaymentRouter
        router.setLoarToken(address(loarToken));

        // Deploy CreditManager
        CreditManager creditsImpl = new CreditManager();
        credits = CreditManager(address(new ERC1967Proxy(
            address(creditsImpl),
            abi.encodeCall(CreditManager.initialize, (
                address(loarToken), platform, treasury, address(router)
            ))
        )));

        vm.stopPrank();

        // Make CreditManager and PaymentRouter fee-exempt on LoarToken
        // (required in production — otherwise transfer fee causes amount mismatch)
        vm.startPrank(deployer);
        loarToken.setFeeExempt(address(credits), true);
        loarToken.setFeeExempt(address(router), true);
        vm.stopPrank();

        // Setup: give user some ETH and LOAR from deployer's 30% allocation
        vm.deal(user, 100 ether);
        vm.deal(user2, 100 ether);
        vm.prank(deployer);
        loarToken.transfer(user, 10_000e18);
        vm.prank(deployer);
        loarToken.transfer(user2, 10_000e18);
    }

    // ═══════════════════════════════════════════════════════════════
    // ── 1. Initialization ──
    // ═══════════════════════════════════════════════════════════════

    function test_initialize_setsAllState() public view {
        assertEq(credits.platform(), platform);
        assertEq(credits.treasury(), treasury);
        assertEq(credits.owner(), deployer);
        assertEq(address(credits.loarToken()), address(loarToken));
        assertEq(address(credits.paymentRouter()), address(router));
        assertEq(credits.nextPackageId(), 0);
    }

    function test_initialize_revert_zeroPlatform() public {
        CreditManager impl = new CreditManager();
        vm.expectRevert(CreditManager.ZeroAddress.selector);
        new ERC1967Proxy(
            address(impl),
            abi.encodeCall(CreditManager.initialize, (address(loarToken), address(0), treasury, address(router)))
        );
    }

    function test_initialize_revert_zeroTreasury() public {
        CreditManager impl = new CreditManager();
        vm.expectRevert(CreditManager.ZeroAddress.selector);
        new ERC1967Proxy(
            address(impl),
            abi.encodeCall(CreditManager.initialize, (address(loarToken), platform, address(0), address(router)))
        );
    }

    function test_initialize_allowsZeroLoarToken() public {
        // loarToken can be address(0) initially — set later via updateLoarToken()
        CreditManager impl = new CreditManager();
        CreditManager c = CreditManager(address(new ERC1967Proxy(
            address(impl),
            abi.encodeCall(CreditManager.initialize, (address(0), platform, treasury, address(router)))
        )));
        assertEq(address(c.loarToken()), address(0));
    }

    function test_initialize_allowsZeroPaymentRouter() public {
        CreditManager impl = new CreditManager();
        CreditManager c = CreditManager(address(new ERC1967Proxy(
            address(impl),
            abi.encodeCall(CreditManager.initialize, (address(loarToken), platform, treasury, address(0)))
        )));
        assertEq(address(c.paymentRouter()), address(0));
    }

    function test_initialize_cannotBeCalledTwice() public {
        vm.expectRevert();
        credits.initialize(address(loarToken), platform, treasury, address(router));
    }

    function test_defaultGenerationCosts() public view {
        assertEq(credits.generationCosts(keccak256("image")), 3);
        assertEq(credits.generationCosts(keccak256("video_draft")), 5);
        assertEq(credits.generationCosts(keccak256("video_standard")), 13);
        assertEq(credits.generationCosts(keccak256("video_premium")), 35);
        assertEq(credits.generationCosts(keccak256("story")), 5);
        assertEq(credits.generationCosts(keccak256("spinoff")), 20);
        assertEq(credits.generationCosts(keccak256("character")), 8);
        assertEq(credits.generationCosts(keccak256("scene")), 15);
        assertEq(credits.generationCosts(keccak256("voiceover")), 10);
        assertEq(credits.generationCosts(keccak256("caption")), 2);
    }

    function test_constants() public view {
        assertEq(credits.FIAT_MARGIN_BPS(), 3500);
        assertEq(credits.LOAR_MARGIN_BPS(), 2500);
    }

    // ═══════════════════════════════════════════════════════════════
    // ── 2. Package Management ──
    // ═══════════════════════════════════════════════════════════════

    function test_createPackage_successfulCreation() public {
        vm.prank(platform);
        uint256 id = credits.createPackage("Starter", 100, 0.01 ether, 50e18, 10);
        assertEq(id, 0);

        (uint256 pkgId, string memory name, uint256 creditAmount, uint256 priceWei,
         uint256 priceLoar, uint256 bonusCredits, bool active) = credits.packages(0);
        assertEq(pkgId, 0);
        assertEq(name, "Starter");
        assertEq(creditAmount, 100);
        assertEq(priceWei, 0.01 ether);
        assertEq(priceLoar, 50e18);
        assertEq(bonusCredits, 10);
        assertTrue(active);
    }

    function test_createPackage_incrementsId() public {
        vm.startPrank(platform);
        uint256 id0 = credits.createPackage("Starter", 100, 0.01 ether, 50e18, 10);
        uint256 id1 = credits.createPackage("Pro", 500, 0.05 ether, 200e18, 50);
        uint256 id2 = credits.createPackage("Ultra", 2000, 0.15 ether, 800e18, 300);
        vm.stopPrank();

        assertEq(id0, 0);
        assertEq(id1, 1);
        assertEq(id2, 2);
        assertEq(credits.nextPackageId(), 3);
    }

    function test_createPackage_emitsEvent() public {
        vm.expectEmit(true, false, false, true, address(credits));
        emit CreditManager.PackageCreated(0, "Starter", 100, 0.01 ether, 50e18);

        vm.prank(platform);
        credits.createPackage("Starter", 100, 0.01 ether, 50e18, 10);
    }

    function test_createPackage_revert_notPlatform() public {
        vm.prank(stranger);
        vm.expectRevert(CreditManager.NotPlatform.selector);
        credits.createPackage("x", 100, 0.01 ether, 50e18, 0);
    }

    function test_createPackage_revert_ownerIsNotPlatform() public {
        vm.prank(deployer);
        vm.expectRevert(CreditManager.NotPlatform.selector);
        credits.createPackage("x", 100, 0.01 ether, 50e18, 0);
    }

    function test_createPackage_zeroBonusCredits() public {
        vm.prank(platform);
        uint256 id = credits.createPackage("NoBonusPack", 50, 0.005 ether, 25e18, 0);
        (,,,,, uint256 bonusCredits,) = credits.packages(id);
        assertEq(bonusCredits, 0);
    }

    function test_deactivatePackage() public {
        vm.startPrank(platform);
        credits.createPackage("Starter", 100, 0.01 ether, 50e18, 10);
        credits.deactivatePackage(0);
        vm.stopPrank();

        (,,,,,, bool active) = credits.packages(0);
        assertFalse(active);
    }

    function test_deactivatePackage_revert_notPlatform() public {
        vm.prank(platform);
        credits.createPackage("Starter", 100, 0.01 ether, 50e18, 10);

        vm.prank(stranger);
        vm.expectRevert(CreditManager.NotPlatform.selector);
        credits.deactivatePackage(0);
    }

    // ═══════════════════════════════════════════════════════════════
    // ── 3. Purchase with ETH (no discount overload) ──
    // ═══════════════════════════════════════════════════════════════

    function test_purchaseWithEth_successfulPurchase() public {
        vm.prank(platform);
        credits.createPackage("Starter", 100, 0.01 ether, 50e18, 10);

        vm.prank(user);
        credits.purchaseWithEth{value: 0.01 ether}(0);

        assertEq(credits.getBalance(user), 110); // 100 base + 10 bonus
    }

    function test_purchaseWithEth_overpayment() public {
        // Overpaying should succeed (excess goes to treasury via router)
        vm.prank(platform);
        credits.createPackage("Starter", 100, 0.01 ether, 50e18, 10);

        uint256 treasuryBalBefore = treasury.balance;

        vm.prank(user);
        credits.purchaseWithEth{value: 1 ether}(0);

        assertEq(credits.getBalance(user), 110);
        // All ETH routed to treasury
        assertEq(treasury.balance - treasuryBalBefore, 1 ether);
    }

    function test_purchaseWithEth_exactMinimum() public {
        vm.prank(platform);
        credits.createPackage("Minimum", 1, 1 wei, 1, 0);

        vm.prank(user);
        credits.purchaseWithEth{value: 1 wei}(0);

        assertEq(credits.getBalance(user), 1);
    }

    function test_purchaseWithEth_emitsEvent() public {
        vm.prank(platform);
        credits.createPackage("Starter", 100, 0.01 ether, 50e18, 10);

        vm.expectEmit(true, true, false, true, address(credits));
        emit CreditManager.CreditsPurchasedWithEth(user, 0, 100, 10, 0.01 ether);

        vm.prank(user);
        credits.purchaseWithEth{value: 0.01 ether}(0);
    }

    function test_purchaseWithEth_revert_insufficientPayment() public {
        vm.prank(platform);
        credits.createPackage("Starter", 100, 0.01 ether, 50e18, 10);

        vm.prank(user);
        vm.expectRevert(CreditManager.InsufficientPayment.selector);
        credits.purchaseWithEth{value: 0.005 ether}(0);
    }

    function test_purchaseWithEth_revert_zeroValue() public {
        vm.prank(platform);
        credits.createPackage("Starter", 100, 0.01 ether, 50e18, 10);

        vm.prank(user);
        vm.expectRevert(CreditManager.InsufficientPayment.selector);
        credits.purchaseWithEth{value: 0}(0);
    }

    function test_purchaseWithEth_revert_inactivePackage() public {
        vm.startPrank(platform);
        credits.createPackage("Starter", 100, 0.01 ether, 50e18, 10);
        credits.deactivatePackage(0);
        vm.stopPrank();

        vm.prank(user);
        vm.expectRevert(CreditManager.PackageNotActive.selector);
        credits.purchaseWithEth{value: 0.01 ether}(0);
    }

    function test_purchaseWithEth_revert_nonexistentPackage() public {
        // Package 99 was never created; active defaults to false
        vm.prank(user);
        vm.expectRevert(CreditManager.PackageNotActive.selector);
        credits.purchaseWithEth{value: 0.01 ether}(99);
    }

    function test_purchaseWithEth_ethRoutedToTreasury() public {
        vm.prank(platform);
        credits.createPackage("Starter", 100, 0.01 ether, 50e18, 10);

        uint256 treasuryBalBefore = treasury.balance;

        vm.prank(user);
        credits.purchaseWithEth{value: 0.01 ether}(0);

        assertEq(treasury.balance - treasuryBalBefore, 0.01 ether);
    }

    function test_purchaseWithEth_userStatsUpdated() public {
        vm.prank(platform);
        credits.createPackage("Starter", 100, 0.01 ether, 50e18, 10);

        vm.prank(user);
        credits.purchaseWithEth{value: 0.01 ether}(0);

        (uint256 balance, uint256 purchased, uint256 spent, uint256 bonus) = credits.getUserStats(user);
        assertEq(balance, 110);
        assertEq(purchased, 100);
        assertEq(spent, 0);
        assertEq(bonus, 10);
    }

    // ═══════════════════════════════════════════════════════════════
    // ── 4. Purchase with ETH (discount overload) ──
    // ═══════════════════════════════════════════════════════════════

    function test_purchaseWithEth_holderDiscount() public {
        // Deploy a simple ERC20 as the discount token
        vm.prank(deployer);
        SimpleToken discountToken = new SimpleToken();

        // Give user some discount tokens
        vm.prank(deployer);
        discountToken.mint(user, 100e18);

        // Set holder discount: 500 bps = 5%
        vm.prank(platform);
        credits.setHolderDiscount(address(discountToken), 500);

        // Create package
        vm.prank(platform);
        credits.createPackage("Starter", 100, 0.01 ether, 50e18, 10);

        vm.prank(user);
        credits.purchaseWithEth{value: 0.01 ether}(0, address(discountToken));

        // 100 base + 10 bonus + 5% of 100 = 5 discount bonus = 115
        assertEq(credits.getBalance(user), 115);
    }

    function test_purchaseWithEth_holderDiscount_noTokenBalance() public {
        // Deploy discount token but user has zero balance
        vm.prank(deployer);
        SimpleToken discountToken = new SimpleToken();

        vm.prank(platform);
        credits.setHolderDiscount(address(discountToken), 500);

        vm.prank(platform);
        credits.createPackage("Starter", 100, 0.01 ether, 50e18, 10);

        vm.prank(user);
        credits.purchaseWithEth{value: 0.01 ether}(0, address(discountToken));

        // No discount bonus since user holds 0 tokens: 100 + 10 = 110
        assertEq(credits.getBalance(user), 110);
    }

    function test_purchaseWithEth_holderDiscount_zeroDiscountToken() public {
        // Passing address(0) as discount token should give no bonus
        vm.prank(platform);
        credits.createPackage("Starter", 100, 0.01 ether, 50e18, 10);

        vm.prank(user);
        credits.purchaseWithEth{value: 0.01 ether}(0, address(0));

        assertEq(credits.getBalance(user), 110); // no discount
    }

    function test_purchaseWithEth_holderDiscount_unregisteredToken() public {
        // Token address not registered for discount
        vm.prank(deployer);
        SimpleToken discountToken = new SimpleToken();
        vm.prank(deployer);
        discountToken.mint(user, 100e18);

        // Note: no setHolderDiscount call

        vm.prank(platform);
        credits.createPackage("Starter", 100, 0.01 ether, 50e18, 10);

        vm.prank(user);
        credits.purchaseWithEth{value: 0.01 ether}(0, address(discountToken));

        // No discount registered, so 100 + 10 = 110
        assertEq(credits.getBalance(user), 110);
    }

    function test_purchaseWithEth_holderDiscount_maliciousToken() public {
        // Malicious token that reverts on balanceOf — should not DoS purchase
        MaliciousToken malicious = new MaliciousToken();

        vm.prank(platform);
        credits.setHolderDiscount(address(malicious), 500);

        vm.prank(platform);
        credits.createPackage("Starter", 100, 0.01 ether, 50e18, 10);

        // Should succeed without bonus — try/catch handles the revert
        vm.prank(user);
        credits.purchaseWithEth{value: 0.01 ether}(0, address(malicious));

        assertEq(credits.getBalance(user), 110); // no discount bonus
    }

    function test_purchaseWithEth_holderDiscount_emitsEvent() public {
        vm.prank(deployer);
        SimpleToken discountToken = new SimpleToken();
        vm.prank(deployer);
        discountToken.mint(user, 100e18);

        vm.prank(platform);
        credits.setHolderDiscount(address(discountToken), 500);

        vm.prank(platform);
        credits.createPackage("Starter", 100, 0.01 ether, 50e18, 10);

        // bonus = 10 (package) + 5 (5% holder discount) = 15
        vm.expectEmit(true, true, false, true, address(credits));
        emit CreditManager.CreditsPurchasedWithEth(user, 0, 100, 15, 0.01 ether);

        vm.prank(user);
        credits.purchaseWithEth{value: 0.01 ether}(0, address(discountToken));
    }

    function test_purchaseWithEth_holderDiscount_statsTracked() public {
        vm.prank(deployer);
        SimpleToken discountToken = new SimpleToken();
        vm.prank(deployer);
        discountToken.mint(user, 100e18);

        vm.prank(platform);
        credits.setHolderDiscount(address(discountToken), 1000); // 10%

        vm.prank(platform);
        credits.createPackage("Starter", 200, 0.02 ether, 100e18, 20);

        vm.prank(user);
        credits.purchaseWithEth{value: 0.02 ether}(0, address(discountToken));

        // bonusFromDiscount = 200 * 1000 / 10000 = 20
        // totalCredits = 200 + 20 + 20 = 240
        (uint256 balance, uint256 purchased, uint256 spent, uint256 bonus) = credits.getUserStats(user);
        assertEq(balance, 240);
        assertEq(purchased, 200);
        assertEq(spent, 0);
        assertEq(bonus, 40); // 20 package bonus + 20 holder discount bonus
    }

    // ═══════════════════════════════════════════════════════════════
    // ── 5. Purchase with $LOAR ──
    // ═══════════════════════════════════════════════════════════════

    function test_purchaseWithLoar_successfulPurchase() public {
        vm.prank(platform);
        credits.createPackage("Starter", 100, 0.01 ether, 50e18, 5);

        vm.startPrank(user);
        loarToken.approve(address(credits), 50e18);
        credits.purchaseWithLoar(0);
        vm.stopPrank();

        // 100 base + 5 bonus + 10% LOAR bonus (10) = 115
        assertEq(credits.getBalance(user), 115);
    }

    function test_purchaseWithLoar_loarBonusCalculation() public {
        // Verify the 10% LOAR bonus math
        vm.prank(platform);
        credits.createPackage("BigPack", 1000, 1 ether, 500e18, 100);

        vm.startPrank(user);
        loarToken.approve(address(credits), 500e18);
        credits.purchaseWithLoar(0);
        vm.stopPrank();

        // loarBonus = 1000 / 10 = 100
        // total = 1000 + 100 (pkg bonus) + 100 (loar bonus) = 1200
        assertEq(credits.getBalance(user), 1200);
    }

    function test_purchaseWithLoar_loarBonusRoundsDown() public {
        // credits / 10 should round down for odd numbers
        vm.prank(platform);
        credits.createPackage("Odd", 7, 0.001 ether, 5e18, 0);

        vm.startPrank(user);
        loarToken.approve(address(credits), 5e18);
        credits.purchaseWithLoar(0);
        vm.stopPrank();

        // loarBonus = 7 / 10 = 0 (integer division rounds down)
        // total = 7 + 0 + 0 = 7
        assertEq(credits.getBalance(user), 7);
    }

    function test_purchaseWithLoar_emitsEvent() public {
        vm.prank(platform);
        credits.createPackage("Starter", 100, 0.01 ether, 50e18, 5);

        vm.startPrank(user);
        loarToken.approve(address(credits), 50e18);

        // bonus = 5 (package) + 10 (10% LOAR bonus) = 15
        vm.expectEmit(true, true, false, true, address(credits));
        emit CreditManager.CreditsPurchasedWithLoar(user, 0, 100, 15, 50e18);

        credits.purchaseWithLoar(0);
        vm.stopPrank();
    }

    function test_purchaseWithLoar_userStatsUpdated() public {
        vm.prank(platform);
        credits.createPackage("Starter", 100, 0.01 ether, 50e18, 5);

        vm.startPrank(user);
        loarToken.approve(address(credits), 50e18);
        credits.purchaseWithLoar(0);
        vm.stopPrank();

        (uint256 balance, uint256 purchased, uint256 spent, uint256 bonus) = credits.getUserStats(user);
        assertEq(balance, 115);
        assertEq(purchased, 100);
        assertEq(spent, 0);
        assertEq(bonus, 15); // 5 package + 10 LOAR bonus
    }

    function test_purchaseWithLoar_revert_insufficientBalance() public {
        vm.prank(platform);
        credits.createPackage("Big", 1000, 1 ether, 100_000e18, 0);

        vm.startPrank(user);
        loarToken.approve(address(credits), 100_000e18);
        vm.expectRevert(CreditManager.InsufficientLoarBalance.selector);
        credits.purchaseWithLoar(0);
        vm.stopPrank();
    }

    function test_purchaseWithLoar_revert_noAllowance() public {
        vm.prank(platform);
        credits.createPackage("Starter", 100, 0.01 ether, 50e18, 0);

        vm.prank(user);
        vm.expectRevert(CreditManager.InsufficientLoarAllowance.selector);
        credits.purchaseWithLoar(0);
    }

    function test_purchaseWithLoar_revert_insufficientAllowance() public {
        vm.prank(platform);
        credits.createPackage("Starter", 100, 0.01 ether, 50e18, 0);

        vm.startPrank(user);
        loarToken.approve(address(credits), 10e18); // only 10 approved, need 50
        vm.expectRevert(CreditManager.InsufficientLoarAllowance.selector);
        credits.purchaseWithLoar(0);
        vm.stopPrank();
    }

    function test_purchaseWithLoar_revert_inactivePackage() public {
        vm.startPrank(platform);
        credits.createPackage("Starter", 100, 0.01 ether, 50e18, 0);
        credits.deactivatePackage(0);
        vm.stopPrank();

        vm.startPrank(user);
        loarToken.approve(address(credits), 50e18);
        vm.expectRevert(CreditManager.PackageNotActive.selector);
        credits.purchaseWithLoar(0);
        vm.stopPrank();
    }

    function test_purchaseWithLoar_loarTransferredToTreasury() public {
        vm.prank(platform);
        credits.createPackage("Starter", 100, 0.01 ether, 50e18, 5);

        uint256 treasuryLoarBefore = loarToken.balanceOf(treasury);

        vm.startPrank(user);
        loarToken.approve(address(credits), 50e18);
        credits.purchaseWithLoar(0);
        vm.stopPrank();

        // LOAR should end up in treasury (via PaymentRouter)
        uint256 treasuryLoarAfter = loarToken.balanceOf(treasury);
        assertEq(treasuryLoarAfter - treasuryLoarBefore, 50e18);
    }

    // ── Purchase with LOAR (non-exempt user — transfer fee applies) ──

    function test_purchaseWithLoar_nonExemptUser() public {
        // Set up a liquidity pool to receive fees
        address lp = makeAddr("lp");
        vm.prank(deployer);
        loarToken.setLiquidityPool(lp);

        vm.prank(platform);
        credits.createPackage("Starter", 100, 0.01 ether, 50e18, 5);

        uint256 userBalBefore = loarToken.balanceOf(user);

        vm.startPrank(user);
        loarToken.approve(address(credits), 50e18);
        credits.purchaseWithLoar(0);
        vm.stopPrank();

        // User spent 50e18 (full amount debited)
        assertEq(userBalBefore - loarToken.balanceOf(user), 50e18);
        // Credits granted correctly
        assertEq(credits.getBalance(user), 115);
    }

    // ═══════════════════════════════════════════════════════════════
    // ── 6. Credit Balance Tracking — Multiple Purchases Accumulate ──
    // ═══════════════════════════════════════════════════════════════

    function test_multiplePurchases_accumulate() public {
        vm.startPrank(platform);
        credits.createPackage("Small", 50, 0.005 ether, 25e18, 5);
        credits.createPackage("Medium", 200, 0.02 ether, 100e18, 20);
        vm.stopPrank();

        // Buy Small (50 + 5 = 55)
        vm.prank(user);
        credits.purchaseWithEth{value: 0.005 ether}(0);
        assertEq(credits.getBalance(user), 55);

        // Buy Medium (200 + 20 = 220), total = 275
        vm.prank(user);
        credits.purchaseWithEth{value: 0.02 ether}(1);
        assertEq(credits.getBalance(user), 275);

        // Buy Small again with LOAR (50 + 5 + 5 LOAR bonus = 60), total = 335
        vm.startPrank(user);
        loarToken.approve(address(credits), 25e18);
        credits.purchaseWithLoar(0);
        vm.stopPrank();
        assertEq(credits.getBalance(user), 335);

        // Verify cumulative stats
        (uint256 balance, uint256 purchased, uint256 spent, uint256 bonus) = credits.getUserStats(user);
        assertEq(balance, 335);
        assertEq(purchased, 300); // 50 + 200 + 50
        assertEq(spent, 0);
        assertEq(bonus, 35); // 5 + 20 + (5 + 5 LOAR bonus)
    }

    function test_multipleUsers_independentBalances() public {
        vm.prank(platform);
        credits.createPackage("Starter", 100, 0.01 ether, 50e18, 10);

        vm.prank(user);
        credits.purchaseWithEth{value: 0.01 ether}(0);

        vm.prank(user2);
        credits.purchaseWithEth{value: 0.01 ether}(0);

        assertEq(credits.getBalance(user), 110);
        assertEq(credits.getBalance(user2), 110);

        // Spend from user1 only
        vm.prank(platform);
        credits.spendCredits(user, 50, "image", 1);

        assertEq(credits.getBalance(user), 60);
        assertEq(credits.getBalance(user2), 110);
    }

    // ═══════════════════════════════════════════════════════════════
    // ── 7. Spend Credits ──
    // ═══════════════════════════════════════════════════════════════

    function test_spendCredits_successfulSpend() public {
        vm.prank(platform);
        credits.createPackage("Starter", 100, 0.01 ether, 50e18, 0);

        vm.prank(user);
        credits.purchaseWithEth{value: 0.01 ether}(0);

        vm.prank(platform);
        credits.spendCredits(user, 10, "image", 1);

        assertEq(credits.getBalance(user), 90);
    }

    function test_spendCredits_spendEntireBalance() public {
        vm.prank(platform);
        credits.createPackage("Starter", 100, 0.01 ether, 50e18, 0);

        vm.prank(user);
        credits.purchaseWithEth{value: 0.01 ether}(0);

        vm.prank(platform);
        credits.spendCredits(user, 100, "video_premium", 1);

        assertEq(credits.getBalance(user), 0);
    }

    function test_spendCredits_emitsEvent() public {
        vm.prank(platform);
        credits.createPackage("Starter", 100, 0.01 ether, 50e18, 0);

        vm.prank(user);
        credits.purchaseWithEth{value: 0.01 ether}(0);

        vm.expectEmit(true, false, false, true, address(credits));
        emit CreditManager.CreditsSpent(user, 10, "image", 42);

        vm.prank(platform);
        credits.spendCredits(user, 10, "image", 42);
    }

    function test_spendCredits_tracksTotal() public {
        vm.prank(platform);
        credits.createPackage("Starter", 100, 0.01 ether, 50e18, 0);

        vm.prank(user);
        credits.purchaseWithEth{value: 0.01 ether}(0);

        vm.startPrank(platform);
        credits.spendCredits(user, 10, "image", 1);
        credits.spendCredits(user, 20, "video_draft", 1);
        credits.spendCredits(user, 5, "story", 2);
        vm.stopPrank();

        (uint256 balance, uint256 purchased, uint256 spent,) = credits.getUserStats(user);
        assertEq(balance, 65);
        assertEq(purchased, 100);
        assertEq(spent, 35);
    }

    function test_spendCredits_revert_insufficientCredits() public {
        vm.prank(platform);
        vm.expectRevert(CreditManager.InsufficientCredits.selector);
        credits.spendCredits(user, 10, "image", 1);
    }

    function test_spendCredits_revert_exceedsBalance() public {
        vm.prank(platform);
        credits.createPackage("Starter", 100, 0.01 ether, 50e18, 0);

        vm.prank(user);
        credits.purchaseWithEth{value: 0.01 ether}(0);

        vm.prank(platform);
        vm.expectRevert(CreditManager.InsufficientCredits.selector);
        credits.spendCredits(user, 101, "video_premium", 1);
    }

    function test_spendCredits_revert_notPlatform() public {
        vm.prank(stranger);
        vm.expectRevert(CreditManager.NotPlatform.selector);
        credits.spendCredits(user, 10, "image", 1);
    }

    // ═══════════════════════════════════════════════════════════════
    // ── 8. Grant Credits ──
    // ═══════════════════════════════════════════════════════════════

    function test_grantCredits_successfulGrant() public {
        vm.prank(platform);
        credits.grantCredits(user, 50, "quest reward");
        assertEq(credits.getBalance(user), 50);
    }

    function test_grantCredits_multipleGrants() public {
        vm.startPrank(platform);
        credits.grantCredits(user, 50, "quest reward");
        credits.grantCredits(user, 25, "affiliate bonus");
        credits.grantCredits(user, 100, "promotion");
        vm.stopPrank();

        assertEq(credits.getBalance(user), 175);
        (uint256 balance, uint256 purchased,,) = credits.getUserStats(user);
        assertEq(balance, 175);
        assertEq(purchased, 175); // grants count as purchased
    }

    function test_grantCredits_emitsEvent() public {
        vm.expectEmit(true, false, false, true, address(credits));
        emit CreditManager.CreditsGranted(user, 50, "quest reward");

        vm.prank(platform);
        credits.grantCredits(user, 50, "quest reward");
    }

    function test_grantCredits_revert_notPlatform() public {
        vm.prank(stranger);
        vm.expectRevert(CreditManager.NotPlatform.selector);
        credits.grantCredits(user, 50, "hack");
    }

    function test_grantCredits_zeroAmount() public {
        // Zero-amount grant should succeed (no revert)
        vm.prank(platform);
        credits.grantCredits(user, 0, "zero grant");
        assertEq(credits.getBalance(user), 0);
    }

    // ═══════════════════════════════════════════════════════════════
    // ── 9. Admin / Platform Functions ──
    // ═══════════════════════════════════════════════════════════════

    function test_setGenerationCost() public {
        vm.prank(platform);
        credits.setGenerationCost("custom_gen", 42);
        assertEq(credits.generationCosts(keccak256(abi.encodePacked("custom_gen"))), 42);
    }

    function test_setGenerationCost_emitsEvent() public {
        vm.expectEmit(false, false, false, true, address(credits));
        emit CreditManager.GenerationCostUpdated("custom_gen", 42);

        vm.prank(platform);
        credits.setGenerationCost("custom_gen", 42);
    }

    function test_setGenerationCost_overwrite() public {
        vm.startPrank(platform);
        credits.setGenerationCost("image", 10);
        vm.stopPrank();

        assertEq(credits.generationCosts(keccak256(abi.encodePacked("image"))), 10);
    }

    function test_setGenerationCost_revert_notPlatform() public {
        vm.prank(stranger);
        vm.expectRevert(CreditManager.NotPlatform.selector);
        credits.setGenerationCost("image", 10);
    }

    function test_setHolderDiscount() public {
        address token = makeAddr("token");
        vm.prank(platform);
        credits.setHolderDiscount(token, 500);
        assertEq(credits.holderDiscountBps(token), 500);
    }

    function test_setHolderDiscount_revert_notPlatform() public {
        vm.prank(stranger);
        vm.expectRevert(CreditManager.NotPlatform.selector);
        credits.setHolderDiscount(makeAddr("token"), 500);
    }

    function test_updateLoarToken() public {
        address newToken = makeAddr("newToken");
        vm.prank(platform);
        credits.updateLoarToken(newToken);
        assertEq(address(credits.loarToken()), newToken);
    }

    function test_updateLoarToken_revert_zeroAddress() public {
        vm.prank(platform);
        vm.expectRevert(CreditManager.ZeroAddress.selector);
        credits.updateLoarToken(address(0));
    }

    function test_updateLoarToken_revert_notPlatform() public {
        vm.prank(stranger);
        vm.expectRevert(CreditManager.NotPlatform.selector);
        credits.updateLoarToken(makeAddr("newToken"));
    }

    // ═══════════════════════════════════════════════════════════════
    // ── 10. Access Control — onlyPlatform ──
    // ═══════════════════════════════════════════════════════════════

    function test_onlyPlatform_allProtectedFunctions() public {
        // Every onlyPlatform function should revert when called by non-platform
        vm.startPrank(stranger);

        vm.expectRevert(CreditManager.NotPlatform.selector);
        credits.createPackage("x", 1, 1, 1, 0);

        vm.expectRevert(CreditManager.NotPlatform.selector);
        credits.deactivatePackage(0);

        vm.expectRevert(CreditManager.NotPlatform.selector);
        credits.spendCredits(user, 1, "image", 1);

        vm.expectRevert(CreditManager.NotPlatform.selector);
        credits.grantCredits(user, 1, "reason");

        vm.expectRevert(CreditManager.NotPlatform.selector);
        credits.setGenerationCost("image", 1);

        vm.expectRevert(CreditManager.NotPlatform.selector);
        credits.setHolderDiscount(makeAddr("t"), 100);

        vm.expectRevert(CreditManager.NotPlatform.selector);
        credits.updateLoarToken(makeAddr("t"));

        vm.stopPrank();
    }

    function test_onlyPlatform_ownerIsNotPlatform() public {
        // Owner (deployer) is NOT platform — verify owner cannot call platform-only functions
        vm.startPrank(deployer);

        vm.expectRevert(CreditManager.NotPlatform.selector);
        credits.createPackage("x", 1, 1, 1, 0);

        vm.expectRevert(CreditManager.NotPlatform.selector);
        credits.spendCredits(user, 1, "image", 1);

        vm.stopPrank();
    }

    // ═══════════════════════════════════════════════════════════════
    // ── 11. Upgrade Authorization ──
    // ═══════════════════════════════════════════════════════════════

    function test_upgrade_onlyOwner() public {
        CreditManagerV2 newImpl = new CreditManagerV2();

        vm.prank(deployer);
        credits.upgradeToAndCall(address(newImpl), "");

        // Verify upgrade worked by calling new function
        assertEq(CreditManagerV2(address(credits)).version(), "v2");
    }

    function test_upgrade_revert_notOwner() public {
        CreditManagerV2 newImpl = new CreditManagerV2();

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, stranger));
        credits.upgradeToAndCall(address(newImpl), "");
    }

    function test_upgrade_revert_platformCannotUpgrade() public {
        CreditManagerV2 newImpl = new CreditManagerV2();

        vm.prank(platform);
        vm.expectRevert(abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, platform));
        credits.upgradeToAndCall(address(newImpl), "");
    }

    function test_upgrade_preservesState() public {
        // Create package and purchase before upgrade
        vm.prank(platform);
        credits.createPackage("Starter", 100, 0.01 ether, 50e18, 10);

        vm.prank(user);
        credits.purchaseWithEth{value: 0.01 ether}(0);
        assertEq(credits.getBalance(user), 110);

        // Upgrade
        CreditManagerV2 newImpl = new CreditManagerV2();
        vm.prank(deployer);
        credits.upgradeToAndCall(address(newImpl), "");

        // State preserved
        assertEq(credits.getBalance(user), 110);
        assertEq(credits.platform(), platform);
        assertEq(credits.treasury(), treasury);
        assertEq(credits.nextPackageId(), 1);
        (,, uint256 creditAmount,,,,) = credits.packages(0);
        assertEq(creditAmount, 100);
    }

    // ═══════════════════════════════════════════════════════════════
    // ── 12. View Functions ──
    // ═══════════════════════════════════════════════════════════════

    function test_getBalance_defaultsToZero() public {
        assertEq(credits.getBalance(makeAddr("nobody")), 0);
    }

    function test_getGenerationCost() public view {
        assertEq(credits.getGenerationCost("image"), 3);
        assertEq(credits.getGenerationCost("video_premium"), 35);
    }

    function test_getGenerationCost_unknownType() public view {
        assertEq(credits.getGenerationCost("unknown_type"), 0);
    }

    function test_getUserStats_defaultsToZero() public {
        (uint256 balance, uint256 purchased, uint256 spent, uint256 bonus) =
            credits.getUserStats(makeAddr("nobody"));
        assertEq(balance, 0);
        assertEq(purchased, 0);
        assertEq(spent, 0);
        assertEq(bonus, 0);
    }

    function test_getUserStats_fullLifecycle() public {
        vm.prank(platform);
        credits.createPackage("Starter", 100, 0.01 ether, 50e18, 10);

        // Purchase
        vm.prank(user);
        credits.purchaseWithEth{value: 0.01 ether}(0);

        // Grant
        vm.prank(platform);
        credits.grantCredits(user, 25, "bonus");

        // Spend
        vm.prank(platform);
        credits.spendCredits(user, 30, "image", 1);

        (uint256 balance, uint256 purchased, uint256 spent, uint256 bonus) = credits.getUserStats(user);
        assertEq(balance, 105);     // 110 + 25 - 30
        assertEq(purchased, 125);   // 100 + 25
        assertEq(spent, 30);
        assertEq(bonus, 10);
    }

    // ═══════════════════════════════════════════════════════════════
    // ── 13. Edge Cases ──
    // ═══════════════════════════════════════════════════════════════

    function test_purchaseWithEth_largePackage() public {
        vm.prank(platform);
        credits.createPackage("Whale", type(uint128).max, 10 ether, 5000e18, type(uint128).max);

        vm.deal(user, 100 ether);
        vm.prank(user);
        credits.purchaseWithEth{value: 10 ether}(0);

        // credits + bonus = 2 * type(uint128).max
        uint256 expected = uint256(type(uint128).max) * 2;
        assertEq(credits.getBalance(user), expected);
    }

    function test_purchaseWithLoar_fallbackDirectTreasuryTransfer() public {
        // Deploy CreditManager with paymentRouter = address(0)
        // In this case, LOAR goes directly to treasury
        vm.startPrank(deployer);
        CreditManager impl = new CreditManager();
        CreditManager noRouterCredits = CreditManager(address(new ERC1967Proxy(
            address(impl),
            abi.encodeCall(CreditManager.initialize, (
                address(loarToken), platform, treasury, address(0)
            ))
        )));
        // Make it fee-exempt too
        loarToken.setFeeExempt(address(noRouterCredits), true);
        vm.stopPrank();

        vm.prank(platform);
        noRouterCredits.createPackage("Starter", 100, 0.01 ether, 50e18, 5);

        uint256 treasuryLoarBefore = loarToken.balanceOf(treasury);

        vm.startPrank(user);
        loarToken.approve(address(noRouterCredits), 50e18);
        noRouterCredits.purchaseWithLoar(0);
        vm.stopPrank();

        // Credits granted
        assertEq(noRouterCredits.getBalance(user), 115);
        // LOAR went directly to treasury (no router)
        assertEq(loarToken.balanceOf(treasury) - treasuryLoarBefore, 50e18);
    }

    function test_spendCredits_zeroAmount() public {
        // Spending 0 credits should succeed (balance >= 0 always true)
        vm.prank(platform);
        credits.spendCredits(user, 0, "image", 1);
        assertEq(credits.getBalance(user), 0);
    }

    function test_multiplePackages_buyFromDifferentPackages() public {
        vm.startPrank(platform);
        credits.createPackage("Basic", 10, 0.001 ether, 5e18, 0);
        credits.createPackage("Pro", 100, 0.01 ether, 50e18, 10);
        credits.createPackage("Enterprise", 1000, 0.1 ether, 500e18, 200);
        vm.stopPrank();

        vm.startPrank(user);
        credits.purchaseWithEth{value: 0.001 ether}(0);
        credits.purchaseWithEth{value: 0.01 ether}(1);
        credits.purchaseWithEth{value: 0.1 ether}(2);
        vm.stopPrank();

        // 10 + 0 + 100 + 10 + 1000 + 200 = 1320
        assertEq(credits.getBalance(user), 1320);
    }

    // ═══════════════════════════════════════════════════════════════
    // ── 14. Constructor and Proxy Safety ──
    // ═══════════════════════════════════════════════════════════════

    function test_implementation_cannotBeInitialized() public {
        CreditManager impl = new CreditManager();
        vm.expectRevert();
        impl.initialize(address(loarToken), platform, treasury, address(router));
    }
}
