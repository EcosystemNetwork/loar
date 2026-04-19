// SPDX-License-Identifier: MIT
pragma solidity =0.8.30;

import {Initializable} from "@openzeppelin-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin-upgradeable/access/OwnableUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin-upgradeable/utils/PausableUpgradeable.sol";
import {IERC20} from "@openzeppelin/interfaces/IERC20.sol";
import {SafeERC20} from "@openzeppelin/token/ERC20/utils/SafeERC20.sol";

/// @title LaunchpadStaking
/// @notice Dual staking: global tiers + per-universe staking for revenue share.
///
///         GLOBAL TIERS — Stake $LOAR for platform-wide benefits:
///         - Bronze:   1,000 $LOAR → 1x weight, 1% fee discount
///         - Silver:  10,000 $LOAR → 3x weight, 2.5% fee discount, priority queue
///         - Gold:   100,000 $LOAR → 10x weight, 5% fee discount, priority queue
///         - Diamond: 500,000 $LOAR → 25x weight, 10% fee discount, priority queue
///
///         UNIVERSE STAKING — Stake $LOAR into a specific universe to earn:
///         - Share of that universe's trading fees (Uniswap pool fees)
///         - Share of subscription revenue
///         - Share of NFT mint revenue
///         - Pro-rata based on your stake vs total universe stake
///
///         Revenue model:
///         - All staked $LOAR is locked (reduces circulating supply)
///         - Early unstake penalty: 5% to LP (not burned)
///         - Minimum lock period: 7 days
contract LaunchpadStaking is Initializable, UUPSUpgradeable, OwnableUpgradeable, ReentrancyGuardUpgradeable, PausableUpgradeable {
    using SafeERC20 for IERC20;

    enum Tier {
        NONE,       // 0 - not staked
        BRONZE,     // 1
        SILVER,     // 2
        GOLD,       // 3
        DIAMOND     // 4
    }

    struct StakeInfo {
        uint256 amount;
        uint256 stakedAt;
        uint256 lastClaimAt;
        Tier tier;
    }

    struct TierConfig {
        uint256 minStake;       // minimum $LOAR to reach this tier
        uint16 weight;          // allocation weight multiplier (100 = 1x)
        uint16 feeDiscountBps;  // marketplace fee discount in bps
        uint16 curationBoost;   // curation mining multiplier (100 = 1x)
        bool priorityQueue;     // priority AI generation access
    }

    IERC20 public loarToken;
    address public treasury;
    address public liquidityPool;

    /// @notice Lock period before penalty-free unstake (default 7 days)
    uint256 public minLockPeriod;

    /// @notice Early unstake penalty (default 500 = 5%, burned)
    uint16 public earlyUnstakePenaltyBps;

    /// @notice Tier configurations
    mapping(Tier => TierConfig) public tierConfigs;

    /// @notice Global stake data (for tier benefits)
    mapping(address => StakeInfo) public stakes;

    /// @notice Total $LOAR staked globally
    uint256 public totalStaked;

    /// @notice Total $LOAR collected from early unstake penalties (sent to LP)
    uint256 public totalPenaltyCollected;

    /// @notice Staker count per tier
    mapping(Tier => uint256) public tierCount;

    // ── Per-Universe Staking ────────────────────────────────────

    struct UniverseStake {
        uint256 amount;
        uint256 stakedAt;
        uint256 rewardDebt;     // for reward accounting
    }

    struct UniversePool {
        uint256 totalStaked;    // total $LOAR staked in this universe
        uint256 accRewardPerShare; // accumulated rewards per share (scaled by 1e18)
        uint256 totalDistributed;
    }

    /// @notice Per-universe staking pools
    mapping(uint256 => UniversePool) public universePools;

    /// @notice User stake per universe: user => universeId => stake
    mapping(address => mapping(uint256 => UniverseStake)) public universeStakes;

    /// @notice Total $LOAR staked across all universes
    uint256 public totalUniverseStaked;

    // ── Reward distribution hardening (LS-1 / sandwich mitigation) ──
    //
    // The original `distributeUniverseReward` had two weaknesses:
    //   1. Auth was `owner() || treasury` — any treasury EOA compromise
    //      meant arbitrary, unbounded reward injection.
    //   2. The full reward incremented `accRewardPerShare` in one tx, so an
    //      attacker who watched the mempool could `stakeInUniverse` just
    //      before, claim a slice, and unstake (paying only the 5% penalty).
    //
    // Mitigations layered here:
    //   - `distributors` allowlist replaces the implicit treasury bypass.
    //   - `maxRewardBpsPerDistribution` bounds a single distribution to a
    //     fraction of the pool, so a sandwich attacker's gross take cannot
    //     exceed the early-unstake penalty (5%) and attacks become loss-making.
    //   - `minDistributionInterval` enforces a per-pool cooldown so a malicious
    //     distributor cannot drip-distribute around the cap.
    //
    // These are *bounds*, not full elimination — a future major version with a
    // deposit cliff (pending-amount bucket) would close the residual surface.

    /// @notice Authorized reward distributors (e.g., revenue-router contracts).
    mapping(address => bool) public distributors;

    /// @notice Per-pool block of the most recent distribution. Enforces cooldown.
    mapping(uint256 => uint256) public lastDistributionBlock;

    /// @notice Min blocks between distributions to a single pool.
    /// @dev Default 100 blocks (~20min on Ethereum, ~3min on Base) seeds the
    ///      cooldown without breaking high-frequency revenue plumbing.
    uint256 public minDistributionInterval;

    /// @notice Max single-distribution amount as a fraction of pool.totalStaked (bps).
    /// @dev Default 500 bps (5%) caps attacker gain to the early-unstake penalty,
    ///      making sandwich attacks zero-EV before gas. Set 0 to disable.
    uint16 public maxRewardBpsPerDistribution;

    event DistributorChanged(address indexed who, bool allowed);
    event DistributionGuardChanged(uint256 minInterval, uint16 maxRewardBps);

    error NotDistributor();
    error DistributionTooSoon();
    error DistributionExceedsCap();

    event Staked(address indexed user, uint256 amount, Tier tier);
    event Unstaked(address indexed user, uint256 amount, uint256 penalty);
    event TierChanged(address indexed user, Tier oldTier, Tier newTier);
    event UniverseStaked(address indexed user, uint256 indexed universeId, uint256 amount);
    event UniverseUnstaked(address indexed user, uint256 indexed universeId, uint256 amount, uint256 penalty);
    event UniverseRewardDistributed(uint256 indexed universeId, uint256 amount);
    event UniverseRewardClaimed(address indexed user, uint256 indexed universeId, uint256 amount);

    error ZeroAddress();
    error ZeroAmount();
    error InsufficientStake();
    error NothingStaked();
    error NothingToClaim();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function initialize(
        address _loarToken,
        address _treasury,
        address _liquidityPool
    ) external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        __Pausable_init();
        if (_loarToken == address(0) || _treasury == address(0)) revert ZeroAddress();

        loarToken = IERC20(_loarToken);
        treasury = _treasury;
        liquidityPool = _liquidityPool;
        minLockPeriod = 7 days;
        earlyUnstakePenaltyBps = 500; // 5%

        // Default tier configs
        tierConfigs[Tier.BRONZE]  = TierConfig({minStake: 1_000e18,   weight: 100,  feeDiscountBps: 100,  curationBoost: 100, priorityQueue: false});
        tierConfigs[Tier.SILVER]  = TierConfig({minStake: 10_000e18,  weight: 300,  feeDiscountBps: 250,  curationBoost: 150, priorityQueue: true});
        tierConfigs[Tier.GOLD]    = TierConfig({minStake: 100_000e18, weight: 1000, feeDiscountBps: 500,  curationBoost: 200, priorityQueue: true});
        tierConfigs[Tier.DIAMOND] = TierConfig({minStake: 500_000e18, weight: 2500, feeDiscountBps: 1000, curationBoost: 300, priorityQueue: true});
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    // ── Stake ───────────────────────────────────────────────────

    /// @notice Stake $LOAR to earn tier benefits (requires prior approval)
    function stake(uint256 amount) external nonReentrant whenNotPaused {
        if (amount == 0) revert ZeroAmount();

        loarToken.safeTransferFrom(msg.sender, address(this), amount);

        StakeInfo storage s = stakes[msg.sender];
        Tier oldTier = s.tier;

        // STAKE-01 fix: Update stakedAt on each deposit using weighted average
        // to prevent lock-period bypass via small seed deposits
        if (s.stakedAt == 0) {
            s.stakedAt = block.timestamp;
        } else {
            // Weighted average: new stakedAt = (oldAmount * oldStakedAt + newAmount * now) / totalAmount
            s.stakedAt = (s.amount * s.stakedAt + amount * block.timestamp) / (s.amount + amount);
        }

        s.amount += amount;
        s.lastClaimAt = block.timestamp;

        // Update tier
        Tier newTier = _calculateTier(s.amount);
        if (newTier != oldTier) {
            if (oldTier != Tier.NONE) tierCount[oldTier]--;
            tierCount[newTier]++;
            s.tier = newTier;
            emit TierChanged(msg.sender, oldTier, newTier);
        }

        totalStaked += amount;
        emit Staked(msg.sender, amount, newTier);
    }

    // ── Unstake ─────────────────────────────────────────────────

    /// @notice Unstake $LOAR. Early unstake (before minLockPeriod) incurs a penalty that is burned.
    function unstake(uint256 amount) external nonReentrant whenNotPaused {
        StakeInfo storage s = stakes[msg.sender];
        if (s.amount == 0) revert NothingStaked();
        if (amount > s.amount) revert InsufficientStake();

        uint256 penalty = 0;
        bool isEarly = block.timestamp < s.stakedAt + minLockPeriod;

        if (isEarly) {
            penalty = (amount * earlyUnstakePenaltyBps) / 10_000;
        }

        uint256 payout = amount - penalty;
        Tier oldTier = s.tier;

        s.amount -= amount;
        totalStaked -= amount;

        // Update tier
        Tier newTier = _calculateTier(s.amount);
        if (newTier != oldTier) {
            tierCount[oldTier]--;
            if (newTier != Tier.NONE) tierCount[newTier]++;
            s.tier = newTier;
            emit TierChanged(msg.sender, oldTier, newTier);
        }

        if (s.amount == 0) {
            s.stakedAt = 0;
        }

        // Return tokens
        loarToken.safeTransfer(msg.sender, payout);

        // Penalty goes to LP (deepens liquidity) or treasury as fallback
        if (penalty > 0) {
            address penaltyRecipient = liquidityPool != address(0) ? liquidityPool : treasury;
            loarToken.safeTransfer(penaltyRecipient, penalty);
            totalPenaltyCollected += penalty;
        }

        emit Unstaked(msg.sender, amount, penalty);
    }

    // ── Universe Staking ──────────────────────────────────────

    /// @notice Stake $LOAR into a specific universe to earn revenue share
    function stakeInUniverse(uint256 universeId, uint256 amount) external nonReentrant whenNotPaused {
        if (amount == 0) revert ZeroAmount();

        loarToken.safeTransferFrom(msg.sender, address(this), amount);

        UniversePool storage pool = universePools[universeId];
        UniverseStake storage us = universeStakes[msg.sender][universeId];

        // Claim pending rewards before modifying stake
        if (us.amount > 0 && pool.accRewardPerShare > 0) {
            uint256 pending = (us.amount * pool.accRewardPerShare / 1e18) - us.rewardDebt;
            if (pending > 0) {
                loarToken.safeTransfer(msg.sender, pending);
                emit UniverseRewardClaimed(msg.sender, universeId, pending);
            }
        }

        // STAKE-01 fix: Update stakedAt on each deposit using weighted average
        // to prevent lock-period bypass via small seed deposits
        if (us.stakedAt == 0) {
            us.stakedAt = block.timestamp;
        } else {
            // Weighted average: new stakedAt = (oldAmount * oldStakedAt + newAmount * now) / totalAmount
            us.stakedAt = (us.amount * us.stakedAt + amount * block.timestamp) / (us.amount + amount);
        }

        us.amount += amount;
        us.rewardDebt = us.amount * pool.accRewardPerShare / 1e18;

        pool.totalStaked += amount;
        totalUniverseStaked += amount;

        emit UniverseStaked(msg.sender, universeId, amount);
    }

    /// @notice Unstake $LOAR from a universe. Early unstake penalty goes to LP.
    function unstakeFromUniverse(uint256 universeId, uint256 amount) external nonReentrant whenNotPaused {
        UniverseStake storage us = universeStakes[msg.sender][universeId];
        if (us.amount == 0) revert NothingStaked();
        if (amount > us.amount) revert InsufficientStake();

        UniversePool storage pool = universePools[universeId];

        // Claim pending rewards
        if (pool.accRewardPerShare > 0) {
            uint256 pending = (us.amount * pool.accRewardPerShare / 1e18) - us.rewardDebt;
            if (pending > 0) {
                loarToken.safeTransfer(msg.sender, pending);
                emit UniverseRewardClaimed(msg.sender, universeId, pending);
            }
        }

        uint256 penalty = 0;
        if (block.timestamp < us.stakedAt + minLockPeriod) {
            penalty = (amount * earlyUnstakePenaltyBps) / 10_000;
        }

        us.amount -= amount;
        us.rewardDebt = us.amount * pool.accRewardPerShare / 1e18;
        if (us.amount == 0) us.stakedAt = 0;

        pool.totalStaked -= amount;
        totalUniverseStaked -= amount;

        uint256 payout = amount - penalty;
        loarToken.safeTransfer(msg.sender, payout);

        if (penalty > 0) {
            address penaltyRecipient = liquidityPool != address(0) ? liquidityPool : treasury;
            loarToken.safeTransfer(penaltyRecipient, penalty);
            totalPenaltyCollected += penalty;
        }

        emit UniverseUnstaked(msg.sender, universeId, amount, penalty);
    }

    /// @notice Distribute $LOAR rewards to a universe's staking pool.
    ///         Called by authorized distributors (revenue routers, treasury bots).
    /// @dev Auth: owner OR `distributors[msg.sender]`. The legacy
    ///      `treasury` bypass is gone — re-add via `setDistributor(treasury, true)`
    ///      if the treasury wallet is supposed to push rewards directly.
    function distributeUniverseReward(uint256 universeId, uint256 amount) external nonReentrant whenNotPaused {
        if (msg.sender != owner() && !distributors[msg.sender]) revert NotDistributor();

        UniversePool storage pool = universePools[universeId];
        if (pool.totalStaked == 0) {
            // No stakers — send to treasury rather than incrementing
            // accRewardPerShare against a zero denominator.
            loarToken.safeTransferFrom(msg.sender, treasury, amount);
            return;
        }

        // Cooldown — prevents drip-distribution around the per-distribution cap.
        uint256 lastBlock = lastDistributionBlock[universeId];
        uint256 interval = minDistributionInterval; // SLOAD once
        if (lastBlock != 0 && interval != 0 && block.number < lastBlock + interval) {
            revert DistributionTooSoon();
        }

        // Per-distribution cap — bounds a sandwich attacker's gross take so
        // it cannot exceed the early-unstake penalty (5%). Set 0 to disable.
        uint16 maxBps = maxRewardBpsPerDistribution; // SLOAD once
        if (maxBps != 0) {
            uint256 cap = (pool.totalStaked * maxBps) / 10_000;
            if (amount > cap) revert DistributionExceedsCap();
        }

        loarToken.safeTransferFrom(msg.sender, address(this), amount);
        pool.accRewardPerShare += (amount * 1e18) / pool.totalStaked;
        pool.totalDistributed += amount;
        lastDistributionBlock[universeId] = block.number;

        emit UniverseRewardDistributed(universeId, amount);
    }

    /// @notice Claim pending universe staking rewards
    function claimUniverseReward(uint256 universeId) external nonReentrant whenNotPaused {
        UniversePool storage pool = universePools[universeId];
        UniverseStake storage us = universeStakes[msg.sender][universeId];
        if (us.amount == 0) revert NothingStaked();

        uint256 pending = (us.amount * pool.accRewardPerShare / 1e18) - us.rewardDebt;
        if (pending == 0) revert NothingToClaim();

        us.rewardDebt = us.amount * pool.accRewardPerShare / 1e18;
        loarToken.safeTransfer(msg.sender, pending);

        emit UniverseRewardClaimed(msg.sender, universeId, pending);
    }

    // ── Views ───────────────────────────────────────────────────

    /// @notice Get pending universe staking rewards for a user
    function pendingUniverseReward(address user, uint256 universeId) external view returns (uint256) {
        UniversePool storage pool = universePools[universeId];
        UniverseStake storage us = universeStakes[user][universeId];
        if (us.amount == 0) return 0;
        return (us.amount * pool.accRewardPerShare / 1e18) - us.rewardDebt;
    }

    /// @notice Get a user's current tier
    function getUserTier(address user) external view returns (Tier) {
        return stakes[user].tier;
    }

    /// @notice Get a user's allocation weight for launchpad priority
    function getAllocationWeight(address user) external view returns (uint16) {
        Tier t = stakes[user].tier;
        if (t == Tier.NONE) return 0;
        return tierConfigs[t].weight;
    }

    /// @notice Get fee discount for a user based on their tier
    function getFeeDiscount(address user) external view returns (uint16) {
        Tier t = stakes[user].tier;
        if (t == Tier.NONE) return 0;
        return tierConfigs[t].feeDiscountBps;
    }

    /// @notice Check if user has priority queue access
    function hasPriorityAccess(address user) external view returns (bool) {
        Tier t = stakes[user].tier;
        if (t == Tier.NONE) return false;
        return tierConfigs[t].priorityQueue;
    }

    /// @notice Get curation boost multiplier for a user
    function getCurationBoost(address user) external view returns (uint16) {
        Tier t = stakes[user].tier;
        if (t == Tier.NONE) return 100; // 1x base
        return tierConfigs[t].curationBoost;
    }

    /// @notice Check if unstake would incur a penalty
    function wouldIncurPenalty(address user) external view returns (bool) {
        StakeInfo storage s = stakes[user];
        return s.amount > 0 && block.timestamp < s.stakedAt + minLockPeriod;
    }

    // ── Internal ────────────────────────────────────────────────

    function _calculateTier(uint256 amount) internal view returns (Tier) {
        if (amount >= tierConfigs[Tier.DIAMOND].minStake) return Tier.DIAMOND;
        if (amount >= tierConfigs[Tier.GOLD].minStake) return Tier.GOLD;
        if (amount >= tierConfigs[Tier.SILVER].minStake) return Tier.SILVER;
        if (amount >= tierConfigs[Tier.BRONZE].minStake) return Tier.BRONZE;
        return Tier.NONE;
    }

    // ── Admin ───────────────────────────────────────────────────

    event TierConfigChanged(Tier indexed tier, uint256 minStake, uint16 weight, uint16 feeDiscountBps, uint16 curationBoost, bool priorityQueue);
    event MinLockPeriodChanged(uint256 oldPeriod, uint256 newPeriod);
    event EarlyUnstakePenaltyChanged(uint16 oldPenaltyBps, uint16 newPenaltyBps);
    event TreasuryChanged(address indexed oldTreasury, address indexed newTreasury);
    event LiquidityPoolChanged(address indexed oldPool, address indexed newPool);

    function setTierConfig(Tier tier, uint256 minStake, uint16 weight, uint16 feeDiscountBps, uint16 curationBoost, bool priorityQueue) external onlyOwner {
        require(tier != Tier.NONE, "Cannot configure NONE tier");
        require(feeDiscountBps <= 10_000, "Fee discount > 100%");

        // Enforce monotonic thresholds so `_calculateTier` remains sound
        // (a BRONZE threshold above SILVER's would misclassify stakers and
        // silently break getUserTier/getFeeDiscount invariants).
        if (tier == Tier.BRONZE) {
            require(minStake <= tierConfigs[Tier.SILVER].minStake, "BRONZE >= SILVER");
        } else if (tier == Tier.SILVER) {
            require(minStake >= tierConfigs[Tier.BRONZE].minStake, "SILVER < BRONZE");
            require(minStake <= tierConfigs[Tier.GOLD].minStake, "SILVER > GOLD");
        } else if (tier == Tier.GOLD) {
            require(minStake >= tierConfigs[Tier.SILVER].minStake, "GOLD < SILVER");
            require(minStake <= tierConfigs[Tier.DIAMOND].minStake, "GOLD > DIAMOND");
        } else if (tier == Tier.DIAMOND) {
            require(minStake >= tierConfigs[Tier.GOLD].minStake, "DIAMOND < GOLD");
        }

        tierConfigs[tier] = TierConfig({
            minStake: minStake,
            weight: weight,
            feeDiscountBps: feeDiscountBps,
            curationBoost: curationBoost,
            priorityQueue: priorityQueue
        });
        emit TierConfigChanged(tier, minStake, weight, feeDiscountBps, curationBoost, priorityQueue);
    }

    function setMinLockPeriod(uint256 newPeriod) external onlyOwner {
        require(newPeriod <= 90 days, "Max 90 days");
        uint256 oldPeriod = minLockPeriod;
        minLockPeriod = newPeriod;
        emit MinLockPeriodChanged(oldPeriod, newPeriod);
    }

    function setEarlyUnstakePenalty(uint16 newPenaltyBps) external onlyOwner {
        require(newPenaltyBps <= 2000, "Max 20%");
        uint16 oldBps = earlyUnstakePenaltyBps;
        earlyUnstakePenaltyBps = newPenaltyBps;
        emit EarlyUnstakePenaltyChanged(oldBps, newPenaltyBps);
    }

    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert ZeroAddress();
        address old = treasury;
        treasury = newTreasury;
        emit TreasuryChanged(old, newTreasury);
    }

    function setLiquidityPool(address newPool) external onlyOwner {
        address old = liquidityPool;
        liquidityPool = newPool;
        emit LiquidityPoolChanged(old, newPool);
    }

    /// @notice Allowlist a reward distributor. Owner only.
    /// @dev Use this to authorize the revenue-router contract or a multisig
    ///      that pushes earned protocol fees into universe pools.
    function setDistributor(address who, bool allowed) external onlyOwner {
        if (who == address(0)) revert ZeroAddress();
        distributors[who] = allowed;
        emit DistributorChanged(who, allowed);
    }

    /// @notice Configure the sandwich-mitigation guards for distributions.
    /// @param newMinInterval Min blocks between distributions to a single pool.
    /// @param newMaxRewardBps Max distribution size as fraction of pool (bps).
    /// @dev Pass `newMaxRewardBps == 0` to disable the per-distribution cap.
    ///      Must be <= 10_000 (100% of the pool); recommended 500 (5%).
    function setDistributionGuard(uint256 newMinInterval, uint16 newMaxRewardBps) external onlyOwner {
        require(newMaxRewardBps <= 10_000, "Max bps > 100%");
        require(newMinInterval <= 100_000, "Interval too large");
        minDistributionInterval = newMinInterval;
        maxRewardBpsPerDistribution = newMaxRewardBps;
        emit DistributionGuardChanged(newMinInterval, newMaxRewardBps);
    }

    /// @notice One-time post-upgrade defaults for the new sandwich-guard
    ///         parameters. Safe to call once after the V2 upgrade; further
    ///         changes go through `setDistributionGuard`.
    /// @dev Idempotent: only seeds defaults when the guard is uninitialized
    ///      (both fields zero), so accidental re-calls cannot relax stricter
    ///      values that owner has set since.
    function initializeDistributionGuardV2() external onlyOwner {
        if (minDistributionInterval == 0 && maxRewardBpsPerDistribution == 0) {
            minDistributionInterval = 100;             // ~20min Eth, ~3min Base
            maxRewardBpsPerDistribution = 500;         // 5% of pool per distribution
            emit DistributionGuardChanged(100, 500);
        }
    }

    /// @dev Reserved storage gap for future upgrades. Reduced from 49 → 45
    ///      to make room for: `distributors` mapping (1), `lastDistributionBlock`
    ///      mapping (1), `minDistributionInterval` (1), and
    ///      `maxRewardBpsPerDistribution` which sits alone in its own slot (1)
    ///      because the trailing field is the gap array.
    uint256[45] private __gap;
}
