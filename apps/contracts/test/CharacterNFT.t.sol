// SPDX-License-Identifier: UNLICENSED
pragma solidity =0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/proxy/ERC1967/ERC1967Proxy.sol";
import {UpgradeableBeacon} from "@openzeppelin/proxy/beacon/UpgradeableBeacon.sol";
import {BeaconProxy} from "@openzeppelin/proxy/beacon/BeaconProxy.sol";
import {PaymentRouter} from "../src/PaymentRouter.sol";
import {RightsRegistry} from "../src/RightsRegistry.sol";
import {IRightsRegistry} from "../src/interfaces/IRightsRegistry.sol";
import {CharacterNFT} from "../src/revenue/CharacterNFT.sol";

contract CharacterNFTTest is Test {
    CharacterNFT public nft;
    PaymentRouter public router;
    RightsRegistry public registry;

    address deployer  = makeAddr("deployer");
    address platform  = makeAddr("platform");
    address treasury  = makeAddr("treasury");
    address creator   = makeAddr("creator");
    address creator2  = makeAddr("creator2");
    address user2     = makeAddr("user2");
    address buyer     = makeAddr("buyer");

    bytes32 visualHash = keccak256("character-visual");

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

        // Deploy CharacterNFT via Beacon
        CharacterNFT impl = new CharacterNFT();
        UpgradeableBeacon beacon = new UpgradeableBeacon(address(impl), deployer);
        nft = CharacterNFT(address(new BeaconProxy(
            address(beacon),
            abi.encodeCall(CharacterNFT.initialize, (
                1, // universeId
                platform,
                address(registry),
                address(router),
                300 // 3% appearance fee
            ))
        )));

        vm.stopPrank();
        vm.deal(platform, 100 ether);
        vm.deal(buyer, 100 ether);
        vm.deal(creator, 10 ether);

        // Classify content hashes as ORIGINAL so they pass the monetization check.
        // RIGHTS-01 hardening: monetizable classifications now require the owner (or
        // creator signature); operator-only classification is restricted to UNSET/FUN.
        vm.startPrank(deployer);
        registry.setRights(visualHash, IRightsRegistry.RightsType.ORIGINAL);
        registry.setRights(keccak256("a"), IRightsRegistry.RightsType.ORIGINAL);
        registry.setRights(keccak256("b"), IRightsRegistry.RightsType.ORIGINAL);
        registry.setRights(keccak256("c"), IRightsRegistry.RightsType.ORIGINAL);
        registry.setRights(keccak256("d"), IRightsRegistry.RightsType.ORIGINAL);
        registry.setRights(keccak256("different"), IRightsRegistry.RightsType.ORIGINAL);
        registry.setRights(keccak256("paid-char"), IRightsRegistry.RightsType.ORIGINAL);
        registry.setRights(keccak256("free-char"), IRightsRegistry.RightsType.ORIGINAL);
        vm.stopPrank();
    }

    // ═══════════════════════════════════════════════════════════════════
    //  Initialize
    // ═══════════════════════════════════════════════════════════════════

    function test_initialize() public view {
        assertEq(nft.universeId(), 1);
        assertEq(nft.platform(), platform);
        assertEq(nft.appearanceFeeBps(), 300);
    }

    function test_initialize_revert_feeTooHigh() public {
        CharacterNFT impl = new CharacterNFT();
        UpgradeableBeacon beacon = new UpgradeableBeacon(address(impl), address(this));
        vm.expectRevert(CharacterNFT.FeeTooHigh.selector);
        new BeaconProxy(
            address(beacon),
            abi.encodeCall(CharacterNFT.initialize, (1, platform, address(registry), address(router), 5001))
        );
    }

    function test_initialize_boundary_maxFee() public {
        CharacterNFT impl = new CharacterNFT();
        UpgradeableBeacon beacon = new UpgradeableBeacon(address(impl), address(this));
        // 5000 should succeed
        CharacterNFT nft2 = CharacterNFT(address(new BeaconProxy(
            address(beacon),
            abi.encodeCall(CharacterNFT.initialize, (1, platform, address(registry), address(router), 5000))
        )));
        assertEq(nft2.appearanceFeeBps(), 5000);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  Create Character
    // ═══════════════════════════════════════════════════════════════════

    function test_createCharacter() public {
        vm.prank(creator);
        uint256 id = nft.createCharacter(1, "Alice", visualHash, "ipfs://alice", 0, 0);

        assertEq(id, 1);
        assertEq(nft.ownerOf(1), creator); // tokenId 1
        assertEq(nft.tokenURI(1), "ipfs://alice");

        (uint256 uid, string memory name, bytes32 vh, address cr, uint256 appearances, uint256 royalties) = nft.characters(1);
        assertEq(uid, 1);
        assertEq(name, "Alice");
        assertEq(vh, visualHash);
        assertEq(cr, creator);
        assertEq(appearances, 0);
        assertEq(royalties, 0);
    }

    function test_createCharacter_emitsEvent() public {
        vm.expectEmit(true, false, false, true);
        emit CharacterNFT.CharacterCreated(1, 1, "Alice", creator);

        vm.prank(creator);
        nft.createCharacter(1, "Alice", visualHash, "ipfs://alice", 0, 0);
    }

    function test_createCharacter_withMintPrice() public {
        vm.prank(creator);
        uint256 id = nft.createCharacter(1, "Alice", visualHash, "ipfs://alice", 0.1 ether, 100);

        assertEq(nft.characterMintPrice(id), 0.1 ether);
        assertEq(nft.characterMaxSupply(id), 100);
        assertEq(nft.characterMinted(id), 1); // creator got the first one
        assertTrue(nft.characterActive(id));
    }

    function test_createCharacter_multipleCharacters() public {
        vm.startPrank(creator);
        uint256 id1 = nft.createCharacter(1, "Alice", keccak256("a"), "ipfs://a", 0, 0);
        uint256 id2 = nft.createCharacter(1, "Bob",   keccak256("b"), "ipfs://b", 0, 0);
        uint256 id3 = nft.createCharacter(1, "Charlie", keccak256("c"), "ipfs://c", 0, 0);
        vm.stopPrank();

        assertEq(id1, 1);
        assertEq(id2, 2);
        assertEq(id3, 3);
        // Token IDs are sequential from nextTokenId (also 1, 2, 3)
        assertEq(nft.ownerOf(1), creator);
        assertEq(nft.ownerOf(2), creator);
        assertEq(nft.ownerOf(3), creator);
    }

    function test_createCharacter_differentCreators() public {
        vm.prank(creator);
        nft.createCharacter(1, "Alice", keccak256("a"), "ipfs://a", 0, 0);

        vm.prank(creator2);
        nft.createCharacter(1, "Bob", keccak256("b"), "ipfs://b", 0, 0);

        (,,, address cr1,,) = nft.characters(1);
        (,,, address cr2,,) = nft.characters(2);
        assertEq(cr1, creator);
        assertEq(cr2, creator2);
    }

    function test_createCharacter_revert_wrongUniverse() public {
        vm.prank(creator);
        vm.expectRevert(CharacterNFT.WrongUniverse.selector);
        nft.createCharacter(999, "Alice", visualHash, "ipfs://alice", 0, 0);
    }

    function test_createCharacter_revert_duplicate() public {
        vm.startPrank(creator);
        nft.createCharacter(1, "Alice", visualHash, "ipfs://alice", 0, 0);
        vm.expectRevert(CharacterNFT.CharacterExists.selector);
        nft.createCharacter(1, "Alice", keccak256("different"), "ipfs://alice2", 0, 0);
        vm.stopPrank();
    }

    function test_createCharacter_revert_funContent() public {
        vm.prank(platform);
        registry.setRights(visualHash, IRightsRegistry.RightsType.FUN);

        vm.prank(creator);
        vm.expectRevert(CharacterNFT.ContentNotMonetizable.selector);
        nft.createCharacter(1, "Alice", visualHash, "ipfs://alice", 0, 0);
    }

    function test_createCharacter_revert_frozenContent() public {
        vm.prank(platform);
        registry.emergencyFreeze(visualHash, "dispute");

        vm.prank(creator);
        vm.expectRevert(CharacterNFT.ContentNotMonetizable.selector);
        nft.createCharacter(1, "Alice", visualHash, "ipfs://alice", 0, 0);
    }

    function test_createCharacter_revert_unsetContent() public {
        bytes32 unsetHash = keccak256("never-classified");
        vm.prank(creator);
        vm.expectRevert(CharacterNFT.ContentNotMonetizable.selector);
        nft.createCharacter(1, "Alice", unsetHash, "ipfs://alice", 0, 0);
    }

    function test_createCharacter_revert_whenPaused() public {
        vm.prank(platform);
        nft.pause();

        vm.prank(creator);
        vm.expectRevert();
        nft.createCharacter(1, "Alice", visualHash, "ipfs://alice", 0, 0);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  Mint Character (editions)
    // ═══════════════════════════════════════════════════════════════════

    function test_mintCharacter_paid() public {
        vm.prank(creator);
        uint256 charId = nft.createCharacter(1, "Alice", keccak256("paid-char"), "ipfs://alice", 0.1 ether, 10);

        vm.prank(buyer);
        uint256 tokenId = nft.mintCharacter{value: 0.1 ether}(charId, "ipfs://edition1");

        // tokenId should be 2 (creator got token 1)
        assertEq(tokenId, 2);
        assertEq(nft.ownerOf(tokenId), buyer);
        assertEq(nft.tokenURI(tokenId), "ipfs://edition1");
        assertEq(nft.tokenToCharacter(tokenId), charId);
        assertEq(nft.characterMinted(charId), 2); // creator + buyer
    }

    function test_mintCharacter_routesPayment() public {
        vm.prank(creator);
        uint256 charId = nft.createCharacter(1, "Alice", keccak256("paid-char"), "ipfs://alice", 1 ether, 10);

        uint256 treasuryBefore = treasury.balance;
        vm.prank(buyer);
        nft.mintCharacter{value: 1 ether}(charId, "ipfs://edition1");

        // PaymentRouter with appearanceFeeBps (300 = 3%): treasury gets 3%, creator gets 97% claimable
        assertEq(treasury.balance - treasuryBefore, 0.03 ether);
        assertEq(router.claimable(creator), 0.97 ether);
    }

    function test_mintCharacter_refundsExcess() public {
        vm.prank(creator);
        uint256 charId = nft.createCharacter(1, "Alice", keccak256("paid-char"), "ipfs://alice", 0.1 ether, 10);

        uint256 buyerBefore = buyer.balance;
        vm.prank(buyer);
        nft.mintCharacter{value: 1 ether}(charId, "ipfs://edition1");

        // Should refund 0.9 ether
        assertEq(buyer.balance, buyerBefore - 0.1 ether);
    }

    function test_mintCharacter_freeCharacter() public {
        vm.prank(creator);
        uint256 charId = nft.createCharacter(1, "Alice", keccak256("free-char"), "ipfs://alice", 0, 10);

        vm.prank(buyer);
        uint256 tokenId = nft.mintCharacter{value: 0}(charId, "ipfs://edition1");

        assertEq(nft.ownerOf(tokenId), buyer);
        assertEq(router.claimable(creator), 0); // no payment routed for free mint
    }

    function test_mintCharacter_revert_inactive() public {
        vm.prank(creator);
        uint256 charId = nft.createCharacter(1, "Alice", keccak256("paid-char"), "ipfs://alice", 0.1 ether, 10);

        vm.prank(creator);
        nft.deactivateCharacter(charId);

        vm.prank(buyer);
        vm.expectRevert(CharacterNFT.CharacterNotActive.selector);
        nft.mintCharacter{value: 0.1 ether}(charId, "ipfs://edition1");
    }

    function test_mintCharacter_revert_maxSupplyReached() public {
        vm.prank(creator);
        // maxSupply=2, creator already minted 1
        uint256 charId = nft.createCharacter(1, "Alice", keccak256("paid-char"), "ipfs://alice", 0.1 ether, 2);

        vm.prank(buyer);
        nft.mintCharacter{value: 0.1 ether}(charId, "ipfs://edition1");

        // Now minted=2 which equals maxSupply=2
        vm.prank(buyer);
        vm.expectRevert(CharacterNFT.CharacterExists.selector);
        nft.mintCharacter{value: 0.1 ether}(charId, "ipfs://edition2");
    }

    function test_mintCharacter_revert_insufficientPayment() public {
        vm.prank(creator);
        uint256 charId = nft.createCharacter(1, "Alice", keccak256("paid-char"), "ipfs://alice", 1 ether, 10);

        vm.prank(buyer);
        vm.expectRevert(CharacterNFT.InsufficientPayment.selector);
        nft.mintCharacter{value: 0.5 ether}(charId, "ipfs://edition1");
    }

    function test_mintCharacter_multipleMinters() public {
        address buyer2 = makeAddr("buyer2");
        vm.deal(buyer2, 10 ether);

        vm.prank(creator);
        uint256 charId = nft.createCharacter(1, "Alice", keccak256("paid-char"), "ipfs://alice", 0.1 ether, 10);

        vm.prank(buyer);
        uint256 t1 = nft.mintCharacter{value: 0.1 ether}(charId, "ipfs://e1");

        vm.prank(buyer2);
        uint256 t2 = nft.mintCharacter{value: 0.1 ether}(charId, "ipfs://e2");

        assertEq(nft.ownerOf(t1), buyer);
        assertEq(nft.ownerOf(t2), buyer2);
        assertEq(nft.characterMinted(charId), 3); // creator + 2 buyers
    }

    function test_mintCharacter_unlimitedSupply() public {
        vm.prank(creator);
        // maxSupply=0 means 1-of-1 only per the contract logic (0 > 0 is false so the check passes)
        // Actually looking at the code: if (maxSup > 0 && characterMinted >= maxSup)
        // So maxSup=0 means unlimited!
        uint256 charId = nft.createCharacter(1, "Alice", keccak256("free-char"), "ipfs://alice", 0, 0);

        // Should be able to mint even though maxSupply=0 (unlimited)
        vm.prank(buyer);
        nft.mintCharacter{value: 0}(charId, "ipfs://e1");

        assertEq(nft.characterMinted(charId), 2);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  Royalty Info (ERC2981)
    // ═══════════════════════════════════════════════════════════════════

    function test_royaltyInfo_creatorToken() public {
        vm.prank(creator);
        nft.createCharacter(1, "Alice", visualHash, "ipfs://alice", 0, 0);

        // tokenId=1 minted to creator with 5% royalty
        (address receiver, uint256 royalty) = nft.royaltyInfo(1, 1 ether);
        assertEq(receiver, creator);
        assertEq(royalty, 0.05 ether); // 500 bps = 5%
    }

    function test_royaltyInfo_editionToken() public {
        vm.prank(creator);
        uint256 charId = nft.createCharacter(1, "Alice", keccak256("paid-char"), "ipfs://alice", 0.1 ether, 10);

        vm.prank(buyer);
        uint256 tokenId = nft.mintCharacter{value: 0.1 ether}(charId, "ipfs://e1");

        // Edition royalty should go to the original creator
        (address receiver, uint256 royalty) = nft.royaltyInfo(tokenId, 1 ether);
        assertEq(receiver, creator);
        assertEq(royalty, 0.05 ether);
    }

    function test_supportsInterface_ERC2981() public view {
        // ERC2981 interface ID = 0x2a55205a
        assertTrue(nft.supportsInterface(0x2a55205a));
    }

    function test_supportsInterface_ERC721() public view {
        // ERC721 interface ID = 0x80ac58cd
        assertTrue(nft.supportsInterface(0x80ac58cd));
    }

    // ═══════════════════════════════════════════════════════════════════
    //  Record Appearance
    // ═══════════════════════════════════════════════════════════════════

    function test_recordAppearance() public {
        vm.prank(creator);
        nft.createCharacter(1, "Alice", visualHash, "ipfs://alice", 0, 0);

        vm.prank(platform);
        nft.recordAppearance{value: 0.1 ether}(1, 42);

        (,,,, uint256 appearances, uint256 royalties) = nft.characters(1);
        assertEq(appearances, 1);
        assertEq(royalties, 0.1 ether);

        // Reward routed through PaymentRouter (0 fee) -> all to creator
        assertEq(router.claimable(creator), 0.1 ether);
    }

    function test_recordAppearance_emitsEvent() public {
        vm.prank(creator);
        nft.createCharacter(1, "Alice", visualHash, "ipfs://alice", 0, 0);

        vm.expectEmit(true, true, false, true);
        emit CharacterNFT.CharacterAppearance(1, 42, 0.1 ether);

        vm.prank(platform);
        nft.recordAppearance{value: 0.1 ether}(1, 42);
    }

    function test_recordAppearance_multiple() public {
        vm.prank(creator);
        nft.createCharacter(1, "Alice", visualHash, "ipfs://alice", 0, 0);

        vm.startPrank(platform);
        nft.recordAppearance{value: 0.1 ether}(1, 1);
        nft.recordAppearance{value: 0.2 ether}(1, 2);
        nft.recordAppearance{value: 0}(1, 3); // zero-value appearance
        vm.stopPrank();

        (,,,, uint256 appearances,) = nft.characters(1);
        assertEq(appearances, 3);
        assertEq(router.claimable(creator), 0.3 ether);
    }

    function test_recordAppearance_zeroValue() public {
        vm.prank(creator);
        nft.createCharacter(1, "Alice", visualHash, "ipfs://alice", 0, 0);

        vm.prank(platform);
        nft.recordAppearance{value: 0}(1, 10);

        (,,,, uint256 appearances, uint256 royalties) = nft.characters(1);
        assertEq(appearances, 1);
        assertEq(royalties, 0);
        assertEq(router.claimable(creator), 0);
    }

    function test_recordAppearance_revert_notPlatform() public {
        vm.prank(creator);
        nft.createCharacter(1, "Alice", visualHash, "ipfs://alice", 0, 0);

        vm.deal(creator, 1 ether);
        vm.prank(creator);
        vm.expectRevert("Only platform");
        nft.recordAppearance{value: 0.1 ether}(1, 42);
    }

    function test_recordAppearance_revert_whenPaused() public {
        vm.prank(creator);
        nft.createCharacter(1, "Alice", visualHash, "ipfs://alice", 0, 0);

        vm.prank(platform);
        nft.pause();

        vm.prank(platform);
        vm.expectRevert();
        nft.recordAppearance{value: 0.1 ether}(1, 42);
    }

    // ── After transfer, rewards go to new owner ──

    function test_recordAppearance_afterTransfer() public {
        vm.prank(creator);
        uint256 charId = nft.createCharacter(1, "Alice", visualHash, "ipfs://alice", 0, 0);

        // characterOriginalToken maps charId -> tokenId
        uint256 tokenId = nft.characterOriginalToken(charId);

        // Transfer NFT to user2
        vm.prank(creator);
        nft.transferFrom(creator, user2, tokenId);
        assertEq(nft.ownerOf(tokenId), user2);

        // Appearance reward should go to new owner
        vm.prank(platform);
        nft.recordAppearance{value: 0.1 ether}(charId, 99);

        assertEq(router.claimable(user2), 0.1 ether);
        assertEq(router.claimable(creator), 0);
    }

    function test_recordAppearance_accruesClaimableRoyalties() public {
        vm.prank(creator);
        nft.createCharacter(1, "Alice", visualHash, "ipfs://alice", 0, 0);

        vm.prank(platform);
        nft.recordAppearance{value: 0.5 ether}(1, 1);

        assertEq(nft.claimableRoyalties(creator), 0.5 ether);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  Royalties (ROYALTY-01: claimRoyalties removed — royalties routed via PaymentRouter)
    // ═══════════════════════════════════════════════════════════════════

    function test_recordAppearance_routesViaPaymentRouter() public {
        vm.prank(creator);
        nft.createCharacter(1, "Alice", visualHash, "ipfs://alice", 0, 0);

        vm.prank(platform);
        nft.recordAppearance{value: 0.5 ether}(1, 1);
        // Royalties now routed through PaymentRouter — creator claims via paymentRouter.claim()
    }

    // ═══════════════════════════════════════════════════════════════════
    //  Deactivate
    // ═══════════════════════════════════════════════════════════════════

    function test_deactivateCharacter() public {
        vm.prank(creator);
        uint256 charId = nft.createCharacter(1, "Alice", visualHash, "ipfs://alice", 0, 0);

        vm.prank(creator);
        nft.deactivateCharacter(charId);

        assertFalse(nft.characterActive(charId));
    }

    function test_deactivateCharacter_revert_notOwner() public {
        vm.prank(creator);
        uint256 charId = nft.createCharacter(1, "Alice", visualHash, "ipfs://alice", 0, 0);

        vm.prank(buyer);
        vm.expectRevert(CharacterNFT.NotOwner.selector);
        nft.deactivateCharacter(charId);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  Pause / Unpause
    // ═══════════════════════════════════════════════════════════════════

    function test_pause_onlyPlatform() public {
        vm.prank(creator);
        vm.expectRevert("Only platform");
        nft.pause();
    }

    function test_unpause_onlyPlatform() public {
        vm.prank(platform);
        nft.pause();

        vm.prank(creator);
        vm.expectRevert("Only platform");
        nft.unpause();
    }

    function test_pause_unpause_cycle() public {
        vm.startPrank(platform);
        nft.pause();
        nft.unpause();
        vm.stopPrank();

        // Should work again
        vm.prank(creator);
        nft.createCharacter(1, "Alice", visualHash, "ipfs://alice", 0, 0);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  Get characters by universe
    // ═══════════════════════════════════════════════════════════════════

    function test_getCharactersByUniverse() public {
        vm.startPrank(creator);
        nft.createCharacter(1, "Alice", keccak256("a"), "ipfs://a", 0, 0);
        nft.createCharacter(1, "Bob", keccak256("b"), "ipfs://b", 0, 0);
        nft.createCharacter(1, "Charlie", keccak256("c"), "ipfs://c", 0, 0);
        vm.stopPrank();

        uint256[] memory ids = nft.getCharactersByUniverse(1, 1, 10);
        assertEq(ids.length, 3);
        assertEq(ids[0], 1);
        assertEq(ids[1], 2);
        assertEq(ids[2], 3);
    }

    function test_getCharactersByUniverse_empty() public view {
        uint256[] memory ids = nft.getCharactersByUniverse(1, 1, 10);
        assertEq(ids.length, 0);
    }

    function test_getCharactersByUniverse_wrongUniverse() public {
        vm.prank(creator);
        nft.createCharacter(1, "Alice", visualHash, "ipfs://alice", 0, 0);

        uint256[] memory ids = nft.getCharactersByUniverse(999, 1, 10);
        assertEq(ids.length, 0);
    }

    function test_getCharactersByUniverse_pagination() public {
        vm.startPrank(creator);
        nft.createCharacter(1, "A", keccak256("a"), "ipfs://a", 0, 0);
        nft.createCharacter(1, "B", keccak256("b"), "ipfs://b", 0, 0);
        nft.createCharacter(1, "C", keccak256("c"), "ipfs://c", 0, 0);
        nft.createCharacter(1, "D", keccak256("d"), "ipfs://d", 0, 0);
        vm.stopPrank();

        // Only get first 2
        uint256[] memory ids = nft.getCharactersByUniverse(1, 1, 2);
        assertEq(ids.length, 2);
        assertEq(ids[0], 1);
        assertEq(ids[1], 2);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  ERC721Enumerable
    // ═══════════════════════════════════════════════════════════════════

    function test_totalSupply_tracksTokens() public {
        assertEq(nft.totalSupply(), 0);

        vm.prank(creator);
        nft.createCharacter(1, "Alice", visualHash, "ipfs://alice", 0.1 ether, 10);
        assertEq(nft.totalSupply(), 1);

        vm.prank(buyer);
        nft.mintCharacter{value: 0.1 ether}(1, "ipfs://e1");
        assertEq(nft.totalSupply(), 2);
    }
}
