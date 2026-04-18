// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/proxy/ERC1967/ERC1967Proxy.sol";
import {PaymentRouter} from "../../src/PaymentRouter.sol";
import {ERC20} from "@openzeppelin/token/ERC20/ERC20.sol";

/// @notice Plain ERC20 used as the $LOAR token for routeLoar invariants.
contract MockLoar is ERC20 {
    constructor(uint256 supply, address to) ERC20("MockLoar", "mLOAR") {
        _mint(to, supply);
    }
}

/// @notice Treasury that always accepts ETH.
contract GoodTreasury {
    receive() external payable {}
}

/// @notice Treasury that rejects all ETH transfers — forces pendingWithdrawals path.
contract RejectingTreasury {
    receive() external payable {
        revert("reject");
    }
}

/// @notice Fuzz handler — performs random route / routeToTreasury / claim / claimLoar
///         ops on the PaymentRouter and tracks ghost variables for invariant checks.
contract PaymentRouterHandler is Test {
    PaymentRouter public router;
    MockLoar public loar;
    GoodTreasury public goodTreasury;

    address[] public actors;

    // Ghost variables for ETH accounting
    uint256 public ghost_totalRouted;        // sum of msg.value across route/routeToTreasury
    uint256 public ghost_totalClaimed;       // sum of ETH pulled via claim/claimPending
    uint256 public ghost_totalRoutedLoar;    // sum of $LOAR amount across routeLoar
    uint256 public ghost_totalClaimedLoar;   // sum of $LOAR pulled via claimLoar

    uint256 public routeCount;
    uint256 public claimCount;

    constructor(PaymentRouter _router, MockLoar _loar, GoodTreasury _treasury) {
        router = _router;
        loar = _loar;
        goodTreasury = _treasury;

        for (uint256 i = 0; i < 5; i++) {
            address actor = makeAddr(string(abi.encodePacked("actor", vm.toString(i))));
            actors.push(actor);
            vm.deal(actor, 100 ether);
            // Seed each actor with mockLOAR so they can call routeLoar
            _loar.transfer(actor, 10_000e18);
        }
    }

    // ── ETH routing ───────────────────────────────────────────────────────

    function route(uint256 actorSeed, uint256 amount, uint16 feeBps) external {
        address actor = actors[actorSeed % actors.length];
        amount = bound(amount, 1 wei, 1 ether);
        feeBps = uint16(bound(uint256(feeBps), 0, 5000));
        address creator = actors[(actorSeed + 1) % actors.length];

        if (actor.balance < amount) vm.deal(actor, actor.balance + amount);

        vm.prank(actor);
        try router.route{value: amount}(creator, feeBps) {
            ghost_totalRouted += amount;
            routeCount++;
        } catch {}
    }

    function routeToTreasury(uint256 actorSeed, uint256 amount) external {
        address actor = actors[actorSeed % actors.length];
        amount = bound(amount, 1 wei, 1 ether);

        if (actor.balance < amount) vm.deal(actor, actor.balance + amount);

        vm.prank(actor);
        try router.routeToTreasury{value: amount}() {
            ghost_totalRouted += amount;
            routeCount++;
        } catch {}
    }

    function claim(uint256 actorSeed) external {
        address actor = actors[actorSeed % actors.length];
        uint256 before = actor.balance;
        vm.prank(actor);
        try router.claim() {
            ghost_totalClaimed += actor.balance - before;
            claimCount++;
        } catch {}
    }

    function claimPending(uint256 actorSeed) external {
        address actor = actors[actorSeed % actors.length];
        uint256 before = actor.balance;
        vm.prank(actor);
        try router.claimPending() {
            ghost_totalClaimed += actor.balance - before;
        } catch {}
    }

    // ── $LOAR routing ─────────────────────────────────────────────────────

    function routeLoar(uint256 actorSeed, uint256 amount, uint16 feeBps) external {
        address actor = actors[actorSeed % actors.length];
        uint256 bal = loar.balanceOf(actor);
        if (bal == 0) return;
        amount = bound(amount, 1, bal);
        feeBps = uint16(bound(uint256(feeBps), 0, 5000));
        address creator = actors[(actorSeed + 1) % actors.length];

        vm.startPrank(actor);
        loar.approve(address(router), amount);
        try router.routeLoar(creator, feeBps, amount) {
            ghost_totalRoutedLoar += amount;
        } catch {}
        vm.stopPrank();
    }

    function claimLoar(uint256 actorSeed) external {
        address actor = actors[actorSeed % actors.length];
        uint256 before = loar.balanceOf(actor);
        vm.prank(actor);
        try router.claimLoar() {
            ghost_totalClaimedLoar += loar.balanceOf(actor) - before;
        } catch {}
    }

    // ── Helpers ───────────────────────────────────────────────────────────

    function actorCount() external view returns (uint256) { return actors.length; }
    function getActor(uint256 i) external view returns (address) { return actors[i % actors.length]; }
}

/// @notice BUILD-04 — invariants for PaymentRouter ETH + $LOAR routing.
///         Ensures pull-pattern accounting cannot diverge from on-contract balances.
contract PaymentRouterInvariantTest is Test {
    PaymentRouter router;
    MockLoar loar;
    GoodTreasury treasury;
    PaymentRouterHandler handler;

    uint256 constant LOAR_SUPPLY = 1_000_000e18;

    function setUp() public {
        treasury = new GoodTreasury();
        loar = new MockLoar(LOAR_SUPPLY, address(this));

        PaymentRouter impl = new PaymentRouter();
        bytes memory initData = abi.encodeWithSelector(
            PaymentRouter.initialize.selector,
            address(treasury),
            uint16(1000),       // 10% default fee
            address(loar),
            uint16(500)          // 5% LOAR discount
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        router = PaymentRouter(payable(address(proxy)));

        handler = new PaymentRouterHandler(router, loar, treasury);

        // Give handler LOAR so it can seed actors
        loar.transfer(address(handler), LOAR_SUPPLY / 2);

        targetContract(address(handler));
    }

    // ── ETH invariant: sum(claimable) + sum(pendingWithdrawals) <= balance ──────
    /// The router's on-chain ETH balance must always be >= the sum of everything
    /// it owes — creator claimable + any stuck pendingWithdrawals.
    function invariant_ethSolvency() public view {
        uint256 count = handler.actorCount();
        uint256 totalClaimable;
        uint256 totalPending;
        for (uint256 i = 0; i < count; i++) {
            address a = handler.getActor(i);
            totalClaimable += router.claimable(a);
            totalPending += router.pendingWithdrawals(a);
        }
        // Treasury may also have pendingWithdrawals if transfers failed
        totalPending += router.pendingWithdrawals(address(treasury));

        assertGe(
            address(router).balance,
            totalClaimable + totalPending,
            "ETH SOLVENCY: router balance < claimable + pending"
        );
    }

    // ── ETH invariant: no creation ─────────────────────────────────────────
    /// Total ETH claimed by anyone must never exceed total ETH ever routed in.
    function invariant_noEthCreation() public view {
        assertLe(
            handler.ghost_totalClaimed(),
            handler.ghost_totalRouted(),
            "ETH CREATION: more claimed than routed"
        );
    }

    // ── LOAR invariant: sum(claimableLoar) <= router LOAR balance ─────────
    /// Every wei of claimableLoar must be backed by actual LOAR held by the router.
    function invariant_loarSolvency() public view {
        uint256 count = handler.actorCount();
        uint256 totalClaimable;
        for (uint256 i = 0; i < count; i++) {
            totalClaimable += router.claimableLoar(handler.getActor(i));
        }
        assertGe(
            loar.balanceOf(address(router)),
            totalClaimable,
            "LOAR SOLVENCY: router LOAR < claimableLoar"
        );
    }

    // ── LOAR invariant: no creation ────────────────────────────────────────
    function invariant_noLoarCreation() public view {
        assertLe(
            handler.ghost_totalClaimedLoar(),
            handler.ghost_totalRoutedLoar(),
            "LOAR CREATION: more claimed than routed"
        );
    }
}

/// @notice Separate suite — exercises the pendingWithdrawals fallback when treasury rejects.
contract PaymentRouterPendingWithdrawalInvariantTest is Test {
    PaymentRouter router;
    MockLoar loar;
    RejectingTreasury treasury;
    PaymentRouterHandler handler;
    GoodTreasury goodTreasury; // handler expects this type, unused here

    uint256 constant LOAR_SUPPLY = 1_000_000e18;

    function setUp() public {
        treasury = new RejectingTreasury();
        goodTreasury = new GoodTreasury();
        loar = new MockLoar(LOAR_SUPPLY, address(this));

        PaymentRouter impl = new PaymentRouter();
        bytes memory initData = abi.encodeWithSelector(
            PaymentRouter.initialize.selector,
            address(treasury),
            uint16(1000),
            address(loar),
            uint16(500)
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        router = PaymentRouter(payable(address(proxy)));

        // Use the good treasury for the handler's reference (handler doesn't depend on it).
        handler = new PaymentRouterHandler(router, loar, goodTreasury);
        loar.transfer(address(handler), LOAR_SUPPLY / 2);
        targetContract(address(handler));
    }

    /// When the treasury rejects transfers, the platform cut must accumulate
    /// in pendingWithdrawals[treasury] and remain fully backed by on-contract ETH.
    function invariant_pendingFallback() public view {
        uint256 count = handler.actorCount();
        uint256 totalClaimable;
        for (uint256 i = 0; i < count; i++) {
            totalClaimable += router.claimable(handler.getActor(i));
        }
        uint256 treasuryPending = router.pendingWithdrawals(address(treasury));

        assertGe(
            address(router).balance,
            totalClaimable + treasuryPending,
            "PENDING FALLBACK: router balance < creator claimable + treasury pending"
        );
    }
}
