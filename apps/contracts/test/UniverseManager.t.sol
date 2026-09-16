// SPDX-License-Identifier: MIT
pragma solidity =0.8.30;

import {Test} from "forge-std/Test.sol";
import {UniverseManager} from "../src/UniverseManager.sol";
import {UniverseFactory} from "../src/factories/UniverseFactory.sol";
import {NodeCreationOptions, NodeVisibilityOptions} from "../src/libraries/NodeOptions.sol";
import {WETH9} from "./tokens/WETH9.sol";
import {IUniverse} from "../src/interfaces/IUniverse.sol";
import {ContentKind, BackupRecord} from "../src/libraries/ContentBackup.sol";

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

    // ── backupRelayer (content-backup relayer, platform-wide) ─────────────

    function test_setBackupRelayer_onlyOwner() public {
        vm.prank(creator); // not the owner
        vm.expectRevert();
        manager.setBackupRelayer(address(0xBEEF));
    }

    function test_setBackupRelayer_updatesAndEmits() public {
        assertEq(manager.backupRelayer(), address(0));

        vm.expectEmit(true, true, true, true);
        emit UniverseManager.BackupRelayerUpdated(address(0), address(0xBEEF));
        manager.setBackupRelayer(address(0xBEEF));

        assertEq(manager.backupRelayer(), address(0xBEEF));
    }

    /// @dev Integration test through the real factory-deployed Universe, not
    ///      a mock — confirms a minted universe's backupContent actually
    ///      reads UniverseManager.backupRelayer() end-to-end, and that
    ///      rotating the relayer on the manager takes effect on every
    ///      already-deployed universe without any per-universe call.
    function test_mintedUniverse_backupContent_respectsManagerRelayer() public {
        uint256 id = _mintUniverse("Universe With Backup");
        (IUniverse universe,,,,,) = manager.getUniverseData(id);

        address relayer = address(0xBEEF);
        BackupRecord memory record =
            BackupRecord({kind: ContentKind.Entity, offChainId: keccak256("entity-1"), contentHash: keccak256("x")});

        // Not yet configured — even an otherwise-legitimate caller is rejected.
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(IUniverse.CallerNotBackupRelayer.selector, relayer));
        universe.backupContent(record, "ipfs://x", "{}");

        manager.setBackupRelayer(relayer);

        vm.prank(relayer);
        bool committed = universe.backupContent(record, "ipfs://x", "{}");
        assertTrue(committed);
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
