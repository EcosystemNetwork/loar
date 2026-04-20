// SPDX-License-Identifier: MIT
pragma solidity =0.8.30;

import {Initializable} from "@openzeppelin-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin-upgradeable/access/OwnableUpgradeable.sol";
import {
    ReentrancyGuardUpgradeable
} from "@openzeppelin-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin-upgradeable/utils/PausableUpgradeable.sol";
import {IERC20} from "@openzeppelin/interfaces/IERC20.sol";
import {SafeERC20} from "@openzeppelin/token/ERC20/utils/SafeERC20.sol";
import {IPaymentRouter} from "../interfaces/IPaymentRouter.sol";

/// @title StoryBounties
/// @notice Creators post $LOAR bounties for specific content requests.
///         Community members submit work; creator approves and $LOAR is released.
///
///         Revenue model:
///         - 5% platform fee on every bounty payout (configurable)
///         - Creates circulation: $LOAR flows from token holders → content creators
///         - Unclaimed bounties after expiry return to poster (minus small cancellation fee)
///
///         Example bounties:
///         - "Need a villain origin story for my universe" — 500 $LOAR
///         - "Create a 30-second trailer for Episode 3" — 2000 $LOAR
///         - "Design a faction logo" — 200 $LOAR
contract StoryBounties is
    Initializable,
    UUPSUpgradeable,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    PausableUpgradeable
{
    using SafeERC20 for IERC20;

    enum BountyStatus {
        OPEN,
        CLAIMED,
        CANCELLED,
        EXPIRED
    }

    struct Bounty {
        uint256 id;
        address poster;
        uint256 universeId; // 0 = platform-wide bounty
        uint256 reward; // $LOAR amount
        string title;
        string descriptionHash; // IPFS hash of full description
        string contentType; // "video", "story", "character", "art", "music", etc.
        uint256 deadline; // unix timestamp
        BountyStatus status;
        address claimedBy; // winner
        bytes32 submissionHash; // content hash of winning submission
        uint256 createdAt;
    }

    IERC20 public loarToken;
    IPaymentRouter public paymentRouter;
    address public treasury;
    address public platform;

    uint256 public nextBountyId;
    mapping(uint256 => Bounty) public bounties;

    /// @notice Platform fee on bounty payouts (default 500 = 5%)
    uint16 public platformFeeBps;

    /// @notice Cancellation fee — % of bounty kept by platform on cancel (default 200 = 2%)
    uint16 public cancellationFeeBps;

    /// @notice Minimum bounty amount
    uint256 public minBountyAmount;

    /// @notice Maximum deadline extension (365 days)
    uint256 public constant MAX_DEADLINE = 365 days;

    /// @notice BOUNTY-01: Grace period after deadline — poster must award or explicitly reject before expiry kicks in
    uint256 public constant AWARD_GRACE_PERIOD = 7 days;

    /// @notice Total $LOAR distributed through bounties (lifetime)
    uint256 public totalDistributed;

    /// @notice Total bounties created
    uint256 public totalBounties;

    // Active bounty IDs per universe (0 = platform-wide)
    mapping(uint256 => uint256[]) public universeBounties;

    event BountyCreated(
        uint256 indexed bountyId,
        address indexed poster,
        uint256 universeId,
        uint256 reward,
        string contentType
    );
    event BountyClaimed(
        uint256 indexed bountyId, address indexed winner, uint256 reward, uint256 platformFee
    );
    event BountyCancelled(uint256 indexed bountyId, uint256 refund, uint256 fee);
    event BountyExpired(uint256 indexed bountyId);

    error BountyNotOpen();
    error NotPoster();
    error DeadlinePassed();
    error DeadlineNotPassed();
    error AmountTooLow();
    error InvalidDeadline();
    error ZeroAddress();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _loarToken, address _treasury, address _platform)
        external
        initializer
    {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        __Pausable_init();
        if (_loarToken == address(0) || _treasury == address(0)) revert ZeroAddress();

        loarToken = IERC20(_loarToken);
        treasury = _treasury;
        platform = _platform;
        platformFeeBps = 500; // 5%
        cancellationFeeBps = 200; // 2%
        minBountyAmount = 10e18; // 10 $LOAR minimum
        // PaymentRouter set post-init via setPaymentRouter() if available
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ── Create bounty ───────────────────────────────────────────

    /// @notice Post a new bounty — $LOAR is locked in this contract until claimed/cancelled
    function createBounty(
        uint256 universeId,
        uint256 reward,
        string calldata title,
        string calldata descriptionHash,
        string calldata contentType,
        uint256 deadline
    ) external nonReentrant whenNotPaused returns (uint256 bountyId) {
        if (reward < minBountyAmount) revert AmountTooLow();
        if (deadline <= block.timestamp || deadline > block.timestamp + MAX_DEADLINE) {
            revert InvalidDeadline();
        }

        // Lock $LOAR in contract
        loarToken.safeTransferFrom(msg.sender, address(this), reward);

        bountyId = nextBountyId++;
        bounties[bountyId] = Bounty({
            id: bountyId,
            poster: msg.sender,
            universeId: universeId,
            reward: reward,
            title: title,
            descriptionHash: descriptionHash,
            contentType: contentType,
            deadline: deadline,
            status: BountyStatus.OPEN,
            claimedBy: address(0),
            submissionHash: bytes32(0),
            createdAt: block.timestamp
        });

        universeBounties[universeId].push(bountyId);
        totalBounties++;

        emit BountyCreated(bountyId, msg.sender, universeId, reward, contentType);
    }

    // ── Award bounty ────────────────────────────────────────────

    /// @notice Poster awards the bounty to a winner
    function awardBounty(uint256 bountyId, address winner, bytes32 submissionHash)
        external
        nonReentrant
        whenNotPaused
    {
        if (winner == address(0)) revert ZeroAddress();
        Bounty storage b = bounties[bountyId];
        if (b.status != BountyStatus.OPEN) revert BountyNotOpen();
        if (msg.sender != b.poster && msg.sender != platform) revert NotPoster();

        uint256 platformFee = (b.reward * platformFeeBps) / 10_000;
        uint256 winnerReward = b.reward - platformFee;

        b.status = BountyStatus.CLAIMED;
        b.claimedBy = winner;
        b.submissionHash = submissionHash;

        // Route winner payout through PaymentRouter if available, otherwise direct transfer
        if (address(paymentRouter) != address(0)) {
            loarToken.forceApprove(address(paymentRouter), winnerReward);
            paymentRouter.routeLoar(winner, 0, winnerReward); // 0 fee — already deducted
            if (platformFee > 0) {
                loarToken.forceApprove(address(paymentRouter), platformFee);
                paymentRouter.routeLoarToTreasury(platformFee);
            }
        } else {
            // Fallback: direct transfer (pre-PaymentRouter deployment)
            loarToken.safeTransfer(winner, winnerReward);
            if (platformFee > 0) {
                loarToken.safeTransfer(treasury, platformFee);
            }
        }

        totalDistributed += winnerReward;

        emit BountyClaimed(bountyId, winner, winnerReward, platformFee);
    }

    // ── Cancel bounty ───────────────────────────────────────────

    /// @notice Poster cancels an open bounty before deadline — small fee applies
    function cancelBounty(uint256 bountyId) external nonReentrant whenNotPaused {
        Bounty storage b = bounties[bountyId];
        if (b.status != BountyStatus.OPEN) revert BountyNotOpen();
        if (msg.sender != b.poster) revert NotPoster();

        uint256 fee = (b.reward * cancellationFeeBps) / 10_000;
        uint256 refund = b.reward - fee;

        b.status = BountyStatus.CANCELLED;

        loarToken.safeTransfer(b.poster, refund);
        if (fee > 0) {
            loarToken.safeTransfer(treasury, fee);
        }

        emit BountyCancelled(bountyId, refund, fee);
    }

    // ── Expire bounty ───────────────────────────────────────────

    /// @notice Anyone can mark a bounty as expired after deadline — full refund to poster
    function expireBounty(uint256 bountyId) external nonReentrant whenNotPaused {
        Bounty storage b = bounties[bountyId];
        if (b.status != BountyStatus.OPEN) revert BountyNotOpen();
        // BOUNTY-01: Require grace period to pass so poster has time to award before expiry
        if (block.timestamp <= b.deadline + AWARD_GRACE_PERIOD) revert DeadlineNotPassed();

        b.status = BountyStatus.EXPIRED;
        loarToken.safeTransfer(b.poster, b.reward);

        emit BountyExpired(bountyId);
    }

    // ── Views ───────────────────────────────────────────────────

    function getUniverseBounties(uint256 universeId) external view returns (uint256[] memory) {
        return universeBounties[universeId];
    }

    /// @notice Paginated bounty query — avoids gas limit on large arrays
    function getUniverseBountiesPaginated(uint256 universeId, uint256 offset, uint256 limit)
        external
        view
        returns (uint256[] memory ids, uint256 total)
    {
        uint256[] storage all = universeBounties[universeId];
        total = all.length;
        if (offset >= total) return (new uint256[](0), total);
        uint256 end = offset + limit;
        if (end > total) end = total;
        ids = new uint256[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            ids[i - offset] = all[i];
        }
    }

    function getBounty(uint256 bountyId) external view returns (Bounty memory) {
        return bounties[bountyId];
    }

    // ── Admin ───────────────────────────────────────────────────

    function setPlatformFee(uint16 newFeeBps) external onlyOwner {
        require(newFeeBps <= 2000, "Max 20%");
        uint16 old = platformFeeBps;
        platformFeeBps = newFeeBps;
        emit PlatformFeeChanged(old, newFeeBps);
    }

    function setCancellationFee(uint16 newFeeBps) external onlyOwner {
        require(newFeeBps <= 1000, "Max 10%");
        uint16 old = cancellationFeeBps;
        cancellationFeeBps = newFeeBps;
        emit CancellationFeeChanged(old, newFeeBps);
    }

    function setMinBountyAmount(uint256 newMin) external onlyOwner {
        uint256 old = minBountyAmount;
        minBountyAmount = newMin;
        emit MinBountyChanged(old, newMin);
    }

    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert ZeroAddress();
        address old = treasury;
        treasury = newTreasury;
        emit TreasuryChanged(old, newTreasury);
    }

    function setPlatform(address newPlatform) external onlyOwner {
        address old = platform;
        platform = newPlatform;
        emit PlatformChanged(old, newPlatform);
    }

    /// @notice Set PaymentRouter for consistent revenue routing
    function setPaymentRouter(address _paymentRouter) external onlyOwner {
        address old = address(paymentRouter);
        paymentRouter = IPaymentRouter(_paymentRouter);
        emit PaymentRouterChanged(old, _paymentRouter);
    }

    event PlatformFeeChanged(uint16 oldBps, uint16 newBps);
    event CancellationFeeChanged(uint16 oldBps, uint16 newBps);
    event MinBountyChanged(uint256 oldMin, uint256 newMin);
    event TreasuryChanged(address indexed oldTreasury, address indexed newTreasury);
    event PlatformChanged(address indexed oldPlatform, address indexed newPlatform);
    event PaymentRouterChanged(address indexed oldRouter, address indexed newRouter);

    /// @dev Reserved storage gap for future upgrades
    uint256[49] private __gap;
}
