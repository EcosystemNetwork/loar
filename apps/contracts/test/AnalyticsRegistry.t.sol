// SPDX-License-Identifier: MIT
pragma solidity =0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/proxy/ERC1967/ERC1967Proxy.sol";
import {AnalyticsRegistry} from "../src/revenue/AnalyticsRegistry.sol";

contract AnalyticsRegistryTest is Test {
    AnalyticsRegistry public analytics;

    address platform = makeAddr("platform");
    address alice = makeAddr("alice");

    uint256 constant UNIVERSE_ID = 1;
    uint256 constant EPISODE_ID = 42;
    uint256 constant CHARACTER_ID = 7;

    function setUp() public {
        AnalyticsRegistry impl = new AnalyticsRegistry();
        analytics = AnalyticsRegistry(
            address(
                new ERC1967Proxy(
                    address(impl),
                    abi.encodeCall(AnalyticsRegistry.initialize, (platform))
                )
            )
        );
    }

    // ---- initialize ----

    function test_initialize() public view {
        assertEq(analytics.platform(), platform);
    }

    // ---- recordView ----

    function test_recordView() public {
        vm.prank(platform);
        analytics.recordView(UNIVERSE_ID, EPISODE_ID);

        (uint256 views,,,) = analytics.episodeMetrics(UNIVERSE_ID, EPISODE_ID);
        assertEq(views, 1);

        (uint256 totalViews,,,,,) = analytics.universeMetrics(UNIVERSE_ID);
        assertEq(totalViews, 1);
    }

    function test_recordView_revert_notPlatform() public {
        vm.prank(alice);
        vm.expectRevert(AnalyticsRegistry.NotPlatform.selector);
        analytics.recordView(UNIVERSE_ID, EPISODE_ID);
    }

    // ---- recordMint ----

    function test_recordMint() public {
        vm.prank(platform);
        analytics.recordMint(UNIVERSE_ID, EPISODE_ID);

        (, uint256 mints,,) = analytics.episodeMetrics(UNIVERSE_ID, EPISODE_ID);
        assertEq(mints, 1);

        (, uint256 totalMints,,,,) = analytics.universeMetrics(UNIVERSE_ID);
        assertEq(totalMints, 1);
    }

    // ---- recordEngagement ----

    function test_recordEngagement_like() public {
        vm.prank(platform);
        analytics.recordEngagement(UNIVERSE_ID, EPISODE_ID, true);

        (,, uint256 likes,) = analytics.episodeMetrics(UNIVERSE_ID, EPISODE_ID);
        assertEq(likes, 1);
    }

    function test_recordEngagement_share() public {
        vm.prank(platform);
        analytics.recordEngagement(UNIVERSE_ID, EPISODE_ID, false);

        (,,, uint256 shares) = analytics.episodeMetrics(UNIVERSE_ID, EPISODE_ID);
        assertEq(shares, 1);
    }

    // ---- updateCharacterPopularity ----

    function test_updateCharacterPopularity() public {
        vm.prank(platform);
        analytics.updateCharacterPopularity(UNIVERSE_ID, CHARACTER_ID, 5, 10);

        (uint256 appearances, uint256 votes, uint256 popularity) =
            analytics.characterMetrics(UNIVERSE_ID, CHARACTER_ID);

        assertEq(appearances, 5);
        assertEq(votes, 10);
        // popularity = appearances * 3 + votes * 2 = 15 + 20 = 35
        assertEq(popularity, 35);
    }

    // ---- setTrending ----

    function test_setTrending() public {
        uint256[] memory ids = new uint256[](3);
        ids[0] = 1;
        ids[1] = 2;
        ids[2] = 3;

        vm.prank(platform);
        analytics.setTrending(ids);

        uint256[] memory trending = analytics.getTrending();
        assertEq(trending.length, 3);
        assertEq(trending[0], 1);
        assertEq(trending[1], 2);
        assertEq(trending[2], 3);
    }

    // ---- requestDataExport ----

    function test_requestDataExport() public {
        // Anyone can call this — just emits an event
        vm.prank(alice);
        analytics.requestDataExport(UNIVERSE_ID);
        // No revert = success; event emission tested implicitly
    }
}
