// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

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

    address deployer = makeAddr("deployer");
    address platform = makeAddr("platform");
    address treasury = makeAddr("treasury");
    address creator = makeAddr("creator");
    address user2 = makeAddr("user2");

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

        // Classify content hashes as ORIGINAL so they pass the monetization check
        vm.startPrank(platform);
        registry.setRights(visualHash, IRightsRegistry.RightsType.ORIGINAL);
        registry.setRights(keccak256("a"), IRightsRegistry.RightsType.ORIGINAL);
        registry.setRights(keccak256("b"), IRightsRegistry.RightsType.ORIGINAL);
        registry.setRights(keccak256("c"), IRightsRegistry.RightsType.ORIGINAL);
        registry.setRights(keccak256("different"), IRightsRegistry.RightsType.ORIGINAL);
        vm.stopPrank();
    }

    // ── Initialize ──

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

    // ── Create Character ──

    function test_createCharacter() public {
        vm.prank(creator);
        uint256 id = nft.createCharacter(1, "Alice", visualHash, "ipfs://alice", 0, 0);

        assertEq(id, 1);
        assertEq(nft.ownerOf(1), creator);
        assertEq(nft.tokenURI(1), "ipfs://alice");

        (uint256 uid, string memory name, bytes32 vh, address cr, uint256 appearances, uint256 royalties) = nft.characters(1);
        assertEq(uid, 1);
        assertEq(name, "Alice");
        assertEq(vh, visualHash);
        assertEq(cr, creator);
        assertEq(appearances, 0);
        assertEq(royalties, 0);
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
        registry.freeze(visualHash, "dispute");

        vm.prank(creator);
        vm.expectRevert(CharacterNFT.ContentNotMonetizable.selector);
        nft.createCharacter(1, "Alice", visualHash, "ipfs://alice", 0, 0);
    }

    // ── Record Appearance ──

    function test_recordAppearance() public {
        vm.prank(creator);
        nft.createCharacter(1, "Alice", visualHash, "ipfs://alice", 0, 0);

        vm.prank(platform);
        nft.recordAppearance{value: 0.1 ether}(1, 42);

        (,,,, uint256 appearances, uint256 royalties) = nft.characters(1);
        assertEq(appearances, 1);
        assertEq(royalties, 0.1 ether);

        // Reward routed through PaymentRouter (0 fee) → all to creator
        assertEq(router.claimable(creator), 0.1 ether);
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

    function test_recordAppearance_revert_notPlatform() public {
        vm.prank(creator);
        nft.createCharacter(1, "Alice", visualHash, "ipfs://alice", 0, 0);

        vm.deal(creator, 1 ether);
        vm.prank(creator);
        vm.expectRevert("Only platform");
        nft.recordAppearance{value: 0.1 ether}(1, 42);
    }

    // ── After transfer, rewards go to new owner ──

    function test_recordAppearance_afterTransfer() public {
        vm.prank(creator);
        uint256 id = nft.createCharacter(1, "Alice", visualHash, "ipfs://alice", 0, 0);

        // Transfer NFT to user2
        vm.prank(creator);
        nft.transferFrom(creator, user2, id);
        assertEq(nft.ownerOf(id), user2);

        // Appearance reward should go to new owner
        vm.prank(platform);
        nft.recordAppearance{value: 0.1 ether}(id, 99);

        assertEq(router.claimable(user2), 0.1 ether);
        assertEq(router.claimable(creator), 0);
    }

    // ── Get characters by universe ──

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
}
