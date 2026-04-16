// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/proxy/ERC1967/ERC1967Proxy.sol";
import {UpgradeableBeacon} from "@openzeppelin/proxy/beacon/UpgradeableBeacon.sol";
import {BeaconProxy} from "@openzeppelin/proxy/beacon/BeaconProxy.sol";
import {PaymentRouter} from "../src/PaymentRouter.sol";
import {RightsRegistry} from "../src/RightsRegistry.sol";
import {IRightsRegistry} from "../src/interfaces/IRightsRegistry.sol";
import {EpisodeNFT} from "../src/revenue/EpisodeNFT.sol";

contract EpisodeNFTTest is Test {
    EpisodeNFT public nft;
    PaymentRouter public router;
    RightsRegistry public registry;

    address deployer  = makeAddr("deployer");
    address platform  = makeAddr("platform");
    address treasury  = makeAddr("treasury");
    address creator   = makeAddr("creator");
    address creator2  = makeAddr("creator2");
    address buyer     = makeAddr("buyer");
    address buyer2    = makeAddr("buyer2");

    bytes32 contentHash  = keccak256("episode-content");
    bytes32 contentHash2 = keccak256("episode-content-2");
    bytes32 contentHash3 = keccak256("episode-content-3");

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

        // Deploy EpisodeNFT via Beacon
        EpisodeNFT impl = new EpisodeNFT();
        UpgradeableBeacon beacon = new UpgradeableBeacon(address(impl), deployer);
        nft = EpisodeNFT(address(new BeaconProxy(
            address(beacon),
            abi.encodeCall(EpisodeNFT.initialize, (
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

        // Classify content hashes as ORIGINAL
        vm.startPrank(platform);
        registry.setRights(contentHash, IRightsRegistry.RightsType.ORIGINAL);
        registry.setRights(contentHash2, IRightsRegistry.RightsType.ORIGINAL);
        registry.setRights(contentHash3, IRightsRegistry.RightsType.ORIGINAL);
        vm.stopPrank();
    }

    // ═══════════════════════════════════════════════════════════════════
    //  Initialize
    // ═══════════════════════════════════════════════════════════════════

    function test_initialize() public view {
        assertEq(nft.platform(), platform);
        assertEq(nft.platformFeeBps(), 1000);
        assertEq(nft.defaultRoyaltyBps(), 500);
    }

    function test_initialize_revert_feeTooHigh() public {
        EpisodeNFT impl = new EpisodeNFT();
        UpgradeableBeacon beacon = new UpgradeableBeacon(address(impl), address(this));
        vm.expectRevert(EpisodeNFT.FeeTooHigh.selector);
        new BeaconProxy(
            address(beacon),
            abi.encodeCall(EpisodeNFT.initialize, (platform, address(registry), address(router), 5001, 500))
        );
    }

    function test_initialize_boundary_maxFee() public {
        EpisodeNFT impl = new EpisodeNFT();
        UpgradeableBeacon beacon = new UpgradeableBeacon(address(impl), address(this));
        EpisodeNFT nft2 = EpisodeNFT(address(new BeaconProxy(
            address(beacon),
            abi.encodeCall(EpisodeNFT.initialize, (platform, address(registry), address(router), 5000, 500))
        )));
        assertEq(nft2.platformFeeBps(), 5000);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  Create Episode
    // ═══════════════════════════════════════════════════════════════════

    function test_createEpisode() public {
        vm.prank(creator);
        uint256 epId = nft.createEpisode(1, 10, contentHash, 0.1 ether, 100, "ipfs://meta");

        assertEq(epId, 0);

        (
            uint256 universeId,
            uint256 nodeId,
            bytes32 ch,
            address cr,
            uint256 mintPrice,
            uint256 maxSupply,
            uint256 minted,
            bool active
        ) = nft.episodes(0);

        assertEq(universeId, 1);
        assertEq(nodeId, 10);
        assertEq(ch, contentHash);
        assertEq(cr, creator);
        assertEq(mintPrice, 0.1 ether);
        assertEq(maxSupply, 100);
        assertEq(minted, 0);
        assertTrue(active);
    }

    function test_createEpisode_emitsEvent() public {
        vm.expectEmit(true, false, false, true);
        emit EpisodeNFT.EpisodeCreated(0, 1, 10, creator, 0.1 ether, 100);

        vm.prank(creator);
        nft.createEpisode(1, 10, contentHash, 0.1 ether, 100, "ipfs://meta");
    }

    function test_createEpisode_multipleDifferentCreators() public {
        vm.prank(creator);
        uint256 id1 = nft.createEpisode(1, 10, contentHash, 0.1 ether, 100, "ipfs://meta1");

        vm.prank(creator2);
        uint256 id2 = nft.createEpisode(1, 20, contentHash2, 0.2 ether, 50, "ipfs://meta2");

        assertEq(id1, 0);
        assertEq(id2, 1);

        (,,, address cr1,,,,) = nft.episodes(0);
        (,,, address cr2,,,,) = nft.episodes(1);
        assertEq(cr1, creator);
        assertEq(cr2, creator2);
    }

    function test_createEpisode_openEdition() public {
        vm.prank(creator);
        nft.createEpisode(1, 10, contentHash, 0.01 ether, 0, "ipfs://meta");

        (,,,,, uint256 maxSupply,,) = nft.episodes(0);
        assertEq(maxSupply, 0); // unlimited
    }

    function test_createEpisode_freeEpisode() public {
        vm.prank(creator);
        nft.createEpisode(1, 10, contentHash, 0, 100, "ipfs://meta");

        (,,,, uint256 mintPrice,,,) = nft.episodes(0);
        assertEq(mintPrice, 0);
    }

    function test_createEpisode_revert_funContent() public {
        vm.prank(platform);
        registry.setRights(contentHash, IRightsRegistry.RightsType.FUN);

        vm.prank(creator);
        vm.expectRevert(EpisodeNFT.ContentNotMonetizable.selector);
        nft.createEpisode(1, 10, contentHash, 0.1 ether, 100, "ipfs://meta");
    }

    function test_createEpisode_revert_frozenContent() public {
        vm.prank(platform);
        registry.freeze(contentHash, "DMCA");

        vm.prank(creator);
        vm.expectRevert(EpisodeNFT.ContentNotMonetizable.selector);
        nft.createEpisode(1, 10, contentHash, 0.1 ether, 100, "ipfs://meta");
    }

    function test_createEpisode_revert_unsetContent() public {
        bytes32 unsetHash = keccak256("never-set");
        vm.prank(creator);
        vm.expectRevert(EpisodeNFT.ContentNotMonetizable.selector);
        nft.createEpisode(1, 10, unsetHash, 0.1 ether, 100, "ipfs://meta");
    }

    function test_createEpisode_revert_whenPaused() public {
        vm.prank(platform);
        nft.pause();

        vm.prank(creator);
        vm.expectRevert();
        nft.createEpisode(1, 10, contentHash, 0.1 ether, 100, "ipfs://meta");
    }

    // ═══════════════════════════════════════════════════════════════════
    //  Mint
    // ═══════════════════════════════════════════════════════════════════

    function test_mint() public {
        vm.prank(creator);
        nft.createEpisode(1, 10, contentHash, 0.1 ether, 100, "ipfs://meta");

        vm.prank(buyer);
        uint256 tokenId = nft.mint{value: 0.1 ether}(0, "ipfs://token-meta");

        assertEq(tokenId, 0);
        assertEq(nft.ownerOf(tokenId), buyer);
        assertEq(nft.tokenURI(tokenId), "ipfs://token-meta");
        assertEq(nft.tokenEpisode(tokenId), 0);

        (,,,,,, uint256 minted,) = nft.episodes(0);
        assertEq(minted, 1);
    }

    function test_mint_emitsEvent() public {
        vm.prank(creator);
        nft.createEpisode(1, 10, contentHash, 0.1 ether, 100, "ipfs://meta");

        vm.expectEmit(true, true, false, true);
        emit EpisodeNFT.EpisodeMinted(0, 0, buyer, 0.1 ether);

        vm.prank(buyer);
        nft.mint{value: 0.1 ether}(0, "ipfs://token-meta");
    }

    function test_mint_routesPayment() public {
        vm.prank(creator);
        nft.createEpisode(1, 10, contentHash, 1 ether, 100, "ipfs://meta");

        uint256 treasuryBefore = treasury.balance;
        vm.prank(buyer);
        nft.mint{value: 1 ether}(0, "ipfs://token");

        // 10% to treasury, 90% claimable by creator
        assertEq(treasury.balance - treasuryBefore, 0.1 ether);
        assertEq(router.claimable(creator), 0.9 ether);
    }

    function test_mint_refundsExcess() public {
        vm.prank(creator);
        nft.createEpisode(1, 10, contentHash, 0.1 ether, 100, "ipfs://meta");

        uint256 buyerBefore = buyer.balance;
        vm.prank(buyer);
        nft.mint{value: 1 ether}(0, "ipfs://token");

        // Should refund 0.9 ether
        assertEq(buyer.balance, buyerBefore - 0.1 ether);
    }

    function test_mint_freeEpisode() public {
        vm.prank(creator);
        nft.createEpisode(1, 10, contentHash, 0, 100, "ipfs://meta");

        vm.prank(buyer);
        uint256 tokenId = nft.mint{value: 0}(0, "ipfs://token");

        assertEq(nft.ownerOf(tokenId), buyer);
        assertEq(router.claimable(creator), 0);
        assertEq(treasury.balance, 0);
    }

    function test_mint_freeEpisode_refundsAnyValue() public {
        vm.prank(creator);
        nft.createEpisode(1, 10, contentHash, 0, 100, "ipfs://meta");

        uint256 buyerBefore = buyer.balance;
        vm.prank(buyer);
        nft.mint{value: 1 ether}(0, "ipfs://token");

        // Price is 0, all 1 ether is excess and should be refunded
        assertEq(buyer.balance, buyerBefore);
    }

    function test_mint_multipleMinters() public {
        vm.prank(creator);
        nft.createEpisode(1, 10, contentHash, 0.1 ether, 100, "ipfs://meta");

        vm.prank(buyer);
        uint256 t1 = nft.mint{value: 0.1 ether}(0, "ipfs://t1");

        vm.prank(buyer2);
        uint256 t2 = nft.mint{value: 0.1 ether}(0, "ipfs://t2");

        assertEq(nft.ownerOf(t1), buyer);
        assertEq(nft.ownerOf(t2), buyer2);
        assertEq(t1, 0);
        assertEq(t2, 1);

        (,,,,,, uint256 minted,) = nft.episodes(0);
        assertEq(minted, 2);
    }

    function test_mint_multipleEpisodes() public {
        vm.startPrank(creator);
        nft.createEpisode(1, 10, contentHash, 0.1 ether, 100, "ipfs://ep1");
        nft.createEpisode(1, 20, contentHash2, 0.2 ether, 50, "ipfs://ep2");
        vm.stopPrank();

        vm.prank(buyer);
        uint256 t1 = nft.mint{value: 0.1 ether}(0, "ipfs://t1");

        vm.prank(buyer);
        uint256 t2 = nft.mint{value: 0.2 ether}(1, "ipfs://t2");

        assertEq(nft.tokenEpisode(t1), 0);
        assertEq(nft.tokenEpisode(t2), 1);
    }

    function test_mint_openEdition_unlimited() public {
        vm.prank(creator);
        nft.createEpisode(1, 10, contentHash, 0, 0, "ipfs://meta"); // maxSupply=0 (unlimited)

        vm.startPrank(buyer);
        for (uint256 i = 0; i < 5; i++) {
            nft.mint{value: 0}(0, "ipfs://token");
        }
        vm.stopPrank();

        (,,,,,, uint256 minted,) = nft.episodes(0);
        assertEq(minted, 5);
    }

    function test_mint_revert_inactive() public {
        vm.prank(creator);
        nft.createEpisode(1, 10, contentHash, 0.1 ether, 100, "ipfs://meta");

        vm.prank(creator);
        nft.deactivateEpisode(0);

        vm.prank(buyer);
        vm.expectRevert(EpisodeNFT.EpisodeNotActive.selector);
        nft.mint{value: 0.1 ether}(0, "ipfs://token");
    }

    function test_mint_revert_maxSupplyReached() public {
        vm.prank(creator);
        nft.createEpisode(1, 10, contentHash, 0.01 ether, 2, "ipfs://meta");

        vm.startPrank(buyer);
        nft.mint{value: 0.01 ether}(0, "ipfs://t1");
        nft.mint{value: 0.01 ether}(0, "ipfs://t2");

        vm.expectRevert(EpisodeNFT.MaxSupplyReached.selector);
        nft.mint{value: 0.01 ether}(0, "ipfs://t3");
        vm.stopPrank();
    }

    function test_mint_revert_insufficientPayment() public {
        vm.prank(creator);
        nft.createEpisode(1, 10, contentHash, 1 ether, 100, "ipfs://meta");

        vm.prank(buyer);
        vm.expectRevert(EpisodeNFT.InsufficientPayment.selector);
        nft.mint{value: 0.5 ether}(0, "ipfs://token");
    }

    function test_mint_revert_whenPaused() public {
        vm.prank(creator);
        nft.createEpisode(1, 10, contentHash, 0.1 ether, 100, "ipfs://meta");

        vm.prank(platform);
        nft.pause();

        vm.prank(buyer);
        vm.expectRevert();
        nft.mint{value: 0.1 ether}(0, "ipfs://token");
    }

    // ═══════════════════════════════════════════════════════════════════
    //  ERC2981 Royalty Info
    // ═══════════════════════════════════════════════════════════════════

    function test_royaltyInfo() public {
        vm.prank(creator);
        nft.createEpisode(1, 10, contentHash, 0.1 ether, 100, "ipfs://meta");

        vm.prank(buyer);
        uint256 tokenId = nft.mint{value: 0.1 ether}(0, "ipfs://token");

        (address receiver, uint256 royalty) = nft.royaltyInfo(tokenId, 1 ether);
        assertEq(receiver, creator);
        assertEq(royalty, 0.05 ether); // 500 bps = 5%
    }

    function test_royaltyInfo_differentCreators() public {
        vm.prank(creator);
        nft.createEpisode(1, 10, contentHash, 0.1 ether, 100, "ipfs://meta1");

        vm.prank(creator2);
        nft.createEpisode(1, 20, contentHash2, 0.1 ether, 100, "ipfs://meta2");

        vm.prank(buyer);
        uint256 t1 = nft.mint{value: 0.1 ether}(0, "ipfs://t1");

        vm.prank(buyer);
        uint256 t2 = nft.mint{value: 0.1 ether}(1, "ipfs://t2");

        (address r1,) = nft.royaltyInfo(t1, 1 ether);
        (address r2,) = nft.royaltyInfo(t2, 1 ether);
        assertEq(r1, creator);
        assertEq(r2, creator2);
    }

    function test_supportsInterface_ERC2981() public view {
        assertTrue(nft.supportsInterface(0x2a55205a));
    }

    function test_supportsInterface_ERC721() public view {
        assertTrue(nft.supportsInterface(0x80ac58cd));
    }

    // ═══════════════════════════════════════════════════════════════════
    //  Deactivate
    // ═══════════════════════════════════════════════════════════════════

    function test_deactivateEpisode() public {
        vm.prank(creator);
        uint256 epId = nft.createEpisode(1, 10, contentHash, 0.1 ether, 100, "ipfs://meta");

        vm.expectEmit(true, false, false, false);
        emit EpisodeNFT.EpisodeDeactivated(epId);

        vm.prank(creator);
        nft.deactivateEpisode(epId);

        (,,,,,,, bool active) = nft.episodes(epId);
        assertFalse(active);
    }

    function test_deactivateEpisode_revert_notCreator() public {
        vm.prank(creator);
        uint256 epId = nft.createEpisode(1, 10, contentHash, 0.1 ether, 100, "ipfs://meta");

        vm.prank(buyer);
        vm.expectRevert(EpisodeNFT.NotCreator.selector);
        nft.deactivateEpisode(epId);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  Platform Fee Admin
    // ═══════════════════════════════════════════════════════════════════

    function test_setPlatformFee() public {
        vm.prank(platform);
        nft.setPlatformFee(2000);
        assertEq(nft.platformFeeBps(), 2000);
    }

    function test_setPlatformFee_revert_tooHigh() public {
        vm.prank(platform);
        vm.expectRevert(EpisodeNFT.FeeTooHigh.selector);
        nft.setPlatformFee(5001);
    }

    function test_setPlatformFee_revert_notPlatform() public {
        vm.prank(buyer);
        vm.expectRevert("Not platform");
        nft.setPlatformFee(2000);
    }

    function test_setPlatformFee_zero() public {
        vm.prank(platform);
        nft.setPlatformFee(0);
        assertEq(nft.platformFeeBps(), 0);
    }

    function test_setPlatformFee_boundary_5000() public {
        vm.prank(platform);
        nft.setPlatformFee(5000);
        assertEq(nft.platformFeeBps(), 5000);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  Pause / Unpause
    // ═══════════════════════════════════════════════════════════════════

    function test_pause_onlyPlatform() public {
        vm.prank(buyer);
        vm.expectRevert("Not platform");
        nft.pause();
    }

    function test_unpause_onlyPlatform() public {
        vm.prank(platform);
        nft.pause();

        vm.prank(buyer);
        vm.expectRevert("Not platform");
        nft.unpause();
    }

    function test_pause_unpause_cycle() public {
        vm.startPrank(platform);
        nft.pause();
        nft.unpause();
        vm.stopPrank();

        vm.prank(creator);
        nft.createEpisode(1, 10, contentHash, 0, 100, "ipfs://meta");
    }

    // ═══════════════════════════════════════════════════════════════════
    //  ERC721Enumerable
    // ═══════════════════════════════════════════════════════════════════

    function test_totalSupply() public {
        assertEq(nft.totalSupply(), 0);

        vm.prank(creator);
        nft.createEpisode(1, 10, contentHash, 0, 100, "ipfs://meta");

        vm.prank(buyer);
        nft.mint{value: 0}(0, "ipfs://t1");
        assertEq(nft.totalSupply(), 1);

        vm.prank(buyer2);
        nft.mint{value: 0}(0, "ipfs://t2");
        assertEq(nft.totalSupply(), 2);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  Fuzz
    // ═══════════════════════════════════════════════════════════════════

    function testFuzz_mint_paymentSplit(uint96 price) public {
        vm.assume(price > 0 && price <= 10 ether);

        vm.prank(creator);
        nft.createEpisode(1, 10, contentHash, price, 0, "ipfs://meta");

        vm.deal(buyer, uint256(price) * 2);
        vm.prank(buyer);
        nft.mint{value: price}(0, "ipfs://token");

        uint256 expectedPlatform = (uint256(price) * 1000) / 10_000; // 10% fee
        uint256 expectedCreator = uint256(price) - expectedPlatform;

        assertEq(treasury.balance, expectedPlatform);
        assertEq(router.claimable(creator), expectedCreator);
    }
}
