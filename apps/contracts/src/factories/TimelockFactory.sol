// SPDX-License-Identifier: MIT
pragma solidity =0.8.30;

import {TimelockController} from "@openzeppelin/governance/TimelockController.sol";

/// @title TimelockFactory
/// @notice Deploys per-universe `TimelockController` instances and wires the
///         spawned governor as the sole proposer/canceller. Replaces the
///         single shared TimelockController previously passed to every
///         per-universe Governor (TIMELOCK-01).
///
/// @dev Two-step flow because TimelockController's PROPOSER_ROLE must be
///      granted to the governor, and the governor address is only known
///      *after* the timelock exists (the governor's constructor takes the
///      timelock address). The factory deploys with itself as admin, then
///      `wireProposer(timelock, governor)` grants the role and renounces
///      admin. After wiring, only the timelock itself can change roles via
///      its own queued proposals.
contract TimelockFactory {
    /// @notice Default minimum delay between proposal queue and execution.
    ///         Matches GOV-01 / GOV-02 expectations: short enough that
    ///         universe-level governance feels live (24h), long enough to
    ///         react to a malicious proposal.
    uint256 public constant DEFAULT_MIN_DELAY = 24 hours;

    /// @notice Tracks every timelock deployed by this factory so
    ///         `wireProposer` can refuse to operate on outside instances.
    mapping(address => bool) public isFactoryTimelock;

    /// @notice Marks timelocks that have already had their proposer wired —
    ///         enforces single-use semantics on `wireProposer`.
    mapping(address => bool) public wired;

    event TimelockDeployed(address indexed timelock, uint256 indexed universeId, uint256 minDelay);
    event TimelockWired(address indexed timelock, address indexed governor);

    error UnknownTimelock();
    error AlreadyWired();
    error ZeroAddress();
    /// @notice The factory is no longer DEFAULT_ADMIN of the timelock it was asked to wire.
    /// @dev Fires when an external actor somehow acquired admin and revoked the
    ///      factory's role before `wireProposer` — we refuse to pretend the
    ///      renounce succeeded, since `renounceRole` is a no-op if the caller
    ///      does not hold the role (SC-1).
    error FactoryAdminLost();

    /// @notice Deploy a new TimelockController with this factory as admin.
    ///         The caller (typically `UniverseTokenDeployerV3`) must follow
    ///         up with `wireProposer(timelock, governor)` after deploying
    ///         the universe's Governor.
    function deployTimelock(uint256 universeId, uint256 minDelay) external returns (address) {
        uint256 delay = minDelay == 0 ? DEFAULT_MIN_DELAY : minDelay;
        address[] memory empty = new address[](0);
        // executors = [address(0)] → permissionless execution after delay,
        // matching standard Governor + Timelock deployments.
        address[] memory executors = new address[](1);
        executors[0] = address(0);

        TimelockController timelock = new TimelockController(delay, empty, executors, address(this));
        address tlAddr = address(timelock);
        isFactoryTimelock[tlAddr] = true;
        emit TimelockDeployed(tlAddr, universeId, delay);
        return tlAddr;
    }

    /// @notice Grant PROPOSER + CANCELLER to the spawned governor and
    ///         renounce admin so future role changes go through the
    ///         timelock's own queued proposals. Single-use per timelock.
    /// @dev SC-1: explicitly assert the factory still holds DEFAULT_ADMIN_ROLE
    ///      before trusting the grants + renounce. `renounceRole` is a no-op
    ///      if the caller doesn't hold the role, so without this check an
    ///      attacker who had somehow acquired admin and stripped the factory
    ///      could watch `wireProposer` succeed-on-paper while leaving the
    ///      timelock under their control.
    function wireProposer(address timelock, address governor) external {
        if (governor == address(0) || timelock == address(0)) revert ZeroAddress();
        if (!isFactoryTimelock[timelock]) revert UnknownTimelock();
        if (wired[timelock]) revert AlreadyWired();
        wired[timelock] = true;

        TimelockController tl = TimelockController(payable(timelock));
        bytes32 adminRole = tl.DEFAULT_ADMIN_ROLE();
        if (!tl.hasRole(adminRole, address(this))) revert FactoryAdminLost();

        tl.grantRole(tl.PROPOSER_ROLE(), governor);
        tl.grantRole(tl.CANCELLER_ROLE(), governor);
        // Renounce admin so this factory has no further power over the
        // per-universe timelock. From this point, only the timelock itself
        // (via queued proposals) can change roles.
        tl.renounceRole(adminRole, address(this));
        // Post-condition: admin must now be empty on this factory. If an
        // external contract re-granted it between grant+renounce, surface it.
        if (tl.hasRole(adminRole, address(this))) revert FactoryAdminLost();

        emit TimelockWired(timelock, governor);
    }
}
