// SPDX-License-Identifier: MIT
pragma solidity =0.8.30;

import {TimelockController} from "@openzeppelin/governance/TimelockController.sol";
import {Ownable} from "@openzeppelin/access/Ownable.sol";

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
///
///      Access control (TIMELOCK-02): `deployTimelock` and `wireProposer`
///      are restricted to authorized callers (typically
///      `UniverseTokenDeployerV3`). Without this, an attacker could race
///      the legitimate caller: pre-deploy a timelock with their own
///      `governor` via `wireProposer`, causing the legitimate caller's
///      `wireProposer` to revert with `AlreadyWired` — either bricking
///      universe creation or, worse, leaving PROPOSER_ROLE on the
///      attacker's address.
///
///      Min-delay floor (TIMELOCK-03): enforces a non-zero floor on the
///      per-universe timelock delay. Without this a caller (or future
///      UniverseTokenDeployerV3 config) could set `minDelay = 1`, making
///      universe governance effectively instant-execute.
contract TimelockFactory is Ownable {
    /// @notice Default minimum delay between proposal queue and execution.
    ///         Matches GOV-01 / GOV-02 expectations: short enough that
    ///         universe-level governance feels live (24h), long enough to
    ///         react to a malicious proposal.
    ///
    ///         NOTE: per-universe timelock. This is NOT the 48h protocol
    ///         TimelockController from GOV-01 (which owns UUPS proxies and
    ///         is deployed separately via `TransferToMultisig.s.sol`).
    uint256 public constant DEFAULT_MIN_DELAY = 24 hours;

    /// @notice Floor for any caller-specified `minDelay`. Below this the
    ///         per-universe governance loses meaning — an attacker with a
    ///         token majority could queue+execute a treasury drain in
    ///         seconds.
    uint256 public constant MIN_DELAY_FLOOR = 24 hours;

    /// @notice Whitelist of contracts allowed to call `deployTimelock` and
    ///         `wireProposer`. Typically contains only `UniverseTokenDeployerV3`.
    mapping(address => bool) public authorizedCallers;

    /// @notice Tracks every timelock deployed by this factory so
    ///         `wireProposer` can refuse to operate on outside instances.
    mapping(address => bool) public isFactoryTimelock;

    /// @notice Marks timelocks that have already had their proposer wired —
    ///         enforces single-use semantics on `wireProposer`.
    mapping(address => bool) public wired;

    /// @notice Maps universeId → canonical timelock, so indexers and the
    ///         deployer itself can refuse duplicate deployments (TIMELOCK-04).
    mapping(uint256 => address) public timelockByUniverse;

    /// @notice The caller (typically UniverseTokenDeployerV3) that deployed
    ///         each timelock — helps ops/debug without event-replay.
    mapping(address => address) public deployerOf;

    event AuthorizedCallerSet(address indexed caller, bool authorized);
    event TimelockDeployed(
        address indexed timelock,
        uint256 indexed universeId,
        uint256 minDelay,
        address indexed deployer
    );
    event TimelockWired(address indexed timelock, address indexed governor);

    error UnknownTimelock();
    error AlreadyWired();
    error ZeroAddress();
    error NotAuthorized();
    error DelayTooLow();
    error UniverseAlreadyHasTimelock();
    error RoleGrantFailed();
    /// @notice The factory is no longer DEFAULT_ADMIN of the timelock it was asked to wire.
    /// @dev Fires when an external actor somehow acquired admin and revoked the
    ///      factory's role before `wireProposer` — we refuse to pretend the
    ///      renounce succeeded, since `renounceRole` is a no-op if the caller
    ///      does not hold the role (SC-1).
    error FactoryAdminLost();

    constructor(address initialOwner) Ownable(initialOwner) {}

    modifier onlyAuthorized() {
        if (!authorizedCallers[msg.sender]) revert NotAuthorized();
        _;
    }

    /// @notice Authorize (or revoke) a contract to call `deployTimelock` /
    ///         `wireProposer`. Owner-only. Intended to be called once with
    ///         the `UniverseTokenDeployerV3` address at bootstrap, then
    ///         ideally renounced (`renounceOwnership`) once the deployer
    ///         is stable.
    function setAuthorizedCaller(address caller, bool authorized) external onlyOwner {
        if (caller == address(0)) revert ZeroAddress();
        authorizedCallers[caller] = authorized;
        emit AuthorizedCallerSet(caller, authorized);
    }

    /// @notice Deploy a new TimelockController with this factory as admin.
    ///         The caller must follow up with `wireProposer(timelock,
    ///         governor)` after deploying the universe's Governor.
    /// @dev    `minDelay = 0` selects `DEFAULT_MIN_DELAY`. Any non-zero
    ///         `minDelay` must be >= `MIN_DELAY_FLOOR`.
    function deployTimelock(uint256 universeId, uint256 minDelay)
        external
        onlyAuthorized
        returns (address)
    {
        if (timelockByUniverse[universeId] != address(0)) {
            revert UniverseAlreadyHasTimelock();
        }

        uint256 delay = minDelay == 0 ? DEFAULT_MIN_DELAY : minDelay;
        if (delay < MIN_DELAY_FLOOR) revert DelayTooLow();

        address[] memory empty = new address[](0);
        // executors = [address(0)] → permissionless execution after delay,
        // matching standard Governor + Timelock deployments.
        address[] memory executors = new address[](1);
        executors[0] = address(0);

        TimelockController timelock = new TimelockController(delay, empty, executors, address(this));
        address tlAddr = address(timelock);
        isFactoryTimelock[tlAddr] = true;
        timelockByUniverse[universeId] = tlAddr;
        deployerOf[tlAddr] = msg.sender;
        emit TimelockDeployed(tlAddr, universeId, delay, msg.sender);
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
    function wireProposer(address timelock, address governor) external onlyAuthorized {
        if (governor == address(0) || timelock == address(0)) revert ZeroAddress();
        if (!isFactoryTimelock[timelock]) revert UnknownTimelock();
        if (wired[timelock]) revert AlreadyWired();
        wired[timelock] = true;

        TimelockController tl = TimelockController(payable(timelock));
        bytes32 adminRole = tl.DEFAULT_ADMIN_ROLE();
        if (!tl.hasRole(adminRole, address(this))) revert FactoryAdminLost();

        bytes32 proposerRole = tl.PROPOSER_ROLE();
        bytes32 cancellerRole = tl.CANCELLER_ROLE();
        tl.grantRole(proposerRole, governor);
        tl.grantRole(cancellerRole, governor);
        // Post-assert the grants actually stuck — in normal operation this is
        // always true, but an OZ regression or a grief proxy implementation
        // would be silently masked otherwise.
        if (!tl.hasRole(proposerRole, governor) || !tl.hasRole(cancellerRole, governor)) {
            revert RoleGrantFailed();
        }
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
