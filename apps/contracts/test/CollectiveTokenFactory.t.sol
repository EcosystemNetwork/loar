// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {CollectiveTokenFactory} from "../src/revenue/CollectiveTokenFactory.sol";
import {CollectiveERC20} from "../src/revenue/CollectiveTokenFactory.sol";
import {IERC20} from "@openzeppelin/interfaces/IERC20.sol";

contract CollectiveTokenFactoryTest is Test {
    CollectiveTokenFactory public factory;

    address creator = makeAddr("creator");

    uint256 constant UNIVERSE_ID = 1;

    function setUp() public {
        factory = new CollectiveTokenFactory();
    }

    // ---- deployCollective (FACTION) ----

    function test_deployCollective_faction() public {
        vm.prank(creator);
        (uint256 collectiveId, address token) = factory.deployCollective(
            UNIVERSE_ID,
            CollectiveTokenFactory.CollectiveKind.FACTION,
            "Shadow Guild",
            "SHGD",
            "ipfs://shadow-guild"
        );

        (
            address storedToken,
            uint256 universeId,
            CollectiveTokenFactory.CollectiveKind kind,
            string memory name,
            address storedCreator
        ) = factory.collectives(collectiveId);

        assertEq(storedToken, token);
        assertEq(universeId, UNIVERSE_ID);
        assertEq(uint8(kind), uint8(CollectiveTokenFactory.CollectiveKind.FACTION));
        assertEq(name, "Shadow Guild");
        assertEq(storedCreator, creator);
    }

    // ---- deployCollective (ORGANIZATION) ----

    function test_deployCollective_organization() public {
        vm.prank(creator);
        (uint256 collectiveId,) = factory.deployCollective(
            UNIVERSE_ID,
            CollectiveTokenFactory.CollectiveKind.ORGANIZATION,
            "Trade Alliance",
            "TRDE",
            "ipfs://trade-alliance"
        );

        (,, CollectiveTokenFactory.CollectiveKind kind,,) = factory.collectives(collectiveId);
        assertEq(uint8(kind), uint8(CollectiveTokenFactory.CollectiveKind.ORGANIZATION));
    }

    // ---- token supply ----

    function test_deployCollective_tokenHasCorrectSupply() public {
        vm.prank(creator);
        (, address token) = factory.deployCollective(
            UNIVERSE_ID,
            CollectiveTokenFactory.CollectiveKind.FACTION,
            "Shadow Guild",
            "SHGD",
            "ipfs://shadow-guild"
        );

        uint256 expectedSupply = 1_000_000_000e18;
        assertEq(IERC20(token).totalSupply(), expectedSupply);
    }

    // ---- creator gets all tokens ----

    function test_deployCollective_creatorGetsAllTokens() public {
        vm.prank(creator);
        (, address token) = factory.deployCollective(
            UNIVERSE_ID,
            CollectiveTokenFactory.CollectiveKind.FACTION,
            "Shadow Guild",
            "SHGD",
            "ipfs://shadow-guild"
        );

        assertEq(IERC20(token).balanceOf(creator), IERC20(token).totalSupply());
    }

    // ---- getUniverseCollectives ----

    function test_getUniverseCollectives() public {
        vm.startPrank(creator);
        (uint256 id1,) = factory.deployCollective(
            UNIVERSE_ID,
            CollectiveTokenFactory.CollectiveKind.FACTION,
            "Guild A",
            "GA",
            "ipfs://a"
        );
        (uint256 id2,) = factory.deployCollective(
            UNIVERSE_ID,
            CollectiveTokenFactory.CollectiveKind.ORGANIZATION,
            "Org B",
            "OB",
            "ipfs://b"
        );
        vm.stopPrank();

        uint256[] memory ids = factory.getUniverseCollectives(UNIVERSE_ID);
        assertEq(ids.length, 2);
        assertEq(ids[0], id1);
        assertEq(ids[1], id2);
    }
}
