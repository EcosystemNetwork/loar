// SPDX-License-Identifier: MIT
pragma solidity =0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/proxy/ERC1967/ERC1967Proxy.sol";
import {UpgradeableBeacon} from "@openzeppelin/proxy/beacon/UpgradeableBeacon.sol";
import {BeaconProxy} from "@openzeppelin/proxy/beacon/BeaconProxy.sol";
import {PaymentRouter} from "../src/PaymentRouter.sol";
import {RightsRegistry} from "../src/RightsRegistry.sol";
import {IRightsRegistry} from "../src/interfaces/IRightsRegistry.sol";
import {EntityEditionNFT} from "../src/revenue/EntityEditionNFT.sol";

contract EntityEditionNFTTest is Test {
    EntityEditionNFT public nft;
    PaymentRouter public router;
    RightsRegistry public registry;

    address deployer = makeAddr("deployer");
    address platform = makeAddr("platform");
    address treasury = makeAddr("treasury");
    address creator = makeAddr("creator");
    address creator2 = makeAddr("creator2");
    address buyer = makeAddr("buyer");
    address buyer2 = makeAddr("buyer2");

    uint256 constant UNIVERSE_ID = 42;

    bytes32 contentHash = keccak256("entity-content-1");
    bytes32 contentHash2 = keccak256("entity-content-2");
    bytes32 contentHash3 = keccak256("entity-content-3");

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

        // Deploy EntityEditionNFT via Beacon
        EntityEditionNFT impl = new EntityEditionNFT();
        UpgradeableBeacon beacon = new UpgradeableBeacon(address(impl), deployer);
        nft = EntityEditionNFT(address(new BeaconProxy(
            address(beacon),
            abi.encodeCall(EntityEditionNFT.initialize, (
                UNIVERSE_ID,
                platform,
                address(router),
                address(registry),
                1000, // 10% platform fee
                500   // 5% royalty
            ))
        )));

        vm.stopPrank();
        vm.deal(buyer, 100 ether);
        vm.deal(buyer2, 100 ether);

        // Classify content as monetizable (owner bypass for test setup;
        // production would use setRightsWithCreatorSig).
        vm.startPrank(deployer);
        registry.setRights(contentHash, IRightsRegistry.RightsType.ORIGINAL);
        registry.setRights(contentHash2, IRightsRegistry.RightsType.LICENSED);
        registry.setRights(contentHash3, IRightsRegistry.RightsType.PUBLIC_DOMAIN);
        vm.stopPrank();
    }

    // ══════════════════════════════════════════════════════════════
    // ── Initialize ──
    // ══════════════════════════════════════════════════════════════

    function test_initialize() public view {
        assertEq(nft.universeId(), UNIVERSE_ID);
        assertEq(nft.platform(), platform);
        assertEq(nft.platformFeeBps(), 1000);
        assertEq(nft.royaltyBps(), 500);
        assertEq(nft.nextEditionId(), 0);
    }

    function test_initialize_revert_feeTooHigh() public {
        vm.startPrank(deployer);
        EntityEditionNFT impl = new EntityEditionNFT();
        UpgradeableBeacon beacon = new UpgradeableBeacon(address(impl), deployer);

        vm.expectRevert(EntityEditionNFT.FeeTooHigh.selector);
        new BeaconProxy(
            address(beacon),
            abi.encodeCall(EntityEditionNFT.initialize, (
                UNIVERSE_ID, platform, address(router), address(registry), 5001, 500
            ))
        );
        vm.stopPrank();
    }

    function test_initialize_revert_doubleInit() public {
        vm.expectRevert();
        nft.initialize(UNIVERSE_ID, platform, address(router), address(registry), 1000, 500);
    }

    // ══════════════════════════════════════════════════════════════
    // ── Create Edition ──
    // ══════════════════════════════════════════════════════════════

    function test_createEdition() public {
        vm.prank(creator);
        uint256 edId = nft.createEdition(
            UNIVERSE_ID,
            EntityEditionNFT.EntityKind.THING,
            "Magic Sword",
            contentHash,
            0.01 ether,
            100,
            "ipfs://meta"
        );

        assertEq(edId, 0);
        (
            uint256 uId,
            EntityEditionNFT.EntityKind kind,
            string memory name,
            bytes32 ch,
            address cr,
            uint256 price,
            uint256 maxSupply,
            uint256 minted,
            bool active
        ) = nft.editions(0);
        assertEq(uId, UNIVERSE_ID);
        assertEq(uint8(kind), uint8(EntityEditionNFT.EntityKind.THING));
        assertEq(name, "Magic Sword");
        assertEq(ch, contentHash);
        assertEq(cr, creator);
        assertEq(price, 0.01 ether);
        assertEq(maxSupply, 100);
        assertEq(minted, 0);
        assertTrue(active);
    }

    function test_createEdition_allKinds() public {
        vm.startPrank(creator);

        uint256 id0 = nft.createEdition(UNIVERSE_ID, EntityEditionNFT.EntityKind.THING, "Sword", contentHash, 0, 0, "ipfs://0");
        uint256 id1 = nft.createEdition(UNIVERSE_ID, EntityEditionNFT.EntityKind.LORE, "Legend", contentHash2, 0, 0, "ipfs://1");
        uint256 id2 = nft.createEdition(UNIVERSE_ID, EntityEditionNFT.EntityKind.SPECIES, "Elf", contentHash3, 0, 0, "ipfs://2");

        bytes32 ch4 = keccak256("entity-4");
        vm.stopPrank();

        vm.prank(deployer);
        registry.setRights(ch4, IRightsRegistry.RightsType.ORIGINAL);

        vm.prank(creator);
        uint256 id3 = nft.createEdition(UNIVERSE_ID, EntityEditionNFT.EntityKind.TECHNOLOGY, "Warp Drive", ch4, 0, 0, "ipfs://3");

        assertEq(id0, 0);
        assertEq(id1, 1);
        assertEq(id2, 2);
        assertEq(id3, 3);

        (, EntityEditionNFT.EntityKind k0,,,,,,, ) = nft.editions(0);
        (, EntityEditionNFT.EntityKind k1,,,,,,, ) = nft.editions(1);
        (, EntityEditionNFT.EntityKind k2,,,,,,, ) = nft.editions(2);
        (, EntityEditionNFT.EntityKind k3,,,,,,, ) = nft.editions(3);

        assertEq(uint8(k0), uint8(EntityEditionNFT.EntityKind.THING));
        assertEq(uint8(k1), uint8(EntityEditionNFT.EntityKind.LORE));
        assertEq(uint8(k2), uint8(EntityEditionNFT.EntityKind.SPECIES));
        assertEq(uint8(k3), uint8(EntityEditionNFT.EntityKind.TECHNOLOGY));
    }

    function test_createEdition_incrementsId() public {
        vm.startPrank(creator);
        uint256 id0 = nft.createEdition(UNIVERSE_ID, EntityEditionNFT.EntityKind.THING, "A", contentHash, 0, 0, "ipfs://0");
        uint256 id1 = nft.createEdition(UNIVERSE_ID, EntityEditionNFT.EntityKind.LORE, "B", contentHash2, 0, 0, "ipfs://1");
        vm.stopPrank();

        assertEq(id0, 0);
        assertEq(id1, 1);
        assertEq(nft.nextEditionId(), 2);
    }

    function test_createEdition_openEdition() public {
        vm.prank(creator);
        nft.createEdition(UNIVERSE_ID, EntityEditionNFT.EntityKind.THING, "Open", contentHash, 0, 0, "ipfs://meta");

        (,,,,,, uint256 maxSupply,,) = nft.editions(0);
        assertEq(maxSupply, 0);
    }

    function test_createEdition_setsUri() public {
        vm.prank(creator);
        nft.createEdition(UNIVERSE_ID, EntityEditionNFT.EntityKind.LORE, "Lore", contentHash, 0, 0, "ipfs://QmEntity");
        assertEq(nft.uri(0), "ipfs://QmEntity");
    }

    function test_createEdition_emitsEvent() public {
        vm.prank(creator);
        vm.expectEmit(true, true, false, true);
        emit EntityEditionNFT.EditionCreated(0, UNIVERSE_ID, EntityEditionNFT.EntityKind.THING, "Sword", creator, 0.01 ether, 100);
        nft.createEdition(UNIVERSE_ID, EntityEditionNFT.EntityKind.THING, "Sword", contentHash, 0.01 ether, 100, "ipfs://meta");
    }

    function test_createEdition_revert_wrongUniverse() public {
        vm.prank(creator);
        vm.expectRevert(EntityEditionNFT.WrongUniverse.selector);
        nft.createEdition(999, EntityEditionNFT.EntityKind.THING, "Bad", contentHash, 0, 0, "ipfs://meta");
    }

    function test_createEdition_revert_funContent() public {
        bytes32 funHash = keccak256("fun-content");
        vm.prank(platform);
        registry.setRights(funHash, IRightsRegistry.RightsType.FUN);

        vm.prank(creator);
        vm.expectRevert(EntityEditionNFT.ContentNotMonetizable.selector);
        nft.createEdition(UNIVERSE_ID, EntityEditionNFT.EntityKind.THING, "Fun", funHash, 0, 0, "ipfs://meta");
    }

    function test_createEdition_revert_frozenContent() public {
        vm.prank(platform);
        registry.emergencyFreeze(contentHash, "DMCA");

        vm.prank(creator);
        vm.expectRevert(EntityEditionNFT.ContentNotMonetizable.selector);
        nft.createEdition(UNIVERSE_ID, EntityEditionNFT.EntityKind.THING, "Frozen", contentHash, 0, 0, "ipfs://meta");
    }

    function test_createEdition_revert_unsetContent() public {
        bytes32 unsetHash = keccak256("never-classified");

        vm.prank(creator);
        vm.expectRevert(EntityEditionNFT.ContentNotMonetizable.selector);
        nft.createEdition(UNIVERSE_ID, EntityEditionNFT.EntityKind.THING, "Unset", unsetHash, 0, 0, "ipfs://meta");
    }

    function test_createEdition_revert_whenPaused() public {
        vm.prank(platform);
        nft.pause();

        vm.prank(creator);
        vm.expectRevert();
        nft.createEdition(UNIVERSE_ID, EntityEditionNFT.EntityKind.THING, "Paused", contentHash, 0, 0, "ipfs://meta");
    }

    // ══════════════════════════════════════════════════════════════
    // ── Mint ──
    // ══════════════════════════════════════════════════════════════

    function test_mint() public {
        vm.prank(creator);
        nft.createEdition(UNIVERSE_ID, EntityEditionNFT.EntityKind.THING, "Sword", contentHash, 0.01 ether, 100, "ipfs://meta");

        vm.prank(buyer);
        nft.mint{value: 0.01 ether}(0, 1);

        assertEq(nft.balanceOf(buyer, 0), 1);
        (,,,,,, , uint256 minted,) = nft.editions(0);
        assertEq(minted, 1);
    }

    function test_mint_multiple() public {
        vm.prank(creator);
        nft.createEdition(UNIVERSE_ID, EntityEditionNFT.EntityKind.THING, "Sword", contentHash, 0.01 ether, 100, "ipfs://meta");

        vm.prank(buyer);
        nft.mint{value: 0.05 ether}(0, 5);

        assertEq(nft.balanceOf(buyer, 0), 5);
        (,,,,,,,uint256 minted,) = nft.editions(0);
        assertEq(minted, 5);
    }

    function test_mint_multipleBuyers() public {
        vm.prank(creator);
        nft.createEdition(UNIVERSE_ID, EntityEditionNFT.EntityKind.THING, "Sword", contentHash, 0.01 ether, 100, "ipfs://meta");

        vm.prank(buyer);
        nft.mint{value: 0.03 ether}(0, 3);

        vm.prank(buyer2);
        nft.mint{value: 0.02 ether}(0, 2);

        assertEq(nft.balanceOf(buyer, 0), 3);
        assertEq(nft.balanceOf(buyer2, 0), 2);
        (,,,,,,,uint256 minted,) = nft.editions(0);
        assertEq(minted, 5);
    }

    function test_mint_emitsEvent() public {
        vm.prank(creator);
        nft.createEdition(UNIVERSE_ID, EntityEditionNFT.EntityKind.THING, "Sword", contentHash, 0.01 ether, 100, "ipfs://meta");

        vm.prank(buyer);
        vm.expectEmit(true, false, false, true);
        emit EntityEditionNFT.EditionMinted(0, buyer, 3, 0.03 ether);
        nft.mint{value: 0.03 ether}(0, 3);
    }

    // ══════════════════════════════════════════════════════════════
    // ── Payment Routing ──
    // ══════════════════════════════════════════════════════════════

    function test_mint_routesPayment() public {
        vm.prank(creator);
        nft.createEdition(UNIVERSE_ID, EntityEditionNFT.EntityKind.THING, "Sword", contentHash, 0.1 ether, 100, "ipfs://meta");

        vm.prank(buyer);
        nft.mint{value: 0.1 ether}(0, 1);

        // 10% to treasury, 90% accrued for creator
        assertEq(treasury.balance, 0.01 ether);
        assertEq(router.claimable(creator), 0.09 ether);
    }

    function test_mint_routesPayment_multipleMints() public {
        vm.prank(creator);
        nft.createEdition(UNIVERSE_ID, EntityEditionNFT.EntityKind.THING, "Sword", contentHash, 0.1 ether, 100, "ipfs://meta");

        vm.prank(buyer);
        nft.mint{value: 0.3 ether}(0, 3);

        assertEq(treasury.balance, 0.03 ether);
        assertEq(router.claimable(creator), 0.27 ether);
    }

    function test_mint_routesPayment_differentCreators() public {
        vm.prank(creator);
        nft.createEdition(UNIVERSE_ID, EntityEditionNFT.EntityKind.THING, "Sword", contentHash, 0.1 ether, 10, "ipfs://0");

        vm.prank(creator2);
        nft.createEdition(UNIVERSE_ID, EntityEditionNFT.EntityKind.LORE, "Lore", contentHash2, 0.2 ether, 10, "ipfs://1");

        vm.prank(buyer);
        nft.mint{value: 0.1 ether}(0, 1);

        vm.prank(buyer);
        nft.mint{value: 0.2 ether}(1, 1);

        assertEq(router.claimable(creator), 0.09 ether);
        assertEq(router.claimable(creator2), 0.18 ether);
        assertEq(treasury.balance, 0.03 ether);
    }

    function test_mint_refundsExcess() public {
        vm.prank(creator);
        nft.createEdition(UNIVERSE_ID, EntityEditionNFT.EntityKind.THING, "Sword", contentHash, 0.01 ether, 100, "ipfs://meta");

        uint256 buyerBefore = buyer.balance;
        vm.prank(buyer);
        nft.mint{value: 0.05 ether}(0, 1); // overpay by 0.04

        assertEq(buyer.balance, buyerBefore - 0.01 ether);
    }

    // ══════════════════════════════════════════════════════════════
    // ── Free Mint ──
    // ══════════════════════════════════════════════════════════════

    function test_mint_free() public {
        vm.prank(creator);
        nft.createEdition(UNIVERSE_ID, EntityEditionNFT.EntityKind.LORE, "Free Lore", contentHash, 0, 100, "ipfs://meta");

        vm.prank(buyer);
        nft.mint{value: 0}(0, 5);

        assertEq(nft.balanceOf(buyer, 0), 5);
        assertEq(treasury.balance, 0);
        assertEq(router.claimable(creator), 0);
    }

    function test_mint_free_openEdition() public {
        vm.prank(creator);
        nft.createEdition(UNIVERSE_ID, EntityEditionNFT.EntityKind.SPECIES, "Common Elf", contentHash, 0, 0, "ipfs://meta");

        vm.prank(buyer);
        nft.mint{value: 0}(0, 50);

        assertEq(nft.balanceOf(buyer, 0), 50);
    }

    // ══════════════════════════════════════════════════════════════
    // ── Supply Limits ──
    // ══════════════════════════════════════════════════════════════

    function test_mint_exactSupply() public {
        vm.prank(creator);
        nft.createEdition(UNIVERSE_ID, EntityEditionNFT.EntityKind.THING, "Rare", contentHash, 0.01 ether, 3, "ipfs://meta");

        vm.prank(buyer);
        nft.mint{value: 0.03 ether}(0, 3);

        assertEq(nft.balanceOf(buyer, 0), 3);
        (,,,,,,,uint256 minted,) = nft.editions(0);
        assertEq(minted, 3);
    }

    function test_mint_revert_maxSupply() public {
        vm.prank(creator);
        nft.createEdition(UNIVERSE_ID, EntityEditionNFT.EntityKind.THING, "Limited", contentHash, 0.01 ether, 2, "ipfs://meta");

        vm.startPrank(buyer);
        nft.mint{value: 0.02 ether}(0, 2);
        vm.expectRevert(EntityEditionNFT.MaxSupplyReached.selector);
        nft.mint{value: 0.01 ether}(0, 1);
        vm.stopPrank();
    }

    function test_mint_revert_maxSupply_partialOverflow() public {
        vm.prank(creator);
        nft.createEdition(UNIVERSE_ID, EntityEditionNFT.EntityKind.THING, "Limited5", contentHash, 0.01 ether, 5, "ipfs://meta");

        vm.startPrank(buyer);
        nft.mint{value: 0.03 ether}(0, 3);
        // 3 minted, 2 remaining, trying to mint 3
        vm.expectRevert(EntityEditionNFT.MaxSupplyReached.selector);
        nft.mint{value: 0.03 ether}(0, 3);
        vm.stopPrank();
    }

    function test_mint_supplyOneEdition() public {
        vm.prank(creator);
        nft.createEdition(UNIVERSE_ID, EntityEditionNFT.EntityKind.TECHNOLOGY, "Unique Tech", contentHash, 1 ether, 1, "ipfs://meta");

        vm.prank(buyer);
        nft.mint{value: 1 ether}(0, 1);

        vm.prank(buyer2);
        vm.expectRevert(EntityEditionNFT.MaxSupplyReached.selector);
        nft.mint{value: 1 ether}(0, 1);
    }

    function test_mint_openEdition_noLimit() public {
        vm.prank(creator);
        nft.createEdition(UNIVERSE_ID, EntityEditionNFT.EntityKind.THING, "Open", contentHash, 0.001 ether, 0, "ipfs://meta");

        vm.prank(buyer);
        nft.mint{value: 1 ether}(0, 1000);

        assertEq(nft.balanceOf(buyer, 0), 1000);
    }

    // ══════════════════════════════════════════════════════════════
    // ── Mint Reverts ──
    // ══════════════════════════════════════════════════════════════

    function test_mint_revert_inactive() public {
        vm.prank(creator);
        nft.createEdition(UNIVERSE_ID, EntityEditionNFT.EntityKind.THING, "Sword", contentHash, 0.01 ether, 100, "ipfs://meta");

        vm.prank(creator);
        nft.deactivate(0);

        vm.prank(buyer);
        vm.expectRevert(EntityEditionNFT.EditionNotActive.selector);
        nft.mint{value: 0.01 ether}(0, 1);
    }

    function test_mint_revert_insufficientPayment() public {
        vm.prank(creator);
        nft.createEdition(UNIVERSE_ID, EntityEditionNFT.EntityKind.THING, "Sword", contentHash, 0.1 ether, 100, "ipfs://meta");

        vm.prank(buyer);
        vm.expectRevert(EntityEditionNFT.InsufficientPayment.selector);
        nft.mint{value: 0.05 ether}(0, 1);
    }

    function test_mint_revert_insufficientPayment_multipleAmount() public {
        vm.prank(creator);
        nft.createEdition(UNIVERSE_ID, EntityEditionNFT.EntityKind.THING, "Sword", contentHash, 0.1 ether, 100, "ipfs://meta");

        vm.prank(buyer);
        vm.expectRevert(EntityEditionNFT.InsufficientPayment.selector);
        nft.mint{value: 0.2 ether}(0, 3); // needs 0.3
    }

    function test_mint_revert_whenPaused() public {
        vm.prank(creator);
        nft.createEdition(UNIVERSE_ID, EntityEditionNFT.EntityKind.THING, "Sword", contentHash, 0.01 ether, 100, "ipfs://meta");

        vm.prank(platform);
        nft.pause();

        vm.prank(buyer);
        vm.expectRevert();
        nft.mint{value: 0.01 ether}(0, 1);
    }

    // ══════════════════════════════════════════════════════════════
    // ── Deactivate ──
    // ══════════════════════════════════════════════════════════════

    function test_deactivate_byCreator() public {
        vm.prank(creator);
        nft.createEdition(UNIVERSE_ID, EntityEditionNFT.EntityKind.THING, "Sword", contentHash, 0.01 ether, 100, "ipfs://meta");

        vm.prank(creator);
        nft.deactivate(0);

        (,,,,,,,,bool active) = nft.editions(0);
        assertFalse(active);
    }

    function test_deactivate_byPlatform() public {
        vm.prank(creator);
        nft.createEdition(UNIVERSE_ID, EntityEditionNFT.EntityKind.THING, "Sword", contentHash, 0.01 ether, 100, "ipfs://meta");

        vm.prank(platform);
        nft.deactivate(0);

        (,,,,,,,,bool active) = nft.editions(0);
        assertFalse(active);
    }

    function test_deactivate_emitsEvent() public {
        vm.prank(creator);
        nft.createEdition(UNIVERSE_ID, EntityEditionNFT.EntityKind.THING, "Sword", contentHash, 0, 0, "ipfs://meta");

        vm.prank(creator);
        vm.expectEmit(true, false, false, true);
        emit EntityEditionNFT.EditionDeactivated(0);
        nft.deactivate(0);
    }

    function test_deactivate_revert_stranger() public {
        vm.prank(creator);
        nft.createEdition(UNIVERSE_ID, EntityEditionNFT.EntityKind.THING, "Sword", contentHash, 0, 0, "ipfs://meta");

        vm.prank(buyer);
        vm.expectRevert(EntityEditionNFT.NotCreatorOrPlatform.selector);
        nft.deactivate(0);
    }

    function test_deactivate_existingTokensSurvive() public {
        vm.prank(creator);
        nft.createEdition(UNIVERSE_ID, EntityEditionNFT.EntityKind.THING, "Sword", contentHash, 0.01 ether, 100, "ipfs://meta");

        vm.prank(buyer);
        nft.mint{value: 0.02 ether}(0, 2);

        vm.prank(creator);
        nft.deactivate(0);

        assertEq(nft.balanceOf(buyer, 0), 2);
    }

    function test_deactivate_oneKeepsOther() public {
        vm.startPrank(creator);
        nft.createEdition(UNIVERSE_ID, EntityEditionNFT.EntityKind.THING, "A", contentHash, 0.01 ether, 10, "ipfs://0");
        nft.createEdition(UNIVERSE_ID, EntityEditionNFT.EntityKind.LORE, "B", contentHash2, 0.01 ether, 10, "ipfs://1");
        nft.deactivate(0);
        vm.stopPrank();

        vm.startPrank(buyer);
        vm.expectRevert(EntityEditionNFT.EditionNotActive.selector);
        nft.mint{value: 0.01 ether}(0, 1);

        // Edition 1 still active
        nft.mint{value: 0.01 ether}(1, 1);
        vm.stopPrank();

        assertEq(nft.balanceOf(buyer, 1), 1);
    }

    // ══════════════════════════════════════════════════════════════
    // ── Royalties (ERC2981) ──
    // ══════════════════════════════════════════════════════════════

    function test_royaltyInfo() public {
        vm.prank(creator);
        nft.createEdition(UNIVERSE_ID, EntityEditionNFT.EntityKind.THING, "Sword", contentHash, 0.1 ether, 100, "ipfs://meta");

        (address receiver, uint256 amount) = nft.royaltyInfo(0, 1 ether);
        assertEq(receiver, creator);
        assertEq(amount, 0.05 ether); // 5% of 1 ETH
    }

    function test_royaltyInfo_differentCreators() public {
        vm.prank(creator);
        nft.createEdition(UNIVERSE_ID, EntityEditionNFT.EntityKind.THING, "A", contentHash, 0, 0, "ipfs://0");

        vm.prank(creator2);
        nft.createEdition(UNIVERSE_ID, EntityEditionNFT.EntityKind.LORE, "B", contentHash2, 0, 0, "ipfs://1");

        (address r0,) = nft.royaltyInfo(0, 1 ether);
        (address r1,) = nft.royaltyInfo(1, 1 ether);

        assertEq(r0, creator);
        assertEq(r1, creator2);
    }

    function test_royaltyInfo_scalesToSalePrice() public {
        vm.prank(creator);
        nft.createEdition(UNIVERSE_ID, EntityEditionNFT.EntityKind.THING, "Sword", contentHash, 0, 0, "ipfs://meta");

        (, uint256 amount10) = nft.royaltyInfo(0, 10 ether);
        (, uint256 amount100) = nft.royaltyInfo(0, 100 ether);

        assertEq(amount10, 0.5 ether);
        assertEq(amount100, 5 ether);
    }

    // ══════════════════════════════════════════════════════════════
    // ── Pause Functionality ──
    // ══════════════════════════════════════════════════════════════

    function test_pause_byPlatform() public {
        vm.prank(platform);
        nft.pause();

        vm.prank(creator);
        vm.expectRevert();
        nft.createEdition(UNIVERSE_ID, EntityEditionNFT.EntityKind.THING, "Sword", contentHash, 0, 0, "ipfs://meta");
    }

    function test_unpause_byPlatform() public {
        vm.prank(platform);
        nft.pause();

        vm.prank(platform);
        nft.unpause();

        vm.prank(creator);
        nft.createEdition(UNIVERSE_ID, EntityEditionNFT.EntityKind.THING, "Sword", contentHash, 0, 0, "ipfs://meta");
    }

    function test_pause_revert_notPlatform() public {
        vm.prank(buyer);
        vm.expectRevert(EntityEditionNFT.NotPlatform.selector);
        nft.pause();
    }

    function test_unpause_revert_notPlatform() public {
        vm.prank(platform);
        nft.pause();

        vm.prank(buyer);
        vm.expectRevert(EntityEditionNFT.NotPlatform.selector);
        nft.unpause();
    }

    function test_pause_blocksMint() public {
        vm.prank(creator);
        nft.createEdition(UNIVERSE_ID, EntityEditionNFT.EntityKind.THING, "Sword", contentHash, 0.01 ether, 100, "ipfs://meta");

        vm.prank(platform);
        nft.pause();

        vm.prank(buyer);
        vm.expectRevert();
        nft.mint{value: 0.01 ether}(0, 1);
    }

    function test_pause_doesNotBlockDeactivate() public {
        vm.prank(creator);
        nft.createEdition(UNIVERSE_ID, EntityEditionNFT.EntityKind.THING, "Sword", contentHash, 0, 0, "ipfs://meta");

        vm.prank(platform);
        nft.pause();

        // deactivate is not guarded by whenNotPaused
        vm.prank(creator);
        nft.deactivate(0);

        (,,,,,,,,bool active) = nft.editions(0);
        assertFalse(active);
    }

    // ══════════════════════════════════════════════════════════════
    // ── Platform Fee Admin ──
    // ══════════════════════════════════════════════════════════════

    function test_setPlatformFee() public {
        vm.prank(platform);
        nft.setPlatformFee(2000);
        assertEq(nft.platformFeeBps(), 2000);
    }

    function test_setPlatformFee_toZero() public {
        vm.prank(platform);
        nft.setPlatformFee(0);
        assertEq(nft.platformFeeBps(), 0);
    }

    function test_setPlatformFee_maxAllowed() public {
        vm.prank(platform);
        nft.setPlatformFee(5000);
        assertEq(nft.platformFeeBps(), 5000);
    }

    function test_setPlatformFee_revert_tooHigh() public {
        vm.prank(platform);
        vm.expectRevert(EntityEditionNFT.FeeTooHigh.selector);
        nft.setPlatformFee(5001);
    }

    function test_setPlatformFee_revert_notPlatform() public {
        vm.prank(buyer);
        vm.expectRevert(EntityEditionNFT.NotPlatform.selector);
        nft.setPlatformFee(2000);
    }

    function test_setPlatformFee_affectsSubsequentMints() public {
        vm.prank(creator);
        nft.createEdition(UNIVERSE_ID, EntityEditionNFT.EntityKind.THING, "Sword", contentHash, 1 ether, 100, "ipfs://meta");

        vm.prank(platform);
        nft.setPlatformFee(2000); // 20%

        vm.prank(buyer);
        nft.mint{value: 1 ether}(0, 1);

        assertEq(treasury.balance, 0.2 ether);
        assertEq(router.claimable(creator), 0.8 ether);
    }

    // ══════════════════════════════════════════════════════════════
    // ── getByUniverse ──
    // ══════════════════════════════════════════════════════════════

    function test_getByUniverse_filtersKind() public {
        vm.startPrank(creator);
        nft.createEdition(UNIVERSE_ID, EntityEditionNFT.EntityKind.THING, "Sword", contentHash, 0, 0, "ipfs://0");
        nft.createEdition(UNIVERSE_ID, EntityEditionNFT.EntityKind.LORE, "Legend", contentHash2, 0, 0, "ipfs://1");
        nft.createEdition(UNIVERSE_ID, EntityEditionNFT.EntityKind.THING, "Shield", contentHash3, 0, 0, "ipfs://2");
        vm.stopPrank();

        uint256[] memory things = nft.getByUniverse(UNIVERSE_ID, EntityEditionNFT.EntityKind.THING, 0, 10);
        assertEq(things.length, 2);
        assertEq(things[0], 0);
        assertEq(things[1], 2);

        uint256[] memory lore = nft.getByUniverse(UNIVERSE_ID, EntityEditionNFT.EntityKind.LORE, 0, 10);
        assertEq(lore.length, 1);
        assertEq(lore[0], 1);
    }

    function test_getByUniverse_pagination() public {
        vm.startPrank(creator);
        nft.createEdition(UNIVERSE_ID, EntityEditionNFT.EntityKind.THING, "A", contentHash, 0, 0, "ipfs://0");
        nft.createEdition(UNIVERSE_ID, EntityEditionNFT.EntityKind.THING, "B", contentHash2, 0, 0, "ipfs://1");
        nft.createEdition(UNIVERSE_ID, EntityEditionNFT.EntityKind.THING, "C", contentHash3, 0, 0, "ipfs://2");
        vm.stopPrank();

        // Get first 2
        uint256[] memory page1 = nft.getByUniverse(UNIVERSE_ID, EntityEditionNFT.EntityKind.THING, 0, 2);
        assertEq(page1.length, 2);
        assertEq(page1[0], 0);
        assertEq(page1[1], 1);

        // Get from id 2 onward
        uint256[] memory page2 = nft.getByUniverse(UNIVERSE_ID, EntityEditionNFT.EntityKind.THING, 2, 10);
        assertEq(page2.length, 1);
        assertEq(page2[0], 2);
    }

    function test_getByUniverse_wrongUniverse() public {
        vm.prank(creator);
        nft.createEdition(UNIVERSE_ID, EntityEditionNFT.EntityKind.THING, "Sword", contentHash, 0, 0, "ipfs://0");

        uint256[] memory result = nft.getByUniverse(999, EntityEditionNFT.EntityKind.THING, 0, 10);
        assertEq(result.length, 0);
    }

    function test_getByUniverse_empty() public view {
        uint256[] memory result = nft.getByUniverse(UNIVERSE_ID, EntityEditionNFT.EntityKind.THING, 0, 10);
        assertEq(result.length, 0);
    }

    // ══════════════════════════════════════════════════════════════
    // ── URI ──
    // ══════════════════════════════════════════════════════════════

    function test_uri() public {
        vm.prank(creator);
        nft.createEdition(UNIVERSE_ID, EntityEditionNFT.EntityKind.THING, "Sword", contentHash, 0, 0, "ipfs://QmTest");
        assertEq(nft.uri(0), "ipfs://QmTest");
    }

    function test_uri_emptyForNonexistent() public view {
        assertEq(nft.uri(999), "");
    }

    // ══════════════════════════════════════════════════════════════
    // ── supportsInterface ──
    // ══════════════════════════════════════════════════════════════

    function test_supportsInterface_ERC1155() public view {
        assertTrue(nft.supportsInterface(0xd9b67a26));
    }

    function test_supportsInterface_ERC2981() public view {
        assertTrue(nft.supportsInterface(0x2a55205a));
    }

    function test_supportsInterface_ERC165() public view {
        assertTrue(nft.supportsInterface(0x01ffc9a7));
    }
}
