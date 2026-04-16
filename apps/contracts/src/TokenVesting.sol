// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title TokenVesting
/// @notice Linear vesting with cliff for creator token allocations in the LOAR ecosystem.
/// @dev Supports multiple concurrent vesting schedules (one per token launch).
///      The contract owner (e.g. UniverseManager) can create and revoke vestings.
contract TokenVesting is Ownable {
    using SafeERC20 for IERC20;

    // ──────────────────────────────────────────────────────────────────────
    // Types
    // ──────────────────────────────────────────────────────────────────────

    struct VestingSchedule {
        /// @notice The ERC20 token being vested.
        address token;
        /// @notice The beneficiary (creator) who can claim vested tokens.
        address beneficiary;
        /// @notice Total amount of tokens allocated to this vesting.
        uint128 totalAmount;
        /// @notice Cumulative amount of tokens already claimed.
        uint128 claimed;
        /// @notice Timestamp when the vesting was created.
        uint64 start;
        /// @notice Duration of the cliff period in seconds (no tokens vest during cliff).
        uint64 cliffDuration;
        /// @notice Duration of the linear vesting period in seconds (after cliff).
        uint64 vestingDuration;
        /// @notice Whether this vesting has been revoked by admin.
        bool revoked;
        /// @notice Amount vested at the time of revocation (caps further vesting).
        uint128 vestedAtRevoke;
    }

    // ──────────────────────────────────────────────────────────────────────
    // State
    // ──────────────────────────────────────────────────────────────────────

    /// @notice Monotonically increasing vesting ID counter.
    uint256 public nextVestingId;

    /// @notice All vesting schedules by ID.
    mapping(uint256 => VestingSchedule) public vestings;

    /// @notice Vesting IDs belonging to a beneficiary.
    mapping(address => uint256[]) public beneficiaryVestings;

    // ──────────────────────────────────────────────────────────────────────
    // Errors
    // ──────────────────────────────────────────────────────────────────────

    error ZeroAddress();
    error ZeroAmount();
    error ZeroVestingDuration();
    error VestingNotFound();
    error VestingAlreadyRevoked();
    error NothingToClaim();
    error NotBeneficiary();
    error CliffExceedsVesting();

    // ──────────────────────────────────────────────────────────────────────
    // Events
    // ──────────────────────────────────────────────────────────────────────

    event VestingCreated(
        uint256 indexed vestingId,
        address indexed token,
        address indexed beneficiary,
        uint128 totalAmount,
        uint64 start,
        uint64 cliffDuration,
        uint64 vestingDuration
    );

    event TokensClaimed(
        uint256 indexed vestingId,
        address indexed beneficiary,
        uint128 amount
    );

    event VestingRevoked(
        uint256 indexed vestingId,
        uint128 unvestedAmountReturned
    );

    // ──────────────────────────────────────────────────────────────────────
    // Constructor
    // ──────────────────────────────────────────────────────────────────────

    /// @param _owner The admin address (typically UniverseManager or deployer).
    constructor(address _owner) Ownable(_owner) {}

    // ──────────────────────────────────────────────────────────────────────
    // Admin functions
    // ──────────────────────────────────────────────────────────────────────

    /// @notice Create a new vesting schedule for a creator.
    /// @dev Caller must have already transferred `totalAmount` of `token` to this contract
    ///      (or use safeTransferFrom within the same transaction).
    /// @param token           The ERC20 token to vest.
    /// @param beneficiary     The creator who will receive vested tokens.
    /// @param totalAmount     Total tokens to vest.
    /// @param cliffDuration   Duration of the cliff in seconds (e.g. 30 days = 2592000).
    /// @param vestingDuration Duration of linear vesting after cliff in seconds (e.g. 180 days = 15552000).
    /// @return vestingId      The unique ID of the created vesting schedule.
    function createVesting(
        address token,
        address beneficiary,
        uint128 totalAmount,
        uint64 cliffDuration,
        uint64 vestingDuration
    ) external onlyOwner returns (uint256 vestingId) {
        if (token == address(0)) revert ZeroAddress();
        if (beneficiary == address(0)) revert ZeroAddress();
        if (totalAmount == 0) revert ZeroAmount();
        if (vestingDuration == 0) revert ZeroVestingDuration();
        if (cliffDuration > vestingDuration) revert CliffExceedsVesting();

        // Transfer tokens from caller to this contract
        IERC20(token).safeTransferFrom(msg.sender, address(this), totalAmount);

        vestingId = nextVestingId++;

        vestings[vestingId] = VestingSchedule({
            token: token,
            beneficiary: beneficiary,
            totalAmount: totalAmount,
            claimed: 0,
            start: uint64(block.timestamp),
            cliffDuration: cliffDuration,
            vestingDuration: vestingDuration,
            revoked: false,
            vestedAtRevoke: 0
        });

        beneficiaryVestings[beneficiary].push(vestingId);

        emit VestingCreated(
            vestingId,
            token,
            beneficiary,
            totalAmount,
            uint64(block.timestamp),
            cliffDuration,
            vestingDuration
        );
    }

    /// @notice Revoke a vesting schedule, returning unvested tokens to admin.
    /// @dev Already-vested (but unclaimed) tokens remain claimable by the beneficiary.
    /// @param vestingId The vesting schedule to revoke.
    function revokeVesting(uint256 vestingId) external onlyOwner {
        VestingSchedule storage v = vestings[vestingId];
        if (v.totalAmount == 0) revert VestingNotFound();
        if (v.revoked) revert VestingAlreadyRevoked();

        v.revoked = true;

        uint128 vested = _vestedAmount(v);
        v.vestedAtRevoke = vested;
        uint128 unvested = v.totalAmount - vested;

        if (unvested > 0) {
            IERC20(v.token).safeTransfer(owner(), unvested);
        }

        emit VestingRevoked(vestingId, unvested);
    }

    // ──────────────────────────────────────────────────────────────────────
    // Beneficiary functions
    // ──────────────────────────────────────────────────────────────────────

    /// @notice Claim all vested (but unclaimed) tokens for a vesting schedule.
    /// @param vestingId The vesting schedule to claim from.
    function claim(uint256 vestingId) external {
        VestingSchedule storage v = vestings[vestingId];
        if (v.totalAmount == 0) revert VestingNotFound();
        if (v.beneficiary != msg.sender) revert NotBeneficiary();

        uint128 claimable = _claimableAmount(v);
        if (claimable == 0) revert NothingToClaim();

        v.claimed += claimable;
        IERC20(v.token).safeTransfer(v.beneficiary, claimable);

        emit TokensClaimed(vestingId, v.beneficiary, claimable);
    }

    /// @notice Claim vested tokens from all of the caller's vesting schedules.
    function claimAll() external {
        uint256[] storage ids = beneficiaryVestings[msg.sender];
        uint256 len = ids.length;

        for (uint256 i; i < len; ++i) {
            VestingSchedule storage v = vestings[ids[i]];
            uint128 claimable = _claimableAmount(v);
            if (claimable > 0) {
                v.claimed += claimable;
                IERC20(v.token).safeTransfer(v.beneficiary, claimable);
                emit TokensClaimed(ids[i], v.beneficiary, claimable);
            }
        }
    }

    // ──────────────────────────────────────────────────────────────────────
    // View functions
    // ──────────────────────────────────────────────────────────────────────

    /// @notice Get the amount currently claimable for a vesting schedule.
    function claimableAmount(uint256 vestingId) external view returns (uint128) {
        VestingSchedule storage v = vestings[vestingId];
        if (v.totalAmount == 0) revert VestingNotFound();
        return _claimableAmount(v);
    }

    /// @notice Get the total amount vested so far for a vesting schedule.
    function vestedAmount(uint256 vestingId) external view returns (uint128) {
        VestingSchedule storage v = vestings[vestingId];
        if (v.totalAmount == 0) revert VestingNotFound();
        return _vestedAmount(v);
    }

    /// @notice Get all vesting IDs for a beneficiary.
    function getVestingIds(address beneficiary) external view returns (uint256[] memory) {
        return beneficiaryVestings[beneficiary];
    }

    /// @notice Get full details of a vesting schedule.
    function getVesting(uint256 vestingId) external view returns (VestingSchedule memory) {
        return vestings[vestingId];
    }

    // ──────────────────────────────────────────────────────────────────────
    // Internal helpers
    // ──────────────────────────────────────────────────────────────────────

    /// @dev Calculate the total vested amount (regardless of claims) at the current timestamp.
    ///      If revoked, caps at the amount vested at revocation time.
    function _vestedAmount(VestingSchedule storage v) internal view returns (uint128) {
        // If revoked, vesting is frozen at the revocation snapshot
        if (v.revoked) {
            return v.vestedAtRevoke;
        }

        uint256 elapsed = block.timestamp - v.start;

        // During the cliff period, nothing has vested
        if (elapsed < v.cliffDuration) {
            return 0;
        }

        // After the full vesting duration, everything has vested
        if (elapsed >= v.vestingDuration) {
            return v.totalAmount;
        }

        // Linear vesting: proportional to elapsed time over total vesting duration
        // Note: vesting is linear over the entire vestingDuration (cliff just delays release)
        return uint128((uint256(v.totalAmount) * elapsed) / v.vestingDuration);
    }

    /// @dev Calculate the claimable amount (vested minus already claimed).
    ///      If revoked, vested amount is capped at time of revocation (but since we
    ///      already returned unvested tokens, we cap at totalAmount - unvested = vested at revoke time).
    function _claimableAmount(VestingSchedule storage v) internal view returns (uint128) {
        uint128 vested = _vestedAmount(v);
        if (vested <= v.claimed) return 0;
        return vested - v.claimed;
    }
}
