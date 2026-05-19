// SPDX-License-Identifier: MIT
pragma solidity =0.8.30;

import {Test} from "forge-std/Test.sol";
import {TimelockFactory} from "../src/factories/TimelockFactory.sol";
import {TimelockController} from "@openzeppelin/governance/TimelockController.sol";

/// @title TimelockFactory tests — TIMELOCK-01..04 audit coverage.
/// @notice Verifies the per-universe timelock factory's single-use wiring,
///         role renouncement, authorization gates, delay floor, and
///         universeId uniqueness.
contract TimelockFactoryTest is Test {
    TimelockFactory factory;

    address owner = address(0xA11CE);
    address authorizedDeployer = address(0xDEFACE);
    address unauthorizedCaller = address(0xBADCAFE);
    address universeGovernor = address(0xC0FFEE);
    address otherGovernor = address(0xFEEDFACE);

    bytes32 PROPOSER_ROLE;
    bytes32 CANCELLER_ROLE;
    bytes32 DEFAULT_ADMIN_ROLE;

    function setUp() public {
        vm.prank(owner);
        factory = new TimelockFactory(owner);

        vm.prank(owner);
        factory.setAuthorizedCaller(authorizedDeployer, true);

        TimelockController probe =
            new TimelockController(24 hours, new address[](0), new address[](0), address(0xdead));
        PROPOSER_ROLE = probe.PROPOSER_ROLE();
        CANCELLER_ROLE = probe.CANCELLER_ROLE();
        DEFAULT_ADMIN_ROLE = probe.DEFAULT_ADMIN_ROLE();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TIMELOCK-01 — wireProposer is single-use, factory renounces admin
    // ─────────────────────────────────────────────────────────────────────────

    function test_wireProposer_singleUse_secondCallReverts() public {
        vm.prank(authorizedDeployer);
        address tl = factory.deployTimelock(1, 0);

        vm.prank(authorizedDeployer);
        factory.wireProposer(tl, universeGovernor);

        assertTrue(factory.wired(tl), "expected wired=true after first call");

        vm.prank(authorizedDeployer);
        vm.expectRevert(TimelockFactory.AlreadyWired.selector);
        factory.wireProposer(tl, otherGovernor);
    }

    function test_wireProposer_renouncesFactoryAdmin() public {
        vm.prank(authorizedDeployer);
        address tl = factory.deployTimelock(2, 0);

        TimelockController controller = TimelockController(payable(tl));
        assertTrue(
            controller.hasRole(DEFAULT_ADMIN_ROLE, address(factory)),
            "factory should hold admin pre-wire"
        );

        vm.prank(authorizedDeployer);
        factory.wireProposer(tl, universeGovernor);

        assertFalse(
            controller.hasRole(DEFAULT_ADMIN_ROLE, address(factory)),
            "factory must NOT hold admin after wireProposer"
        );
    }

    function test_wireProposer_grantsBothRolesToGovernor() public {
        vm.prank(authorizedDeployer);
        address tl = factory.deployTimelock(3, 0);

        vm.prank(authorizedDeployer);
        factory.wireProposer(tl, universeGovernor);

        TimelockController controller = TimelockController(payable(tl));
        assertTrue(
            controller.hasRole(PROPOSER_ROLE, universeGovernor), "governor missing PROPOSER_ROLE"
        );
        assertTrue(
            controller.hasRole(CANCELLER_ROLE, universeGovernor), "governor missing CANCELLER_ROLE"
        );
    }

    function test_wireProposer_postRenounce_governorIsLockedIn() public {
        vm.prank(authorizedDeployer);
        address tl = factory.deployTimelock(4, 0);

        vm.prank(authorizedDeployer);
        factory.wireProposer(tl, universeGovernor);

        TimelockController controller = TimelockController(payable(tl));

        // Factory has no admin → cannot grant roles to anyone else.
        vm.prank(address(factory));
        vm.expectRevert();
        controller.grantRole(PROPOSER_ROLE, otherGovernor);

        // owner() of the factory also has no power over the controller.
        vm.prank(owner);
        vm.expectRevert();
        controller.grantRole(PROPOSER_ROLE, otherGovernor);
    }

    function test_wireProposer_unknownTimelockReverts() public {
        TimelockController stranger =
            new TimelockController(24 hours, new address[](0), new address[](0), address(0xdead));

        vm.prank(authorizedDeployer);
        vm.expectRevert(TimelockFactory.UnknownTimelock.selector);
        factory.wireProposer(address(stranger), universeGovernor);
    }

    function test_wireProposer_zeroAddressReverts() public {
        vm.prank(authorizedDeployer);
        address tl = factory.deployTimelock(5, 0);

        vm.prank(authorizedDeployer);
        vm.expectRevert(TimelockFactory.ZeroAddress.selector);
        factory.wireProposer(tl, address(0));

        vm.prank(authorizedDeployer);
        vm.expectRevert(TimelockFactory.ZeroAddress.selector);
        factory.wireProposer(address(0), universeGovernor);
    }

    /// SC-1 invariant: if the factory has somehow been stripped of
    /// DEFAULT_ADMIN_ROLE on a timelock it deployed (e.g. an attacker who
    /// previously held admin revoked it), `wireProposer` must NOT silently
    /// no-op. `renounceRole` is a no-op when the caller doesn't hold the
    /// role, so without this guard wireProposer could "succeed" while
    /// leaving the timelock unmanaged.
    function test_wireProposer_revertsWhenFactoryAdminLost() public {
        vm.prank(authorizedDeployer);
        address tl = factory.deployTimelock(6, 0);

        // Simulate the malicious-admin-flip: factory renounces its own admin.
        vm.prank(address(factory));
        TimelockController(payable(tl)).renounceRole(DEFAULT_ADMIN_ROLE, address(factory));

        vm.prank(authorizedDeployer);
        vm.expectRevert(TimelockFactory.FactoryAdminLost.selector);
        factory.wireProposer(tl, universeGovernor);

        // Failed wire must leave the slot retryable — `wired[tl]` stays false
        // so a future privileged operator (if admin is somehow re-granted) can
        // still complete the wiring instead of being permanently locked out.
        assertFalse(factory.wired(tl));

        // Verify the governor never received any role on the stripped timelock.
        TimelockController controller = TimelockController(payable(tl));
        assertFalse(
            controller.hasRole(PROPOSER_ROLE, universeGovernor),
            "governor must not hold PROPOSER_ROLE after a failed wire"
        );
        assertFalse(controller.hasRole(CANCELLER_ROLE, universeGovernor));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TIMELOCK-02 — Authorization gates
    // ─────────────────────────────────────────────────────────────────────────

    function test_deployTimelock_unauthorizedReverts() public {
        vm.prank(unauthorizedCaller);
        vm.expectRevert(TimelockFactory.NotAuthorized.selector);
        factory.deployTimelock(10, 0);
    }

    function test_wireProposer_unauthorizedReverts() public {
        vm.prank(authorizedDeployer);
        address tl = factory.deployTimelock(11, 0);

        vm.prank(unauthorizedCaller);
        vm.expectRevert(TimelockFactory.NotAuthorized.selector);
        factory.wireProposer(tl, universeGovernor);
    }

    function test_setAuthorizedCaller_onlyOwner() public {
        vm.prank(unauthorizedCaller);
        vm.expectRevert();
        factory.setAuthorizedCaller(unauthorizedCaller, true);
    }

    function test_setAuthorizedCaller_revoke() public {
        vm.prank(owner);
        factory.setAuthorizedCaller(authorizedDeployer, false);

        vm.prank(authorizedDeployer);
        vm.expectRevert(TimelockFactory.NotAuthorized.selector);
        factory.deployTimelock(12, 0);
    }

    function test_setAuthorizedCaller_zeroAddressReverts() public {
        vm.prank(owner);
        vm.expectRevert(TimelockFactory.ZeroAddress.selector);
        factory.setAuthorizedCaller(address(0), true);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TIMELOCK-03 — Delay floor
    // ─────────────────────────────────────────────────────────────────────────

    function test_deployTimelock_delayBelowFloorReverts() public {
        vm.prank(authorizedDeployer);
        vm.expectRevert(TimelockFactory.DelayTooLow.selector);
        factory.deployTimelock(20, 1);

        vm.prank(authorizedDeployer);
        vm.expectRevert(TimelockFactory.DelayTooLow.selector);
        factory.deployTimelock(21, 24 hours - 1);
    }

    function test_deployTimelock_zeroSelectsDefaultDelay() public {
        vm.prank(authorizedDeployer);
        address tl = factory.deployTimelock(22, 0);

        TimelockController controller = TimelockController(payable(tl));
        assertEq(
            controller.getMinDelay(),
            factory.DEFAULT_MIN_DELAY(),
            "minDelay=0 should select DEFAULT_MIN_DELAY"
        );
    }

    function test_deployTimelock_explicitDelayHonored() public {
        uint256 customDelay = 72 hours;
        vm.prank(authorizedDeployer);
        address tl = factory.deployTimelock(23, customDelay);

        TimelockController controller = TimelockController(payable(tl));
        assertEq(controller.getMinDelay(), customDelay, "explicit minDelay not applied");
    }

    function test_floors_areAuditConstants() public view {
        assertEq(factory.DEFAULT_MIN_DELAY(), 24 hours, "DEFAULT_MIN_DELAY drift");
        assertEq(factory.MIN_DELAY_FLOOR(), 24 hours, "MIN_DELAY_FLOOR drift");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TIMELOCK-04 — universeId uniqueness, deployer tracking
    // ─────────────────────────────────────────────────────────────────────────

    function test_deployTimelock_universeIdUniqueness() public {
        vm.prank(authorizedDeployer);
        address first = factory.deployTimelock(30, 0);

        vm.prank(authorizedDeployer);
        vm.expectRevert(TimelockFactory.UniverseAlreadyHasTimelock.selector);
        factory.deployTimelock(30, 0);

        assertEq(factory.timelockByUniverse(30), first, "canonical timelock should not change");
    }

    function test_deployTimelock_recordsDeployer() public {
        vm.prank(authorizedDeployer);
        address tl = factory.deployTimelock(31, 0);

        assertEq(factory.deployerOf(tl), authorizedDeployer, "deployerOf should record caller");
        assertTrue(factory.isFactoryTimelock(tl), "isFactoryTimelock should be true");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────────────────

    function test_deployTimelock_emitsEventWithDeployer() public {
        // We do not know the deployed timelock address ahead of time, so check
        // only the indexed universeId + deployer + the data field minDelay.
        uint256 defaultMinDelay = factory.DEFAULT_MIN_DELAY();
        vm.prank(authorizedDeployer);
        vm.expectEmit(false, true, true, true);
        emit TimelockFactory.TimelockDeployed(address(0), 40, defaultMinDelay, authorizedDeployer);
        factory.deployTimelock(40, 0);
    }

    function test_wireProposer_emitsEvent() public {
        vm.prank(authorizedDeployer);
        address tl = factory.deployTimelock(41, 0);

        vm.prank(authorizedDeployer);
        vm.expectEmit(true, true, false, true);
        emit TimelockFactory.TimelockWired(tl, universeGovernor);
        factory.wireProposer(tl, universeGovernor);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Ownership lifecycle (post-bootstrap renounce)
    // ─────────────────────────────────────────────────────────────────────────

    function test_renounceOwnership_freezesAuthorizedCallerSet() public {
        vm.prank(owner);
        factory.renounceOwnership();

        // Existing authorized callers still work — only the owner-only mutators
        // are bricked. This is the post-bootstrap steady state.
        vm.prank(authorizedDeployer);
        address tl = factory.deployTimelock(50, 0);
        assertTrue(factory.isFactoryTimelock(tl));

        vm.prank(owner);
        vm.expectRevert();
        factory.setAuthorizedCaller(unauthorizedCaller, true);
    }
}
