// SPDX-License-Identifier: MIT
pragma solidity =0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/proxy/ERC1967/ERC1967Proxy.sol";
import {PaymentRouter} from "../src/PaymentRouter.sol";
import {MockLoarToken} from "./mocks/MockLoarToken.sol";

// ── Malicious reentrancy attacker ──────────────────────────────────────
contract ReentrancyClaimer {
    PaymentRouter public router;
    uint256 public attempts;

    constructor(PaymentRouter _router) { router = _router; }

    function attack() external {
        router.claim();
    }

    receive() external payable {
        if (attempts < 2) {
            attempts++;
            router.claim();
        }
    }
}

contract PaymentRouterTest is Test {
    PaymentRouter public router;
    MockLoarToken public loar;

    address deployer = makeAddr("deployer");
    address treasury = makeAddr("treasury");
    address creator  = makeAddr("creator");
    address creator2 = makeAddr("creator2");
    address user     = makeAddr("user");

    function setUp() public {
        vm.startPrank(deployer);

        loar = new MockLoarToken();

        PaymentRouter impl = new PaymentRouter();
        router = PaymentRouter(address(new ERC1967Proxy(
            address(impl),
            abi.encodeCall(PaymentRouter.initialize, (treasury, 1000, address(loar), 500))
        )));
        vm.stopPrank();

        vm.deal(user, 100 ether);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  Initialize
    // ═══════════════════════════════════════════════════════════════════

    function test_initialize() public view {
        assertEq(router.treasury(), treasury);
        assertEq(router.defaultPlatformFeeBps(), 1000);
        assertEq(router.owner(), deployer);
        assertEq(address(router.loarToken()), address(loar));
        assertEq(router.loarFeeDiscountBps(), 500);
    }

    function test_initialize_revert_zeroTreasury() public {
        PaymentRouter impl = new PaymentRouter();
        vm.expectRevert(PaymentRouter.ZeroAddress.selector);
        new ERC1967Proxy(
            address(impl),
            abi.encodeCall(PaymentRouter.initialize, (address(0), 1000, address(0), 0))
        );
    }

    function test_initialize_revert_feeTooHigh() public {
        PaymentRouter impl = new PaymentRouter();
        vm.expectRevert(PaymentRouter.FeeTooHigh.selector);
        new ERC1967Proxy(
            address(impl),
            abi.encodeCall(PaymentRouter.initialize, (treasury, 5001, address(0), 0))
        );
    }

    function test_initialize_boundary_5000() public {
        PaymentRouter impl = new PaymentRouter();
        // 5000 should succeed (cap is inclusive)
        PaymentRouter r = PaymentRouter(address(new ERC1967Proxy(
            address(impl),
            abi.encodeCall(PaymentRouter.initialize, (treasury, 5000, address(0), 0))
        )));
        assertEq(r.defaultPlatformFeeBps(), 5000);
    }

    function test_cannotReinitialize() public {
        vm.expectRevert();
        router.initialize(treasury, 1000, address(0), 0);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  Route (ETH)
    // ═══════════════════════════════════════════════════════════════════

    function test_route_splits_correctly() public {
        vm.prank(user);
        router.route{value: 1 ether}(creator, 1000); // 10% fee

        assertEq(router.claimable(creator), 0.9 ether);
        assertEq(treasury.balance, 0.1 ether);
    }

    function test_route_emitsEvent() public {
        vm.expectEmit(true, false, false, true);
        emit PaymentRouter.PaymentRouted(creator, 0.9 ether, 0.1 ether, 1000);

        vm.prank(user);
        router.route{value: 1 ether}(creator, 1000);
    }

    function test_route_zeroValue_noop() public {
        vm.prank(user);
        router.route{value: 0}(creator, 1000);
        assertEq(router.claimable(creator), 0);
    }

    function test_route_useDefaultFee() public {
        vm.prank(user);
        router.route{value: 1 ether}(creator, type(uint16).max); // USE_DEFAULT_FEE
        assertEq(router.claimable(creator), 0.9 ether);
        assertEq(treasury.balance, 0.1 ether);
    }

    function test_route_zeroFee() public {
        vm.prank(user);
        router.route{value: 1 ether}(creator, 0);
        assertEq(router.claimable(creator), 1 ether);
        assertEq(treasury.balance, 0);
    }

    function test_route_revert_feeTooHigh() public {
        vm.prank(user);
        vm.expectRevert(PaymentRouter.FeeTooHigh.selector);
        router.route{value: 1 ether}(creator, 5001);
    }

    function test_route_maxFee() public {
        vm.prank(user);
        router.route{value: 1 ether}(creator, 5000); // 50% fee
        assertEq(router.claimable(creator), 0.5 ether);
        assertEq(treasury.balance, 0.5 ether);
    }

    function test_route_zeroCreatorAddress_reverts() public {
        // address(0) as creator now correctly reverts to prevent
        // funds accruing at an unclaimable address
        vm.prank(user);
        vm.expectRevert(PaymentRouter.ZeroAddress.selector);
        router.route{value: 1 ether}(address(0), 1000);
    }

    function test_route_multipleCreators() public {
        vm.startPrank(user);
        router.route{value: 1 ether}(creator, 0);
        router.route{value: 2 ether}(creator2, 0);
        vm.stopPrank();

        assertEq(router.claimable(creator), 1 ether);
        assertEq(router.claimable(creator2), 2 ether);
    }

    function test_route_accumulatesClaimable() public {
        vm.startPrank(user);
        router.route{value: 1 ether}(creator, 0);
        router.route{value: 2 ether}(creator, 0);
        router.route{value: 0.5 ether}(creator, 0);
        vm.stopPrank();

        assertEq(router.claimable(creator), 3.5 ether);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  RouteToTreasury
    // ═══════════════════════════════════════════════════════════════════

    function test_routeToTreasury() public {
        vm.prank(user);
        router.routeToTreasury{value: 2 ether}();
        assertEq(treasury.balance, 2 ether);
    }

    function test_routeToTreasury_zeroValue_noop() public {
        vm.prank(user);
        router.routeToTreasury{value: 0}();
        assertEq(treasury.balance, 0);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  Claim (ETH)
    // ═══════════════════════════════════════════════════════════════════

    function test_claim() public {
        vm.prank(user);
        router.route{value: 1 ether}(creator, 0);

        uint256 balBefore = creator.balance;
        vm.prank(creator);
        router.claim();
        assertEq(creator.balance - balBefore, 1 ether);
        assertEq(router.claimable(creator), 0);
    }

    function test_claim_emitsEvent() public {
        vm.prank(user);
        router.route{value: 1 ether}(creator, 0);

        vm.expectEmit(true, false, false, true);
        emit PaymentRouter.Claimed(creator, 1 ether);

        vm.prank(creator);
        router.claim();
    }

    function test_claim_revert_nothingToClaim() public {
        vm.prank(creator);
        vm.expectRevert(PaymentRouter.NothingToClaim.selector);
        router.claim();
    }

    function test_claim_multiple_routes() public {
        vm.startPrank(user);
        router.route{value: 1 ether}(creator, 0);
        router.route{value: 2 ether}(creator, 0);
        vm.stopPrank();

        assertEq(router.claimable(creator), 3 ether);
        vm.prank(creator);
        router.claim();
        assertEq(router.claimable(creator), 0);
    }

    function test_claim_resetsBalance_cannotDoubleClaim() public {
        vm.prank(user);
        router.route{value: 1 ether}(creator, 0);

        vm.startPrank(creator);
        router.claim();
        vm.expectRevert(PaymentRouter.NothingToClaim.selector);
        router.claim();
        vm.stopPrank();
    }

    function test_claim_reentrancy_reverts() public {
        // Deploy attacker contract
        ReentrancyClaimer attacker = new ReentrancyClaimer(router);

        // Accrue funds for the attacker
        vm.prank(user);
        router.route{value: 2 ether}(address(attacker), 0);

        // Attacker tries to re-enter claim() via receive()
        vm.expectRevert();
        attacker.attack();
    }

    // ═══════════════════════════════════════════════════════════════════
    //  $LOAR Routing
    // ═══════════════════════════════════════════════════════════════════

    function test_routeLoar_basicSplit() public {
        // Mint tokens to user and approve
        loar.mint(user, 1000e18);
        vm.startPrank(user);
        loar.approve(address(router), type(uint256).max);

        // Default fee 1000 bps (10%), discount 500 bps (5%) → effective 500 bps (5%)
        router.routeLoar(creator, type(uint16).max, 100e18);
        vm.stopPrank();

        uint256 platformCut = (100e18 * 500) / 10_000; // 5e18
        uint256 creatorCut = 100e18 - platformCut;      // 95e18

        assertEq(router.claimableLoar(creator), creatorCut);
        assertEq(loar.balanceOf(treasury), platformCut);
    }

    function test_routeLoar_emitsEvent() public {
        loar.mint(user, 100e18);
        vm.startPrank(user);
        loar.approve(address(router), type(uint256).max);

        // effective bps = 1000 - 500 = 500
        vm.expectEmit(true, false, false, true);
        emit PaymentRouter.LoarPaymentRouted(creator, 95e18, 5e18, 500);

        router.routeLoar(creator, type(uint16).max, 100e18);
        vm.stopPrank();
    }

    function test_routeLoar_discountExceedsFee_zeroFee() public {
        // Set discount higher than fee → effective fee becomes 0
        vm.prank(deployer);
        router.setLoarFeeDiscount(2000); // 20% discount > 10% fee

        loar.mint(user, 100e18);
        vm.startPrank(user);
        loar.approve(address(router), type(uint256).max);
        router.routeLoar(creator, type(uint16).max, 100e18);
        vm.stopPrank();

        assertEq(router.claimableLoar(creator), 100e18);
        assertEq(loar.balanceOf(treasury), 0);
    }

    function test_routeLoar_zeroAmount_noop() public {
        vm.prank(user);
        router.routeLoar(creator, type(uint16).max, 0);
        assertEq(router.claimableLoar(creator), 0);
    }

    function test_routeLoar_revert_noToken() public {
        // Deploy router without LOAR token
        vm.startPrank(deployer);
        PaymentRouter impl = new PaymentRouter();
        PaymentRouter noLoarRouter = PaymentRouter(address(new ERC1967Proxy(
            address(impl),
            abi.encodeCall(PaymentRouter.initialize, (treasury, 1000, address(0), 0))
        )));
        vm.stopPrank();

        vm.prank(user);
        vm.expectRevert(PaymentRouter.ZeroAddress.selector);
        noLoarRouter.routeLoar(creator, type(uint16).max, 100e18);
    }

    function test_routeLoar_explicitFee_noDiscount() public {
        // Explicit fee of 2000 bps, discount still applies
        loar.mint(user, 100e18);
        vm.startPrank(user);
        loar.approve(address(router), type(uint256).max);
        router.routeLoar(creator, 2000, 100e18);
        vm.stopPrank();

        // effective bps = 2000 - 500 = 1500
        uint256 platformCut = (100e18 * 1500) / 10_000;
        assertEq(router.claimableLoar(creator), 100e18 - platformCut);
        assertEq(loar.balanceOf(treasury), platformCut);
    }

    // ── claimLoar ──

    function test_claimLoar() public {
        loar.mint(user, 100e18);
        vm.startPrank(user);
        loar.approve(address(router), type(uint256).max);
        router.routeLoar(creator, 0, 100e18); // 0 fee, discount irrelevant
        vm.stopPrank();

        // discount makes 0 stay 0
        assertEq(router.claimableLoar(creator), 100e18);

        vm.prank(creator);
        router.claimLoar();
        assertEq(loar.balanceOf(creator), 100e18);
        assertEq(router.claimableLoar(creator), 0);
    }

    function test_claimLoar_emitsEvent() public {
        loar.mint(user, 100e18);
        vm.startPrank(user);
        loar.approve(address(router), type(uint256).max);
        router.routeLoar(creator, 0, 100e18);
        vm.stopPrank();

        vm.expectEmit(true, false, false, true);
        emit PaymentRouter.LoarClaimed(creator, 100e18);

        vm.prank(creator);
        router.claimLoar();
    }

    function test_claimLoar_revert_nothingToClaim() public {
        vm.prank(creator);
        vm.expectRevert(PaymentRouter.NothingToClaim.selector);
        router.claimLoar();
    }

    // ── routeLoarToTreasury ──

    function test_routeLoarToTreasury() public {
        loar.mint(user, 50e18);
        vm.startPrank(user);
        loar.approve(address(router), type(uint256).max);
        router.routeLoarToTreasury(50e18);
        vm.stopPrank();

        assertEq(loar.balanceOf(treasury), 50e18);
    }

    function test_routeLoarToTreasury_zeroAmount_noop() public {
        vm.prank(user);
        router.routeLoarToTreasury(0);
        assertEq(loar.balanceOf(treasury), 0);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  Admin: setTreasury
    // ═══════════════════════════════════════════════════════════════════

    function test_setTreasury() public {
        address newTreasury = makeAddr("newTreasury");
        vm.prank(deployer);
        router.setTreasury(newTreasury);
        assertEq(router.treasury(), newTreasury);
    }

    function test_setTreasury_emitsEvent() public {
        address newTreasury = makeAddr("newTreasury");
        vm.expectEmit(true, true, false, false);
        emit PaymentRouter.TreasuryUpdated(treasury, newTreasury);

        vm.prank(deployer);
        router.setTreasury(newTreasury);
    }

    function test_setTreasury_revert_notOwner() public {
        vm.prank(user);
        vm.expectRevert();
        router.setTreasury(makeAddr("x"));
    }

    function test_setTreasury_revert_zero() public {
        vm.prank(deployer);
        vm.expectRevert(PaymentRouter.ZeroAddress.selector);
        router.setTreasury(address(0));
    }

    // ═══════════════════════════════════════════════════════════════════
    //  Admin: setDefaultFee
    // ═══════════════════════════════════════════════════════════════════

    function test_setDefaultFee() public {
        vm.prank(deployer);
        router.setDefaultFee(2000);
        assertEq(router.defaultPlatformFeeBps(), 2000);
    }

    function test_setDefaultFee_emitsEvent() public {
        vm.expectEmit(true, false, false, false);
        emit PaymentRouter.DefaultFeeUpdated(2000);

        vm.prank(deployer);
        router.setDefaultFee(2000);
    }

    function test_setDefaultFee_revert_tooHigh() public {
        vm.prank(deployer);
        vm.expectRevert(PaymentRouter.FeeTooHigh.selector);
        router.setDefaultFee(5001);
    }

    function test_setDefaultFee_boundary_5000() public {
        vm.prank(deployer);
        router.setDefaultFee(5000);
        assertEq(router.defaultPlatformFeeBps(), 5000);
    }

    function test_setDefaultFee_zero() public {
        vm.prank(deployer);
        router.setDefaultFee(0);
        assertEq(router.defaultPlatformFeeBps(), 0);
    }

    function test_setDefaultFee_revert_notOwner() public {
        vm.prank(user);
        vm.expectRevert();
        router.setDefaultFee(500);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  Admin: setLoarToken
    // ═══════════════════════════════════════════════════════════════════

    function test_setLoarToken() public {
        address newToken = makeAddr("newToken");
        vm.prank(deployer);
        router.setLoarToken(newToken);
        assertEq(address(router.loarToken()), newToken);
    }

    function test_setLoarToken_emitsEvent() public {
        address newToken = makeAddr("newToken");
        vm.expectEmit(true, false, false, false);
        emit PaymentRouter.LoarTokenUpdated(newToken);

        vm.prank(deployer);
        router.setLoarToken(newToken);
    }

    function test_setLoarToken_revert_zero() public {
        vm.prank(deployer);
        vm.expectRevert(PaymentRouter.ZeroAddress.selector);
        router.setLoarToken(address(0));
    }

    function test_setLoarToken_revert_notOwner() public {
        vm.prank(user);
        vm.expectRevert();
        router.setLoarToken(makeAddr("x"));
    }

    // ═══════════════════════════════════════════════════════════════════
    //  Admin: setLoarFeeDiscount
    // ═══════════════════════════════════════════════════════════════════

    function test_setLoarFeeDiscount() public {
        vm.prank(deployer);
        router.setLoarFeeDiscount(1000);
        assertEq(router.loarFeeDiscountBps(), 1000);
    }

    function test_setLoarFeeDiscount_emitsEvent() public {
        vm.expectEmit(true, false, false, false);
        emit PaymentRouter.LoarFeeDiscountUpdated(1500);

        vm.prank(deployer);
        router.setLoarFeeDiscount(1500);
    }

    function test_setLoarFeeDiscount_revert_tooHigh() public {
        vm.prank(deployer);
        vm.expectRevert(PaymentRouter.DiscountTooHigh.selector);
        router.setLoarFeeDiscount(2001);
    }

    function test_setLoarFeeDiscount_boundary_2000() public {
        vm.prank(deployer);
        router.setLoarFeeDiscount(2000);
        assertEq(router.loarFeeDiscountBps(), 2000);
    }

    function test_setLoarFeeDiscount_zero() public {
        vm.prank(deployer);
        router.setLoarFeeDiscount(0);
        assertEq(router.loarFeeDiscountBps(), 0);
    }

    function test_setLoarFeeDiscount_revert_notOwner() public {
        vm.prank(user);
        vm.expectRevert();
        router.setLoarFeeDiscount(500);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  Pause
    // ═══════════════════════════════════════════════════════════════════

    function test_pause_blocks_route() public {
        vm.prank(deployer);
        router.pause();

        vm.prank(user);
        vm.expectRevert();
        router.route{value: 1 ether}(creator, 1000);
    }

    function test_pause_blocks_routeToTreasury() public {
        vm.prank(deployer);
        router.pause();

        vm.prank(user);
        vm.expectRevert();
        router.routeToTreasury{value: 1 ether}();
    }

    function test_pause_blocks_routeLoar() public {
        vm.prank(deployer);
        router.pause();

        vm.prank(user);
        vm.expectRevert();
        router.routeLoar(creator, 1000, 100e18);
    }

    function test_pause_doesNotBlockClaim() public {
        // Accrue first
        vm.prank(user);
        router.route{value: 1 ether}(creator, 0);

        vm.prank(deployer);
        router.pause();

        // Claim should still work (not whenNotPaused)
        vm.prank(creator);
        router.claim();
        assertEq(router.claimable(creator), 0);
    }

    function test_unpause_restores_route() public {
        vm.startPrank(deployer);
        router.pause();
        router.unpause();
        vm.stopPrank();

        vm.prank(user);
        router.route{value: 1 ether}(creator, 1000);
        assertEq(router.claimable(creator), 0.9 ether);
    }

    function test_pause_revert_notOwner() public {
        vm.prank(user);
        vm.expectRevert();
        router.pause();
    }

    function test_unpause_revert_notOwner() public {
        vm.prank(deployer);
        router.pause();

        vm.prank(user);
        vm.expectRevert();
        router.unpause();
    }

    // ═══════════════════════════════════════════════════════════════════
    //  Upgrade authorization
    // ═══════════════════════════════════════════════════════════════════

    function test_upgrade_revert_notOwner() public {
        PaymentRouter newImpl = new PaymentRouter();
        vm.prank(user);
        vm.expectRevert();
        router.upgradeToAndCall(address(newImpl), "");
    }

    function test_upgrade_succeeds_asOwner() public {
        PaymentRouter newImpl = new PaymentRouter();
        vm.prank(deployer);
        router.upgradeToAndCall(address(newImpl), "");
        // State preserved after upgrade
        assertEq(router.treasury(), treasury);
        assertEq(router.defaultPlatformFeeBps(), 1000);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  Fuzz
    // ═══════════════════════════════════════════════════════════════════

    function testFuzz_route_feeSplit(uint96 amount, uint16 feeBps) public {
        vm.assume(amount > 0 && amount <= 10 ether);
        feeBps = uint16(bound(feeBps, 0, 5000));

        vm.deal(user, uint256(amount));
        vm.prank(user);
        router.route{value: amount}(creator, feeBps);

        uint256 expectedPlatform = (uint256(amount) * feeBps) / 10_000;
        uint256 expectedCreator = uint256(amount) - expectedPlatform;

        assertEq(router.claimable(creator), expectedCreator);
        assertEq(treasury.balance, expectedPlatform);
    }

    function testFuzz_routeLoar_feeSplit(uint96 amount, uint16 feeBps) public {
        vm.assume(amount > 0 && amount <= 1_000_000e18);
        feeBps = uint16(bound(feeBps, 0, 5000));

        loar.mint(user, uint256(amount));
        vm.startPrank(user);
        loar.approve(address(router), type(uint256).max);
        router.routeLoar(creator, feeBps, uint256(amount));
        vm.stopPrank();

        // Calculate expected with discount applied
        uint16 effectiveBps = feeBps;
        uint16 discount = router.loarFeeDiscountBps();
        if (discount > 0 && effectiveBps > discount) {
            effectiveBps -= discount;
        } else if (discount >= effectiveBps) {
            effectiveBps = 0;
        }

        uint256 expectedPlatform = (uint256(amount) * effectiveBps) / 10_000;
        uint256 expectedCreator = uint256(amount) - expectedPlatform;

        assertEq(router.claimableLoar(creator), expectedCreator);
        assertEq(loar.balanceOf(treasury), expectedPlatform);
    }
}
