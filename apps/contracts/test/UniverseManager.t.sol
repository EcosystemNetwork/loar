// SPDX-License-Identifier: MIT
pragma solidity =0.8.30;

import {Test} from "forge-std/Test.sol";
import {UniverseManager} from "../src/UniverseManager.sol";
import {UniverseFactory} from "../src/factories/UniverseFactory.sol";
import {NodeCreationOptions, NodeVisibilityOptions} from "../src/libraries/NodeOptions.sol";
import {WETH9} from "./tokens/WETH9.sol";

/// @dev Regression coverage for the UniverseManager._toString() infinite-loop bug.
///      `_toString` backs the tokenURI() fallback that fires whenever
///      `metadataRenderer` is unset (e.g. right after deploy) or the external
///      renderer call fails — exactly the path meant to guarantee tokenURI()
///      never permanently reverts. Before the fix, `while (temp != 0) digits++;`
///      never advanced `temp`, so calling tokenURI() on any nonzero token id
///      spun until out-of-gas.
contract UniverseManagerTest is Test {
    UniverseManager public manager;
    UniverseFactory public factory;
    WETH9 public weth;

    address public teamFeeRecipient = address(0xFEE);
    address public creator = address(0xC12EA70A);

    function setUp() public {
        weth = new WETH9();
        manager = new UniverseManager(teamFeeRecipient, address(weth));
        factory = new UniverseFactory(address(manager));
        manager.setUniverseFactory(address(factory));
    }

    function _mintUniverse(string memory name) internal returns (uint256 id) {
        vm.deal(creator, 1 ether);
        vm.prank(creator);
        (id,) = manager.createUniverse{value: manager.mintFee()}(
            name,
            "image.url",
            "description",
            NodeCreationOptions.PUBLIC,
            NodeVisibilityOptions.PUBLIC,
            creator
        );
    }

    /// @dev tokenId 0 short-circuits `_toString` via `if (value == 0) return "0";`
    ///      and never exercised the buggy loop — assert the real regression
    ///      case: a nonzero id with no metadataRenderer configured.
    function test_tokenURI_fallback_nonzeroId_doesNotHang() public {
        _mintUniverse("Universe Zero"); // id 0 — not the regression case
        uint256 id = _mintUniverse("Universe One"); // id 1
        assertEq(id, 1);

        // No metadataRenderer set — forces the _toString fallback path.
        assertEq(manager.metadataRenderer(), address(0));

        string memory uri = manager.tokenURI(id);
        assertTrue(bytes(uri).length > 0);

        // Sanity: the decimal "1" must appear in the fallback JSON's token id.
        assertTrue(_contains(uri, "#1"));
    }

    /// @dev Broader sweep so the fix isn't just verified at a single value.
    function test_tokenURI_fallback_manyIds_doesNotHang() public {
        for (uint256 i = 0; i < 12; i++) {
            _mintUniverse(string(abi.encodePacked("Universe ", vm.toString(i))));
        }
        for (uint256 i = 0; i < 12; i++) {
            string memory uri = manager.tokenURI(i);
            assertTrue(bytes(uri).length > 0);
        }
    }

    function _contains(string memory haystack, string memory needle) internal pure returns (bool) {
        bytes memory h = bytes(haystack);
        bytes memory n = bytes(needle);
        if (n.length == 0 || h.length < n.length) return false;
        for (uint256 i = 0; i <= h.length - n.length; i++) {
            bool matched = true;
            for (uint256 j = 0; j < n.length; j++) {
                if (h[i + j] != n[j]) {
                    matched = false;
                    break;
                }
            }
            if (matched) return true;
        }
        return false;
    }
}
