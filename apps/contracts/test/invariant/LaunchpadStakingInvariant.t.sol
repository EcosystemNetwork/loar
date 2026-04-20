// SPDX-License-Identifier: MIT
pragma solidity =0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/proxy/ERC1967/ERC1967Proxy.sol";
import {LaunchpadStaking} from "../../src/revenue/LaunchpadStaking.sol";
import {ERC20} from "@openzeppelin/token/ERC20/ERC20.sol";

/// @notice Plain ERC20 used as $LOAR for the staking invariants.
contract MockLoar is ERC20 {
    constructor(uint256 supply, address to) ERC20("MockLoar", "mLOAR") {
        _mint(to, supply);
    }
}

/// @notice Fuzz handler: random stake / unstake / universe-stake / universe-unstake ops.
contract LaunchpadStakingHandler is Test {
    LaunchpadStaking public staking;
    MockLoar public loar;

    address[] public actors;
    uint256[] public universeIds;

    uint256 public stakeCount;
    uint256 public unstakeCount;
    uint256 public universeStakeCount;
    uint256 public universeUnstakeCount;

    constructor(LaunchpadStaking _staking, MockLoar _loar) {
        staking = _staking;
        loar = _loar;

        for (uint256 i = 0; i < 5; i++) {
            address actor = makeAddr(string(abi.encodePacked("staker", vm.toString(i))));
            actors.push(actor);
            _loar.transfer(actor, 1_000_000e18);
        }
        for (uint256 u = 1; u <= 3; u++) {
            universeIds.push(u);
        }
    }

    function stake(uint256 actorSeed, uint256 amount) external {
        address actor = actors[actorSeed % actors.length];
        uint256 bal = loar.balanceOf(actor);
        if (bal == 0) return;
        amount = bound(amount, 1e18, bal);
        vm.startPrank(actor);
        loar.approve(address(staking), amount);
        try staking.stake(amount) {
            stakeCount++;
        }
            catch {}
        vm.stopPrank();
    }

    function unstake(uint256 actorSeed, uint256 fraction) external {
        address actor = actors[actorSeed % actors.length];
        (uint256 staked,,,) = staking.stakes(actor);
        if (staked == 0) return;
        fraction = bound(fraction, 1, 100);
        uint256 amount = (staked * fraction) / 100;
        if (amount == 0) return;
        // Fast-forward past lock period occasionally so unstakes can succeed without penalty edge cases.
        if (fraction % 3 == 0) vm.warp(block.timestamp + 8 days);
        vm.prank(actor);
        try staking.unstake(amount) {
            unstakeCount++;
        }
            catch {}
    }

    function stakeInUniverse(uint256 actorSeed, uint256 universeSeed, uint256 amount) external {
        address actor = actors[actorSeed % actors.length];
        uint256 universeId = universeIds[universeSeed % universeIds.length];
        uint256 bal = loar.balanceOf(actor);
        if (bal == 0) return;
        amount = bound(amount, 1e18, bal);
        vm.startPrank(actor);
        loar.approve(address(staking), amount);
        try staking.stakeInUniverse(universeId, amount) {
            universeStakeCount++;
        }
            catch {}
        vm.stopPrank();
    }

    function unstakeFromUniverse(uint256 actorSeed, uint256 universeSeed, uint256 fraction)
        external
    {
        address actor = actors[actorSeed % actors.length];
        uint256 universeId = universeIds[universeSeed % universeIds.length];
        (uint256 amt,,) = staking.universeStakes(actor, universeId);
        if (amt == 0) return;
        fraction = bound(fraction, 1, 100);
        uint256 amount = (amt * fraction) / 100;
        if (amount == 0) return;
        if (fraction % 3 == 0) vm.warp(block.timestamp + 8 days);
        vm.prank(actor);
        try staking.unstakeFromUniverse(universeId, amount) {
            universeUnstakeCount++;
        }
            catch {}
    }

    function actorCount() external view returns (uint256) {
        return actors.length;
    }

    function getActor(uint256 i) external view returns (address) {
        return actors[i % actors.length];
    }

    function universeCount() external view returns (uint256) {
        return universeIds.length;
    }

    function getUniverse(uint256 i) external view returns (uint256) {
        return universeIds[i % universeIds.length];
    }
}

/// @notice STAKE-02 — invariant tests for LaunchpadStaking dual-pool accounting.
///         Catches accounting drift between global and per-universe staking paths.
contract LaunchpadStakingInvariantTest is Test {
    LaunchpadStaking staking;
    MockLoar loar;
    LaunchpadStakingHandler handler;

    uint256 constant LOAR_SUPPLY = 100_000_000e18;

    function setUp() public {
        loar = new MockLoar(LOAR_SUPPLY, address(this));

        LaunchpadStaking impl = new LaunchpadStaking();
        bytes memory initData = abi.encodeWithSelector(
            LaunchpadStaking.initialize.selector,
            address(loar),
            address(0xBEEF), // treasury
            address(0xCAFE) // LP
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        staking = LaunchpadStaking(address(proxy));

        handler = new LaunchpadStakingHandler(staking, loar);
        loar.transfer(address(handler), LOAR_SUPPLY / 2);
        targetContract(address(handler));
    }

    // ── Invariant: solvency ───────────────────────────────────────────────
    /// The staking contract's on-chain LOAR balance must always be >= totalStaked +
    /// totalUniverseStaked. Drift between the two pools would drain one to pay the other.
    function invariant_solvency() public view {
        assertGe(
            loar.balanceOf(address(staking)),
            staking.totalStaked() + staking.totalUniverseStaked(),
            "SOLVENCY: staking balance < totalStaked + totalUniverseStaked"
        );
    }

    // ── Invariant: per-user global sum matches ─────────────────────────────
    /// Sum of every actor's personal stake must equal totalStaked.
    function invariant_globalSum() public view {
        uint256 sum;
        uint256 n = handler.actorCount();
        for (uint256 i = 0; i < n; i++) {
            (uint256 amt,,,) = staking.stakes(handler.getActor(i));
            sum += amt;
        }
        assertEq(sum, staking.totalStaked(), "GLOBAL SUM: per-actor stake != totalStaked");
    }

    // ── Invariant: per-universe sum matches ────────────────────────────────
    /// For every tracked universe: sum of per-actor stakes == universePool.totalStaked.
    function invariant_universeSum() public view {
        uint256 u = handler.universeCount();
        uint256 a = handler.actorCount();
        for (uint256 i = 0; i < u; i++) {
            uint256 universeId = handler.getUniverse(i);
            (uint256 poolStaked,,) = staking.universePools(universeId);
            uint256 sum;
            for (uint256 j = 0; j < a; j++) {
                (uint256 amt,,) = staking.universeStakes(handler.getActor(j), universeId);
                sum += amt;
            }
            assertEq(sum, poolStaked, "UNIVERSE SUM: per-actor != pool.totalStaked");
        }
    }

    // ── Invariant: universe aggregate consistent ───────────────────────────
    /// Sum of every pool.totalStaked == totalUniverseStaked.
    function invariant_universeAggregate() public view {
        uint256 u = handler.universeCount();
        uint256 sum;
        for (uint256 i = 0; i < u; i++) {
            (uint256 poolStaked,,) = staking.universePools(handler.getUniverse(i));
            sum += poolStaked;
        }
        assertEq(
            sum, staking.totalUniverseStaked(), "UNIVERSE AGG: pool sum != totalUniverseStaked"
        );
    }
}
