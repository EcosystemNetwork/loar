// SPDX-License-Identifier: MIT
pragma solidity =0.8.30;

import {Initializable} from "@openzeppelin-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin-upgradeable/access/OwnableUpgradeable.sol";
import {
    ReentrancyGuardUpgradeable
} from "@openzeppelin-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin-upgradeable/utils/PausableUpgradeable.sol";
import {IERC20} from "@openzeppelin/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/token/ERC20/utils/SafeERC20.sol";

/// @title AdSeedEscrow (A4)
/// @notice Sponsor-funded $LOAR escrow for the Ad Seeds program.
///         A brand pre-funds a "seed" with a $LOAR budget; the platform
///         approves placements against the seed (releasing portions of the
///         escrow to the universe creator); any unused balance is refundable
///         to the sponsor after `expiresAt`.
///
/// Flow:
///   1. fundSeed()        — sponsor escrows $LOAR for a defined window
///   2. approvePlacement()— platform releases part of the seed to a creator
///   3. expireSeed()      — after `expiresAt`, sponsor (or anyone) refunds
///                          the remaining balance back to the sponsor
///
/// Off-chain Firestore mirror lives in `adSeeds.routes.ts`. This contract
/// holds the trust layer; the router holds the workflow + metadata.
contract AdSeedEscrow is
    Initializable,
    UUPSUpgradeable,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    PausableUpgradeable
{
    using SafeERC20 for IERC20;

    // ── Storage ─────────────────────────────────────────────────────────

    struct Seed {
        address sponsor;
        uint256 totalFunded;
        uint256 totalReleased;
        uint64 expiresAt;
        bool refunded;
    }

    /// @notice Trusted caller (server-side Circle DCW wallet) that may
    ///         approve placements against escrowed seeds.
    address public platform;

    /// @notice $LOAR token used for escrow. Set at init time.
    address public loarToken;

    /// @notice seedId → Seed
    mapping(bytes32 => Seed) public seeds;

    // ── Events ──────────────────────────────────────────────────────────

    event SeedFunded(
        bytes32 indexed seedId,
        address indexed sponsor,
        uint256 amount,
        uint64 expiresAt
    );
    event PlacementApproved(
        bytes32 indexed seedId,
        address indexed creator,
        uint256 amount,
        bytes32 placementId
    );
    event SeedRefunded(bytes32 indexed seedId, address indexed sponsor, uint256 amount);
    event PlatformChanged(address indexed oldPlatform, address indexed newPlatform);

    // ── Errors ──────────────────────────────────────────────────────────

    error NotPlatform();
    error NotSponsor();
    error UnknownSeed();
    error SeedAlreadyExists();
    error SeedExpired();
    error SeedNotExpired();
    error InsufficientEscrow();
    error AlreadyRefunded();
    error ZeroAddress();
    error ZeroAmount();
    error InvalidExpiry();

    // ── Modifiers ───────────────────────────────────────────────────────

    modifier onlyPlatform() {
        if (msg.sender != platform) revert NotPlatform();
        _;
    }

    // ── Initializer ─────────────────────────────────────────────────────

    function initialize(address _platform, address _loarToken) external initializer {
        if (_platform == address(0) || _loarToken == address(0)) revert ZeroAddress();

        __UUPSUpgradeable_init();
        __Ownable_init(msg.sender);
        __ReentrancyGuard_init();
        __Pausable_init();

        platform = _platform;
        loarToken = _loarToken;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // ── Admin ───────────────────────────────────────────────────────────

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function setPlatform(address newPlatform) external onlyOwner {
        if (newPlatform == address(0)) revert ZeroAddress();
        emit PlatformChanged(platform, newPlatform);
        platform = newPlatform;
    }

    // ── Sponsor flow ────────────────────────────────────────────────────

    /// @notice Sponsor escrows $LOAR for a new seed. The sponsor must
    ///         have approved `amount` of LOAR to this contract first.
    /// @param seedId Unique identifier — server generates from
    ///        keccak256(sponsorUid || seedConfigHash).
    function fundSeed(bytes32 seedId, uint256 amount, uint64 expiresAt)
        external
        nonReentrant
        whenNotPaused
    {
        if (amount == 0) revert ZeroAmount();
        if (expiresAt <= block.timestamp) revert InvalidExpiry();
        if (seeds[seedId].sponsor != address(0)) revert SeedAlreadyExists();

        seeds[seedId] = Seed({
            sponsor: msg.sender,
            totalFunded: amount,
            totalReleased: 0,
            expiresAt: expiresAt,
            refunded: false
        });

        IERC20(loarToken).safeTransferFrom(msg.sender, address(this), amount);
        emit SeedFunded(seedId, msg.sender, amount, expiresAt);
    }

    /// @notice Sponsor can extend the expiry of an active seed.
    function extendExpiry(bytes32 seedId, uint64 newExpiresAt) external nonReentrant whenNotPaused {
        Seed storage s = seeds[seedId];
        if (s.sponsor == address(0)) revert UnknownSeed();
        if (msg.sender != s.sponsor) revert NotSponsor();
        if (newExpiresAt <= block.timestamp || newExpiresAt <= s.expiresAt) revert InvalidExpiry();
        s.expiresAt = newExpiresAt;
        emit SeedFunded(seedId, s.sponsor, 0, newExpiresAt); // 0 amount = expiry-only update
    }

    // ── Platform flow ───────────────────────────────────────────────────

    /// @notice Approve a placement against a seed — releases `amount` of
    ///         $LOAR to the universe creator. Platform-only.
    function approvePlacement(
        bytes32 seedId,
        bytes32 placementId,
        address creator,
        uint256 amount
    ) external onlyPlatform nonReentrant whenNotPaused {
        if (creator == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        Seed storage s = seeds[seedId];
        if (s.sponsor == address(0)) revert UnknownSeed();
        if (block.timestamp >= s.expiresAt) revert SeedExpired();
        uint256 remaining = s.totalFunded - s.totalReleased;
        if (amount > remaining) revert InsufficientEscrow();

        s.totalReleased += amount;
        IERC20(loarToken).safeTransfer(creator, amount);
        emit PlacementApproved(seedId, creator, amount, placementId);
    }

    // ── Refund flow ─────────────────────────────────────────────────────

    /// @notice After expiry, anyone can trigger the refund of remaining
    ///         escrow back to the sponsor. Idempotent.
    function refundExpiredSeed(bytes32 seedId) external nonReentrant whenNotPaused {
        Seed storage s = seeds[seedId];
        if (s.sponsor == address(0)) revert UnknownSeed();
        if (s.refunded) revert AlreadyRefunded();
        if (block.timestamp < s.expiresAt) revert SeedNotExpired();

        uint256 remaining = s.totalFunded - s.totalReleased;
        s.refunded = true;
        if (remaining > 0) {
            IERC20(loarToken).safeTransfer(s.sponsor, remaining);
        }
        emit SeedRefunded(seedId, s.sponsor, remaining);
    }

    // ── Views ───────────────────────────────────────────────────────────

    function getSeed(bytes32 seedId) external view returns (Seed memory) {
        return seeds[seedId];
    }

    function remaining(bytes32 seedId) external view returns (uint256) {
        Seed memory s = seeds[seedId];
        if (s.sponsor == address(0)) return 0;
        return s.totalFunded - s.totalReleased;
    }
}
