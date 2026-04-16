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
import {IERC1155Receiver} from "@openzeppelin/token/ERC1155/IERC1155Receiver.sol";

contract EpisodeEditionTest is Test {
    EpisodeEditionCollection public collection;
    PaymentRouter public router;
    RightsRegistry public registry;

    address deployer = makeAddr("deployer");
    address platform = makeAddr("platform");
    address treasury = makeAddr("treasury");
    address creator = makeAddr("creator");
    address creator2 = makeAddr("creator2");
    address buyer = makeAddr("buyer");
    address buyer2 = makeAddr("buyer2");

    bytes32 contentHash = keccak256("episode-1-content");
    bytes32 contentHash2 = keccak256("episode-2-content");
    bytes32 contentHash3 = keccak256("episode-3-content");

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
        vm.deal(buyer2, 100 ether);

        // Classify content as ORIGINAL so it passes monetization checks
        vm.startPrank(platform);
        registry.setRights(contentHash, IRightsRegistry.RightsType.ORIGINAL);
        registry.setRights(contentHash2, IRightsRegistry.RightsType.ORIGINAL);
        registry.setRights(contentHash3, IRightsRegistry.RightsType.LICENSED);
        vm.stopPrank();
    }

    // ══════════════════════════════════════════════════════════════
    // ── Initialize ──
    // ══════════════════════════════════════════════════════════════

    function test_initialize() public view {
        assertEq(collection.universeId(), 1);
        assertEq(collection.platform(), platform);
        assertEq(collection.platformFeeBps(), 1000);
        assertEq(collection.royaltyBps(), 500);
        assertEq(collection.nextEditionId(), 0);
    }

    function test_initialize_revert_feeTooHigh() public {
        vm.startPrank(deployer);
        EpisodeEditionCollection impl = new EpisodeEditionCollection();
        UpgradeableBeacon beacon = new UpgradeableBeacon(address(impl), deployer);

        vm.expectRevert(EpisodeEditionCollection.FeeTooHigh.selector);
        new BeaconProxy(
            address(beacon),
            abi.encodeCall(EpisodeEditionCollection.initialize, (
                1, platform, address(registry), address(router), 5001, 500
            ))
        );
        vm.stopPrank();
    }

    function test_initialize_revert_doubleInit() public {
        vm.expectRevert();
        collection.initialize(2, platform, address(registry), address(router), 1000, 500);
    }

    // ══════════════════════════════════════════════════════════════
    // ── Create Edition ──
    // ══════════════════════════════════════════════════════════════

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

    function test_createEdition_incrementsId() public {
        vm.startPrank(creator);
        uint256 id0 = collection.createEdition(1, contentHash, 0.01 ether, 100, "ipfs://meta0");
        uint256 id1 = collection.createEdition(2, contentHash2, 0.02 ether, 50, "ipfs://meta1");
        vm.stopPrank();

        assertEq(id0, 0);
        assertEq(id1, 1);
        assertEq(collection.nextEditionId(), 2);
    }

    function test_createEdition_openEdition() public {
        vm.prank(creator);
        collection.createEdition(1, contentHash, 0.01 ether, 0, "ipfs://meta"); // maxSupply=0 = open

        (,,,, uint256 maxSupply,,) = collection.editions(0);
        assertEq(maxSupply, 0);
    }

    function test_createEdition_setsUri() public {
        vm.prank(creator);
        collection.createEdition(1, contentHash, 0, 0, "ipfs://QmMyEdition");
        assertEq(collection.uri(0), "ipfs://QmMyEdition");
    }

    function test_createEdition_emitsEvent() public {
        vm.prank(creator);
        vm.expectEmit(true, false, false, true);
        emit EpisodeEditionCollection.EditionCreated(0, 1, contentHash, creator, 0.01 ether, 100);
        collection.createEdition(1, contentHash, 0.01 ether, 100, "ipfs://meta");
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

    function test_createEdition_revert_unsetContent() public {
        bytes32 unsetHash = keccak256("never-classified");

        vm.prank(creator);
        vm.expectRevert(EpisodeEditionCollection.ContentNotMonetizable.selector);
        collection.createEdition(1, unsetHash, 0.01 ether, 100, "ipfs://meta");
    }

    function test_createEdition_revert_whenPaused() public {
        vm.prank(platform);
        collection.pause();

        vm.prank(creator);
        vm.expectRevert();
        collection.createEdition(1, contentHash, 0.01 ether, 100, "ipfs://meta");
    }

    function test_createEdition_licensedContent() public {
        vm.prank(creator);
        uint256 edId = collection.createEdition(1, contentHash3, 0.05 ether, 10, "ipfs://licensed");
        assertEq(edId, 0);
    }

    // ══════════════════════════════════════════════════════════════
    // ── Mint ──
    // ══════════════════════════════════════════════════════════════

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
        (,,,,, uint256 minted,) = collection.editions(0);
        assertEq(minted, 5);
    }

    function test_mint_multipleBuyers() public {
        vm.prank(creator);
        collection.createEdition(1, contentHash, 0.01 ether, 100, "ipfs://meta");

        vm.prank(buyer);
        collection.mint{value: 0.03 ether}(0, 3);

        vm.prank(buyer2);
        collection.mint{value: 0.02 ether}(0, 2);

        assertEq(collection.balanceOf(buyer, 0), 3);
        assertEq(collection.balanceOf(buyer2, 0), 2);
        (,,,,, uint256 minted,) = collection.editions(0);
        assertEq(minted, 5);
    }

    function test_mint_emitsEvent() public {
        vm.prank(creator);
        collection.createEdition(1, contentHash, 0.01 ether, 100, "ipfs://meta");

        vm.prank(buyer);
        vm.expectEmit(true, false, false, true);
        emit EpisodeEditionCollection.EditionMinted(0, buyer, 3, 0.03 ether);
        collection.mint{value: 0.03 ether}(0, 3);
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

    function test_mint_routesPayment_multipleMints() public {
        vm.prank(creator);
        collection.createEdition(1, contentHash, 0.1 ether, 100, "ipfs://meta");

        vm.prank(buyer);
        collection.mint{value: 0.3 ether}(0, 3);

        // 0.3 ETH total: 10% = 0.03 to treasury, 90% = 0.27 to creator
        assertEq(treasury.balance, 0.03 ether);
        assertEq(router.claimable(creator), 0.27 ether);
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

    function test_mint_revert_maxSupply_exactOverflow() public {
        vm.prank(creator);
        collection.createEdition(1, contentHash, 0.01 ether, 5, "ipfs://meta");

        vm.startPrank(buyer);
        collection.mint{value: 0.03 ether}(0, 3);
        // Trying to mint 3 more when only 2 left
        vm.expectRevert(EpisodeEditionCollection.MaxSupplyReached.selector);
        collection.mint{value: 0.03 ether}(0, 3);
        vm.stopPrank();
    }

    function test_mint_revert_insufficientPayment() public {
        vm.prank(creator);
        collection.createEdition(1, contentHash, 0.1 ether, 100, "ipfs://meta");

        vm.prank(buyer);
        vm.expectRevert(EpisodeEditionCollection.InsufficientPayment.selector);
        collection.mint{value: 0.05 ether}(0, 1);
    }

    function test_mint_revert_insufficientPayment_multipleAmount() public {
        vm.prank(creator);
        collection.createEdition(1, contentHash, 0.1 ether, 100, "ipfs://meta");

        // 3 copies at 0.1 = 0.3, but only send 0.2
        vm.prank(buyer);
        vm.expectRevert(EpisodeEditionCollection.InsufficientPayment.selector);
        collection.mint{value: 0.2 ether}(0, 3);
    }

    function test_mint_revert_whenPaused() public {
        vm.prank(creator);
        collection.createEdition(1, contentHash, 0.01 ether, 100, "ipfs://meta");

        vm.prank(platform);
        collection.pause();

        vm.prank(buyer);
        vm.expectRevert();
        collection.mint{value: 0.01 ether}(0, 1);
    }

    // ══════════════════════════════════════════════════════════════
    // ── Free Mint (price = 0) ──
    // ══════════════════════════════════════════════════════════════

    function test_mint_free() public {
        vm.prank(creator);
        collection.createEdition(1, contentHash, 0, 100, "ipfs://meta");

        vm.prank(buyer);
        collection.mint{value: 0}(0, 5);

        assertEq(collection.balanceOf(buyer, 0), 5);
    }

    function test_mint_free_noPaymentRouted() public {
        vm.prank(creator);
        collection.createEdition(1, contentHash, 0, 100, "ipfs://meta");

        vm.prank(buyer);
        collection.mint{value: 0}(0, 5);

        assertEq(treasury.balance, 0);
        assertEq(router.claimable(creator), 0);
    }

    function test_mint_free_openEdition() public {
        vm.prank(creator);
        collection.createEdition(1, contentHash, 0, 0, "ipfs://meta"); // free + unlimited

        vm.prank(buyer);
        collection.mint{value: 0}(0, 50);

        assertEq(collection.balanceOf(buyer, 0), 50);
    }

    // ══════════════════════════════════════════════════════════════
    // ── Open Edition (maxSupply = 0) ──
    // ══════════════════════════════════════════════════════════════

    function test_mint_openEdition_noSupplyLimit() public {
        vm.prank(creator);
        collection.createEdition(1, contentHash, 0.001 ether, 0, "ipfs://meta");

        vm.prank(buyer);
        collection.mint{value: 1 ether}(0, 1000);

        assertEq(collection.balanceOf(buyer, 0), 1000);
    }

    // ══════════════════════════════════════════════════════════════
    // ── Supply Limits ──
    // ══════════════════════════════════════════════════════════════

    function test_mint_exactSupply() public {
        vm.prank(creator);
        collection.createEdition(1, contentHash, 0.01 ether, 3, "ipfs://meta");

        vm.prank(buyer);
        collection.mint{value: 0.03 ether}(0, 3);

        assertEq(collection.balanceOf(buyer, 0), 3);
        (,,,,, uint256 minted,) = collection.editions(0);
        assertEq(minted, 3);
    }

    function test_mint_supplyOneEdition() public {
        vm.prank(creator);
        collection.createEdition(1, contentHash, 0.5 ether, 1, "ipfs://meta");

        vm.prank(buyer);
        collection.mint{value: 0.5 ether}(0, 1);

        assertEq(collection.balanceOf(buyer, 0), 1);

        vm.prank(buyer2);
        vm.expectRevert(EpisodeEditionCollection.MaxSupplyReached.selector);
        collection.mint{value: 0.5 ether}(0, 1);
    }

    // ══════════════════════════════════════════════════════════════
    // ── Multiple Editions ──
    // ══════════════════════════════════════════════════════════════

    function test_multipleEditions_independentTracking() public {
        vm.startPrank(creator);
        collection.createEdition(1, contentHash, 0.01 ether, 10, "ipfs://ep1");
        collection.createEdition(2, contentHash2, 0.02 ether, 5, "ipfs://ep2");
        vm.stopPrank();

        vm.startPrank(buyer);
        collection.mint{value: 0.03 ether}(0, 3);
        collection.mint{value: 0.04 ether}(1, 2);
        vm.stopPrank();

        assertEq(collection.balanceOf(buyer, 0), 3);
        assertEq(collection.balanceOf(buyer, 1), 2);

        (,,,,, uint256 minted0,) = collection.editions(0);
        (,,,,, uint256 minted1,) = collection.editions(1);
        assertEq(minted0, 3);
        assertEq(minted1, 2);
    }

    function test_multipleEditions_differentCreators() public {
        vm.prank(creator);
        collection.createEdition(1, contentHash, 0.1 ether, 10, "ipfs://ep1");

        vm.prank(creator2);
        collection.createEdition(2, contentHash2, 0.2 ether, 10, "ipfs://ep2");

        vm.prank(buyer);
        collection.mint{value: 0.1 ether}(0, 1);

        vm.prank(buyer);
        collection.mint{value: 0.2 ether}(1, 1);

        // creator gets 90% of 0.1 = 0.09
        assertEq(router.claimable(creator), 0.09 ether);
        // creator2 gets 90% of 0.2 = 0.18
        assertEq(router.claimable(creator2), 0.18 ether);
        // treasury gets 10% of 0.3 = 0.03
        assertEq(treasury.balance, 0.03 ether);
    }

    function test_multipleEditions_independentUris() public {
        vm.startPrank(creator);
        collection.createEdition(1, contentHash, 0, 0, "ipfs://uri-A");
        collection.createEdition(2, contentHash2, 0, 0, "ipfs://uri-B");
        vm.stopPrank();

        assertEq(collection.uri(0), "ipfs://uri-A");
        assertEq(collection.uri(1), "ipfs://uri-B");
    }

    function test_multipleEditions_deactivateOneKeepsOther() public {
        vm.startPrank(creator);
        collection.createEdition(1, contentHash, 0.01 ether, 10, "ipfs://ep1");
        collection.createEdition(2, contentHash2, 0.01 ether, 10, "ipfs://ep2");
        collection.deactivateEdition(0);
        vm.stopPrank();

        vm.startPrank(buyer);
        vm.expectRevert(EpisodeEditionCollection.EditionNotActive.selector);
        collection.mint{value: 0.01 ether}(0, 1);

        // Edition 1 still active
        collection.mint{value: 0.01 ether}(1, 1);
        vm.stopPrank();

        assertEq(collection.balanceOf(buyer, 1), 1);
    }

    // ══════════════════════════════════════════════════════════════
    // ── Deactivate ──
    // ══════════════════════════════════════════════════════════════

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

    function test_deactivateEdition_emitsEvent() public {
        vm.prank(creator);
        collection.createEdition(1, contentHash, 0.01 ether, 100, "ipfs://meta");

        vm.prank(creator);
        vm.expectEmit(true, false, false, true);
        emit EpisodeEditionCollection.EditionDeactivated(0);
        collection.deactivateEdition(0);
    }

    function test_deactivateEdition_revert_stranger() public {
        vm.prank(creator);
        uint256 edId = collection.createEdition(1, contentHash, 0.01 ether, 100, "ipfs://meta");

        vm.prank(buyer);
        vm.expectRevert(EpisodeEditionCollection.NotCreator.selector);
        collection.deactivateEdition(edId);
    }

    function test_deactivateEdition_existingTokensSurvive() public {
        vm.prank(creator);
        collection.createEdition(1, contentHash, 0.01 ether, 100, "ipfs://meta");

        vm.prank(buyer);
        collection.mint{value: 0.02 ether}(0, 2);

        vm.prank(creator);
        collection.deactivateEdition(0);

        // Existing tokens still held
        assertEq(collection.balanceOf(buyer, 0), 2);
    }

    // ══════════════════════════════════════════════════════════════
    // ── Royalties (ERC2981) ──
    // ══════════════════════════════════════════════════════════════

    function test_royaltyInfo() public {
        vm.prank(creator);
        collection.createEdition(1, contentHash, 0.1 ether, 100, "ipfs://meta");

        (address receiver, uint256 amount) = collection.royaltyInfo(0, 1 ether);
        assertEq(receiver, creator);
        // 5% royalty => 0.05 ether on 1 ether sale
        assertEq(amount, 0.05 ether);
    }

    function test_royaltyInfo_differentCreators() public {
        vm.prank(creator);
        collection.createEdition(1, contentHash, 0.1 ether, 10, "ipfs://ep1");

        vm.prank(creator2);
        collection.createEdition(2, contentHash2, 0.1 ether, 10, "ipfs://ep2");

        (address receiver0,) = collection.royaltyInfo(0, 1 ether);
        (address receiver1,) = collection.royaltyInfo(1, 1 ether);

        assertEq(receiver0, creator);
        assertEq(receiver1, creator2);
    }

    function test_royaltyInfo_scalesToSalePrice() public {
        vm.prank(creator);
        collection.createEdition(1, contentHash, 0, 0, "ipfs://meta");

        (, uint256 amount10) = collection.royaltyInfo(0, 10 ether);
        (, uint256 amount100) = collection.royaltyInfo(0, 100 ether);

        assertEq(amount10, 0.5 ether);   // 5% of 10
        assertEq(amount100, 5 ether);     // 5% of 100
    }

    // ══════════════════════════════════════════════════════════════
    // ── Pause Functionality ──
    // ══════════════════════════════════════════════════════════════

    function test_pause_byPlatform() public {
        vm.prank(platform);
        collection.pause();

        // Cannot create
        vm.prank(creator);
        vm.expectRevert();
        collection.createEdition(1, contentHash, 0.01 ether, 100, "ipfs://meta");
    }

    function test_unpause_byPlatform() public {
        vm.prank(platform);
        collection.pause();

        vm.prank(platform);
        collection.unpause();

        // Can create again
        vm.prank(creator);
        collection.createEdition(1, contentHash, 0.01 ether, 100, "ipfs://meta");
    }

    function test_pause_revert_notPlatform() public {
        vm.prank(buyer);
        vm.expectRevert(EpisodeEditionCollection.NotPlatform.selector);
        collection.pause();
    }

    function test_unpause_revert_notPlatform() public {
        vm.prank(platform);
        collection.pause();

        vm.prank(buyer);
        vm.expectRevert(EpisodeEditionCollection.NotPlatform.selector);
        collection.unpause();
    }

    function test_pause_blocksMint() public {
        vm.prank(creator);
        collection.createEdition(1, contentHash, 0.01 ether, 100, "ipfs://meta");

        vm.prank(platform);
        collection.pause();

        vm.prank(buyer);
        vm.expectRevert();
        collection.mint{value: 0.01 ether}(0, 1);
    }

    function test_pause_doesNotBlockDeactivate() public {
        vm.prank(creator);
        collection.createEdition(1, contentHash, 0.01 ether, 100, "ipfs://meta");

        vm.prank(platform);
        collection.pause();

        // deactivateEdition is not guarded by whenNotPaused
        vm.prank(creator);
        collection.deactivateEdition(0);

        (,,,,,, bool active) = collection.editions(0);
        assertFalse(active);
    }

    // ══════════════════════════════════════════════════════════════
    // ── Platform Fee Admin ──
    // ══════════════════════════════════════════════════════════════

    function test_setPlatformFee() public {
        vm.prank(platform);
        collection.setPlatformFee(2000);
        assertEq(collection.platformFeeBps(), 2000);
    }

    function test_setPlatformFee_toZero() public {
        vm.prank(platform);
        collection.setPlatformFee(0);
        assertEq(collection.platformFeeBps(), 0);
    }

    function test_setPlatformFee_maxAllowed() public {
        vm.prank(platform);
        collection.setPlatformFee(5000);
        assertEq(collection.platformFeeBps(), 5000);
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

    function test_setPlatformFee_affectsSubsequentMints() public {
        vm.prank(creator);
        collection.createEdition(1, contentHash, 1 ether, 100, "ipfs://meta");

        // Change fee from 10% to 20%
        vm.prank(platform);
        collection.setPlatformFee(2000);

        vm.prank(buyer);
        collection.mint{value: 1 ether}(0, 1);

        // 20% to treasury, 80% to creator
        assertEq(treasury.balance, 0.2 ether);
        assertEq(router.claimable(creator), 0.8 ether);
    }

    // ══════════════════════════════════════════════════════════════
    // ── URI ──
    // ══════════════════════════════════════════════════════════════

    function test_uri() public {
        vm.prank(creator);
        collection.createEdition(1, contentHash, 0, 0, "ipfs://QmTest");
        assertEq(collection.uri(0), "ipfs://QmTest");
    }

    function test_uri_emptyForNonexistent() public view {
        assertEq(collection.uri(999), "");
    }

    // ══════════════════════════════════════════════════════════════
    // ── supportsInterface (ERC1155 + ERC2981) ──
    // ══════════════════════════════════════════════════════════════

    function test_supportsInterface_ERC1155() public view {
        // ERC1155 interface ID
        assertTrue(collection.supportsInterface(0xd9b67a26));
    }

    function test_supportsInterface_ERC2981() public view {
        // ERC2981 interface ID
        assertTrue(collection.supportsInterface(0x2a55205a));
    }

    function test_supportsInterface_ERC165() public view {
        // ERC165 interface ID
        assertTrue(collection.supportsInterface(0x01ffc9a7));
    }
}
