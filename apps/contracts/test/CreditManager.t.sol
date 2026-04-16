// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/proxy/ERC1967/ERC1967Proxy.sol";
import {ERC20} from "@openzeppelin/token/ERC20/ERC20.sol";
import {PaymentRouter} from "../src/PaymentRouter.sol";
import {CreditManager} from "../src/revenue/CreditManager.sol";

contract MockERC20 is ERC20 {
    constructor() ERC20("Mock LOAR", "MLOAR") {
        _mint(msg.sender, 1_000_000e18);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract CreditManagerTest is Test {
    CreditManager public credits;
    PaymentRouter public router;
    MockERC20 public loarToken;

    address deployer = makeAddr("deployer");
    address platform = makeAddr("platform");
    address treasury = makeAddr("treasury");
    address user = makeAddr("user");
    address stranger = makeAddr("stranger");

    function setUp() public {
        vm.startPrank(deployer);

        // Deploy PaymentRouter
        PaymentRouter routerImpl = new PaymentRouter();
        router = PaymentRouter(address(new ERC1967Proxy(
            address(routerImpl),
            abi.encodeCall(PaymentRouter.initialize, (treasury, 1000, address(0), 0))
        )));

        // Deploy mock LOAR token
        loarToken = new MockERC20();

        // Deploy CreditManager
        CreditManager creditsImpl = new CreditManager();
        credits = CreditManager(address(new ERC1967Proxy(
            address(creditsImpl),
            abi.encodeCall(CreditManager.initialize, (
                address(loarToken), platform, treasury, address(router)
            ))
        )));

        // Set loar token on PaymentRouter so routeLoarToTreasury works
        router.setLoarToken(address(loarToken));

        vm.stopPrank();

        // Setup: give user some ETH and LOAR
        vm.deal(user, 100 ether);
        vm.prank(deployer);
        loarToken.mint(user, 10_000e18);
    }

    // ── Initialize ──

    function test_initialize() public view {
        assertEq(credits.platform(), platform);
        assertEq(credits.treasury(), treasury);
        assertEq(credits.owner(), deployer);
    }

    function test_initialize_revert_zeroPlatform() public {
        CreditManager impl = new CreditManager();
        vm.expectRevert(CreditManager.ZeroAddress.selector);
        new ERC1967Proxy(
            address(impl),
            abi.encodeCall(CreditManager.initialize, (address(loarToken), address(0), treasury, address(router)))
        );
    }

    function test_defaultGenerationCosts() public view {
        assertEq(credits.generationCosts(keccak256("image")), 3);
        assertEq(credits.generationCosts(keccak256("video_draft")), 5);
        assertEq(credits.generationCosts(keccak256("video_premium")), 35);
    }

    // ── Package management ──

    function test_createPackage() public {
        vm.prank(platform);
        uint256 id = credits.createPackage("Starter", 100, 0.01 ether, 50e18, 10);
        assertEq(id, 0);

        (,string memory name, uint256 creditAmount, uint256 priceWei,,, bool active) = credits.packages(0);
        assertEq(name, "Starter");
        assertEq(creditAmount, 100);
        assertEq(priceWei, 0.01 ether);
        assertTrue(active);
    }

    function test_createPackage_revert_notPlatform() public {
        vm.prank(stranger);
        vm.expectRevert(CreditManager.NotPlatform.selector);
        credits.createPackage("x", 100, 0.01 ether, 50e18, 0);
    }

    function test_deactivatePackage() public {
        vm.startPrank(platform);
        credits.createPackage("Starter", 100, 0.01 ether, 50e18, 10);
        credits.deactivatePackage(0);
        vm.stopPrank();

        (,,,,,, bool active) = credits.packages(0);
        assertFalse(active);
    }

    // ── Purchase with ETH ──

    function test_purchaseWithEth() public {
        vm.prank(platform);
        credits.createPackage("Starter", 100, 0.01 ether, 50e18, 10);

        vm.prank(user);
        credits.purchaseWithEth{value: 0.01 ether}(0);

        assertEq(credits.getBalance(user), 110); // 100 base + 10 bonus
    }

    function test_purchaseWithEth_revert_insufficientPayment() public {
        vm.prank(platform);
        credits.createPackage("Starter", 100, 0.01 ether, 50e18, 10);

        vm.prank(user);
        vm.expectRevert(CreditManager.InsufficientPayment.selector);
        credits.purchaseWithEth{value: 0.005 ether}(0);
    }

    function test_purchaseWithEth_revert_inactive() public {
        vm.startPrank(platform);
        credits.createPackage("Starter", 100, 0.01 ether, 50e18, 10);
        credits.deactivatePackage(0);
        vm.stopPrank();

        vm.prank(user);
        vm.expectRevert(CreditManager.PackageNotActive.selector);
        credits.purchaseWithEth{value: 0.01 ether}(0);
    }

    // ── Purchase with LOAR ──

    function test_purchaseWithLoar() public {
        vm.prank(platform);
        credits.createPackage("Starter", 100, 0.01 ether, 50e18, 5);

        vm.startPrank(user);
        loarToken.approve(address(credits), 50e18);
        credits.purchaseWithLoar(0);
        vm.stopPrank();

        // 100 base + 5 bonus + 10% LOAR bonus (10) = 115
        assertEq(credits.getBalance(user), 115);
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

    // ── Spend credits ──

    function test_spendCredits() public {
        vm.prank(platform);
        credits.createPackage("Starter", 100, 0.01 ether, 50e18, 0);

        vm.prank(user);
        credits.purchaseWithEth{value: 0.01 ether}(0);

        vm.prank(platform);
        credits.spendCredits(user, 10, "image", 1);

        assertEq(credits.getBalance(user), 90);
    }

    function test_spendCredits_revert_insufficient() public {
        vm.prank(platform);
        vm.expectRevert(CreditManager.InsufficientCredits.selector);
        credits.spendCredits(user, 10, "image", 1);
    }

    function test_spendCredits_revert_notPlatform() public {
        vm.prank(stranger);
        vm.expectRevert(CreditManager.NotPlatform.selector);
        credits.spendCredits(user, 10, "image", 1);
    }

    // ── Grant credits ──

    function test_grantCredits() public {
        vm.prank(platform);
        credits.grantCredits(user, 50, "quest reward");
        assertEq(credits.getBalance(user), 50);
    }

    function test_grantCredits_revert_notPlatform() public {
        vm.prank(stranger);
        vm.expectRevert(CreditManager.NotPlatform.selector);
        credits.grantCredits(user, 50, "hack");
    }

    // ── User stats ──

    function test_getUserStats() public {
        vm.prank(platform);
        credits.createPackage("Starter", 100, 0.01 ether, 50e18, 10);

        vm.prank(user);
        credits.purchaseWithEth{value: 0.01 ether}(0);

        vm.prank(platform);
        credits.spendCredits(user, 20, "image", 1);

        (uint256 balance, uint256 purchased, uint256 spent, uint256 bonus) = credits.getUserStats(user);
        assertEq(balance, 90);      // 110 - 20
        assertEq(purchased, 100);
        assertEq(spent, 20);
        assertEq(bonus, 10);
    }

    // ── Admin ──

    function test_setGenerationCost() public {
        vm.prank(platform);
        credits.setGenerationCost("custom_gen", 42);
        assertEq(credits.generationCosts(keccak256(abi.encodePacked("custom_gen"))), 42);
    }
}
