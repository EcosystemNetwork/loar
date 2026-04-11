// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/proxy/ERC1967/ERC1967Proxy.sol";
import {UpgradeableBeacon} from "@openzeppelin/proxy/beacon/UpgradeableBeacon.sol";
import {BeaconProxy} from "@openzeppelin/proxy/beacon/BeaconProxy.sol";
import {PaymentRouter} from "../src/PaymentRouter.sol";
import {RightsRegistry} from "../src/RightsRegistry.sol";
import {IRightsRegistry} from "../src/interfaces/IRightsRegistry.sol";
import {EpisodeEditionCollection} from "../src/revenue/EpisodeEditionCollection.sol";

contract EpisodeEditionTest is Test {
    EpisodeEditionCollection public collection;
    PaymentRouter public router;
    RightsRegistry public registry;

    address deployer = makeAddr("deployer");
    address platform = makeAddr("platform");
    address treasury = makeAddr("treasury");
    address creator = makeAddr("creator");
    address buyer = makeAddr("buyer");

    bytes32 contentHash = keccak256("episode-1-content");

    function setUp() public {
        vm.startPrank(deployer);

        // Deploy PaymentRouter
        PaymentRouter routerImpl = new PaymentRouter();
        router = PaymentRouter(address(new ERC1967Proxy(
            address(routerImpl),
            abi.encodeCall(PaymentRouter.initialize, (treasury, 1000, address(0), 0))
        )));

        // Deploy RightsRegistry
        RightsRegistry registryImpl = new RightsRegistry();
        registry = RightsRegistry(address(new ERC1967Proxy(
            address(registryImpl),
            abi.encodeCall(RightsRegistry.initialize, (platform))
        )));

        // Deploy EpisodeEditionCollection via Beacon
        EpisodeEditionCollection impl = new EpisodeEditionCollection();
        UpgradeableBeacon beacon = new UpgradeableBeacon(address(impl), deployer);
        collection = EpisodeEditionCollection(address(new BeaconProxy(
            address(beacon),
            abi.encodeCall(EpisodeEditionCollection.initialize, (
                1, // universeId
                platform,
                address(registry),
                address(router),
                1000, // 10% platform fee
                500   // 5% royalty
            ))
        )));

        vm.stopPrank();
        vm.deal(buyer, 100 ether);
    }

    // ── Initialize ──

    function test_initialize() public view {
        assertEq(collection.universeId(), 1);
        assertEq(collection.platform(), platform);
        assertEq(collection.platformFeeBps(), 1000);
        assertEq(collection.royaltyBps(), 500);
    }

    // ── Create Edition ──

    function test_createEdition() public {
        vm.prank(creator);
        uint256 edId = collection.createEdition(1, contentHash, 0.01 ether, 100, "ipfs://meta");

        assertEq(edId, 0);
        (uint256 nodeId, bytes32 ch, address cr, uint256 price, uint256 maxSupply, uint256 minted, bool active) = collection.editions(0);
        assertEq(nodeId, 1);
        assertEq(ch, contentHash);
        assertEq(cr, creator);
        assertEq(price, 0.01 ether);
        assertEq(maxSupply, 100);
        assertEq(minted, 0);
        assertTrue(active);
    }

    function test_createEdition_openEdition() public {
        vm.prank(creator);
        collection.createEdition(1, contentHash, 0.01 ether, 0, "ipfs://meta"); // maxSupply=0 = open

        (,,,, uint256 maxSupply,,) = collection.editions(0);
        assertEq(maxSupply, 0);
    }

    function test_createEdition_revert_funContent() public {
        vm.prank(platform);
        registry.setRights(contentHash, IRightsRegistry.RightsType.FUN);

        vm.prank(creator);
        vm.expectRevert(EpisodeEditionCollection.ContentNotMonetizable.selector);
        collection.createEdition(1, contentHash, 0.01 ether, 100, "ipfs://meta");
    }

    function test_createEdition_revert_frozenContent() public {
        vm.prank(platform);
        registry.freeze(contentHash, "DMCA");

        vm.prank(creator);
        vm.expectRevert(EpisodeEditionCollection.ContentNotMonetizable.selector);
        collection.createEdition(1, contentHash, 0.01 ether, 100, "ipfs://meta");
    }

    // ── Mint ──

    function test_mint() public {
        vm.prank(creator);
        collection.createEdition(1, contentHash, 0.01 ether, 100, "ipfs://meta");

        vm.prank(buyer);
        collection.mint{value: 0.01 ether}(0, 1);

        assertEq(collection.balanceOf(buyer, 0), 1);
        (,,,,, uint256 minted,) = collection.editions(0);
        assertEq(minted, 1);
    }

    function test_mint_multiple() public {
        vm.prank(creator);
        collection.createEdition(1, contentHash, 0.01 ether, 100, "ipfs://meta");

        vm.prank(buyer);
        collection.mint{value: 0.05 ether}(0, 5);

        assertEq(collection.balanceOf(buyer, 0), 5);
    }

    function test_mint_routesPayment() public {
        vm.prank(creator);
        collection.createEdition(1, contentHash, 0.1 ether, 100, "ipfs://meta");

        vm.prank(buyer);
        collection.mint{value: 0.1 ether}(0, 1);

        // PaymentRouter: 10% to treasury, 90% accrued for creator
        assertEq(treasury.balance, 0.01 ether);
        assertEq(router.claimable(creator), 0.09 ether);
    }

    function test_mint_refundsExcess() public {
        vm.prank(creator);
        collection.createEdition(1, contentHash, 0.01 ether, 100, "ipfs://meta");

        uint256 buyerBefore = buyer.balance;
        vm.prank(buyer);
        collection.mint{value: 0.05 ether}(0, 1); // overpay

        // Should refund 0.04 ether
        assertEq(buyer.balance, buyerBefore - 0.01 ether);
    }

    function test_mint_revert_inactive() public {
        vm.prank(creator);
        collection.createEdition(1, contentHash, 0.01 ether, 100, "ipfs://meta");

        vm.prank(creator);
        collection.deactivateEdition(0);

        vm.prank(buyer);
        vm.expectRevert(EpisodeEditionCollection.EditionNotActive.selector);
        collection.mint{value: 0.01 ether}(0, 1);
    }

    function test_mint_revert_maxSupply() public {
        vm.prank(creator);
        collection.createEdition(1, contentHash, 0.01 ether, 2, "ipfs://meta");

        vm.startPrank(buyer);
        collection.mint{value: 0.02 ether}(0, 2);
        vm.expectRevert(EpisodeEditionCollection.MaxSupplyReached.selector);
        collection.mint{value: 0.01 ether}(0, 1);
        vm.stopPrank();
    }

    function test_mint_revert_insufficientPayment() public {
        vm.prank(creator);
        collection.createEdition(1, contentHash, 0.1 ether, 100, "ipfs://meta");

        vm.prank(buyer);
        vm.expectRevert(EpisodeEditionCollection.InsufficientPayment.selector);
        collection.mint{value: 0.05 ether}(0, 1);
    }

    // ── Free mint (price = 0) ──

    function test_mint_free() public {
        vm.prank(creator);
        collection.createEdition(1, contentHash, 0, 100, "ipfs://meta");

        vm.prank(buyer);
        collection.mint{value: 0}(0, 5);

        assertEq(collection.balanceOf(buyer, 0), 5);
    }

    // ── Deactivate ──

    function test_deactivateEdition_byCreator() public {
        vm.prank(creator);
        uint256 edId = collection.createEdition(1, contentHash, 0.01 ether, 100, "ipfs://meta");

        vm.prank(creator);
        collection.deactivateEdition(edId);

        (,,,,,, bool active) = collection.editions(edId);
        assertFalse(active);
    }

    function test_deactivateEdition_byPlatform() public {
        vm.prank(creator);
        uint256 edId = collection.createEdition(1, contentHash, 0.01 ether, 100, "ipfs://meta");

        vm.prank(platform);
        collection.deactivateEdition(edId);

        (,,,,,, bool active) = collection.editions(edId);
        assertFalse(active);
    }

    function test_deactivateEdition_revert_stranger() public {
        vm.prank(creator);
        uint256 edId = collection.createEdition(1, contentHash, 0.01 ether, 100, "ipfs://meta");

        vm.prank(buyer);
        vm.expectRevert(EpisodeEditionCollection.NotCreator.selector);
        collection.deactivateEdition(edId);
    }

    // ── URI ──

    function test_uri() public {
        vm.prank(creator);
        collection.createEdition(1, contentHash, 0, 0, "ipfs://QmTest");
        assertEq(collection.uri(0), "ipfs://QmTest");
    }

    // ── Platform fee admin ──

    function test_setPlatformFee() public {
        vm.prank(platform);
        collection.setPlatformFee(2000);
        assertEq(collection.platformFeeBps(), 2000);
    }

    function test_setPlatformFee_revert_tooHigh() public {
        vm.prank(platform);
        vm.expectRevert(EpisodeEditionCollection.FeeTooHigh.selector);
        collection.setPlatformFee(5001);
    }

    function test_setPlatformFee_revert_notPlatform() public {
        vm.prank(buyer);
        vm.expectRevert(EpisodeEditionCollection.NotPlatform.selector);
        collection.setPlatformFee(2000);
    }
}
