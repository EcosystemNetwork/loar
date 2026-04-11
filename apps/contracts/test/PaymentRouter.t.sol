// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/proxy/ERC1967/ERC1967Proxy.sol";
import {PaymentRouter} from "../src/PaymentRouter.sol";

contract PaymentRouterTest is Test {
    PaymentRouter public router;
    address deployer = makeAddr("deployer");
    address treasury = makeAddr("treasury");
    address creator = makeAddr("creator");
    address user = makeAddr("user");

    function setUp() public {
        vm.startPrank(deployer);
        PaymentRouter impl = new PaymentRouter();
        router = PaymentRouter(address(new ERC1967Proxy(
            address(impl),
            abi.encodeCall(PaymentRouter.initialize, (treasury, 1000, address(0), 0))
        )));
        vm.stopPrank();
        vm.deal(user, 100 ether);
    }

    // ── Initialize ──

    function test_initialize() public view {
        assertEq(router.treasury(), treasury);
        assertEq(router.defaultPlatformFeeBps(), 1000);
        assertEq(router.owner(), deployer);
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

    // ── Route ──

    function test_route_splits_correctly() public {
        vm.prank(user);
        router.route{value: 1 ether}(creator, 1000); // 10% fee

        assertEq(router.claimable(creator), 0.9 ether);
        assertEq(treasury.balance, 0.1 ether);
    }

    function test_route_zeroValue_noop() public {
        vm.prank(user);
        router.route{value: 0}(creator, 1000);
        assertEq(router.claimable(creator), 0);
    }

    function test_route_useDefaultFee() public {
        vm.prank(user);
        router.route{value: 1 ether}(creator, type(uint16).max); // USE_DEFAULT_FEE
        // default is 1000 bps = 10%
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

    // ── RouteToTreasury ──

    function test_routeToTreasury() public {
        vm.prank(user);
        router.routeToTreasury{value: 2 ether}();
        assertEq(treasury.balance, 2 ether);
    }

    // ── Claim ──

    function test_claim() public {
        vm.prank(user);
        router.route{value: 1 ether}(creator, 0);

        uint256 balBefore = creator.balance;
        vm.prank(creator);
        router.claim();
        assertEq(creator.balance - balBefore, 1 ether);
        assertEq(router.claimable(creator), 0);
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

    // ── Admin ──

    function test_setTreasury() public {
        address newTreasury = makeAddr("newTreasury");
        vm.prank(deployer);
        router.setTreasury(newTreasury);
        assertEq(router.treasury(), newTreasury);
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

    function test_setDefaultFee() public {
        vm.prank(deployer);
        router.setDefaultFee(2000);
        assertEq(router.defaultPlatformFeeBps(), 2000);
    }

    function test_setDefaultFee_revert_tooHigh() public {
        vm.prank(deployer);
        vm.expectRevert(PaymentRouter.FeeTooHigh.selector);
        router.setDefaultFee(5001);
    }

    // ── Pause ──

    function test_pause_blocks_route() public {
        vm.prank(deployer);
        router.pause();

        vm.prank(user);
        vm.expectRevert();
        router.route{value: 1 ether}(creator, 1000);
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

    // ── Fuzz ──

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
}
