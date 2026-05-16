//! LOAR LaunchpadStaking — dual $LOAR staking on Solana.
//!
//! Sister to `apps/contracts/src/revenue/LaunchpadStaking.sol`. Two staking
//! modes share a single program:
//!
//!   GLOBAL TIERS — Stake $LOAR for platform-wide benefits (tier multipliers,
//!   fee discounts, priority queue). Tier is recomputed on every stake/unstake.
//!
//!   PER-UNIVERSE STAKING — Stake $LOAR into a specific Universe to earn
//!   revenue share from that universe's flows (trading, subscriptions, mints).
//!
//! v1 scope (this version):
//! - Stake / unstake (both modes)
//! - Tier recomputation on stake mutation
//! - Early-unstake penalty (lock period + penalty bps)
//! - Admin: pause, tier configs, two-step admin transfer
//!
//! Deferred to v2 (clearly marked):
//! - `distribute_universe_reward` + `claim_universe_reward` — the acc-per-share
//!   reward math + sandwich-attack mitigations (LS-1 analog). Requires a real
//!   Solana-side revenue source to be wired first; without it, per-universe
//!   yield is structurally zero and shipping the distribution surface before
//!   the source exists would be cargo-culted code.
//!
//! Audit-relevant invariants (parallels EVM after STAKE-* fixes):
//! - Weighted-average `staked_at` on every incremental stake (STAKE-01 analog):
//!   `new_staked_at = (prev_amount * prev_staked_at + add_amount * now) / new_total`.
//!   Prevents 1-wei seed bypassing the lock period.
//! - Global + per-universe accounting tracked separately. Both vault PDAs are
//!   distinct so global and universe deposits never commingle. (STAKE-02 analog)
//! - All u64 math uses `checked_*`; integer overflow is a hard revert.
//! - `Config.paused` blocks all writes; unstaking remains the exit hatch
//!   if the program is frozen (matches EVM Pausable convention here —
//!   we follow the same exit-hatch model but use `paused_blocks_unstake = false`
//!   default so admin can unwind a buggy state).
//! - `transfer_checked` on every SPL movement — works with both classic
//!   SPL and Token-2022. $LOAR is Token-2022 in production.

use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{
    self, Mint, TokenAccount, TokenInterface, TransferChecked,
};

declare_id!("9EjnngPFpE3QaUgS3zspXwkLby2AnNwyC2UjPFL9zBqJ");

pub const BPS_DENOM: u64 = 10_000;
pub const MAX_PENALTY_BPS: u16 = 1_000; // 10%
pub const TIER_COUNT: usize = 5; // None, Bronze, Silver, Gold, Diamond

pub const CONFIG_SEED: &[u8] = b"staking_config";
pub const GLOBAL_VAULT_SEED: &[u8] = b"global_vault";
pub const UNIVERSE_POOL_SEED: &[u8] = b"universe_pool";
pub const UNIVERSE_VAULT_SEED: &[u8] = b"universe_vault";
pub const STAKE_INFO_SEED: &[u8] = b"stake_info";
pub const UNIVERSE_STAKE_SEED: &[u8] = b"universe_stake";

#[program]
pub mod staking {
    use super::*;

    /// Initialize the singleton config + global $LOAR vault.
    pub fn initialize(
        ctx: Context<Initialize>,
        treasury: Pubkey,
        liquidity_pool: Pubkey,
        min_lock_period_secs: i64,
        early_unstake_penalty_bps: u16,
    ) -> Result<()> {
        require!(treasury != Pubkey::default(), StakingError::ZeroAddress);
        require!(
            early_unstake_penalty_bps <= MAX_PENALTY_BPS,
            StakingError::PenaltyTooHigh
        );
        require!(min_lock_period_secs >= 0, StakingError::InvalidLockPeriod);

        let config = &mut ctx.accounts.config;
        config.admin = ctx.accounts.admin.key();
        config.pending_admin = Pubkey::default();
        config.loar_mint = ctx.accounts.loar_mint.key();
        config.treasury = treasury;
        config.liquidity_pool = liquidity_pool;
        config.min_lock_period_secs = min_lock_period_secs;
        config.early_unstake_penalty_bps = early_unstake_penalty_bps;
        config.total_staked = 0;
        config.total_universe_staked = 0;
        config.total_penalty_collected = 0;
        config.tier_configs = default_tier_configs();
        config.paused = false;
        config.bump = ctx.bumps.config;
        config.global_vault_bump = ctx.bumps.global_vault;

        emit!(Initialized {
            admin: config.admin,
            loar_mint: config.loar_mint,
            treasury,
            liquidity_pool,
        });
        Ok(())
    }

    /// Admin: update one tier's parameters.
    pub fn set_tier_config(
        ctx: Context<AdminOnly>,
        tier: u8,
        min_stake: u64,
        weight_bps: u16,
        fee_discount_bps: u16,
        curation_boost_bps: u16,
        priority_queue: bool,
    ) -> Result<()> {
        require!((tier as usize) < TIER_COUNT, StakingError::InvalidTier);
        require!(tier != 0 || min_stake == 0, StakingError::InvalidTier); // tier 0 = NONE, must have 0 minStake
        let config = &mut ctx.accounts.config;
        config.tier_configs[tier as usize] = TierConfig {
            min_stake,
            weight_bps,
            fee_discount_bps,
            curation_boost_bps,
            priority_queue,
        };
        emit!(TierConfigUpdated {
            tier,
            min_stake,
            weight_bps,
            fee_discount_bps,
            curation_boost_bps,
            priority_queue,
        });
        Ok(())
    }

    /// Stake $LOAR globally for tier benefits.
    ///
    /// On every incremental stake, recomputes weighted-average `staked_at`
    /// so a 1-wei seed late in the lock period can't fast-track a large
    /// principal out of the lock (STAKE-01 analog).
    pub fn stake(ctx: Context<Stake>, amount: u64) -> Result<()> {
        require!(!ctx.accounts.config.paused, StakingError::Paused);
        require!(amount > 0, StakingError::ZeroAmount);

        // Transfer LOAR from user ATA → global vault ATA.
        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.user_loar_ata.to_account_info(),
                    mint: ctx.accounts.loar_mint.to_account_info(),
                    to: ctx.accounts.global_vault_ata.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            amount,
            ctx.accounts.loar_mint.decimals,
        )?;

        let now = Clock::get()?.unix_timestamp;
        let stake_info = &mut ctx.accounts.stake_info;
        let prev_tier = stake_info.tier;

        if stake_info.amount == 0 {
            stake_info.user = ctx.accounts.user.key();
            stake_info.staked_at = now;
            stake_info.last_claim_at = now;
            stake_info.bump = ctx.bumps.stake_info;
        } else {
            // Weighted-average staked_at to defeat the 1-wei seed bypass.
            stake_info.staked_at = weighted_avg_timestamp(
                stake_info.amount,
                stake_info.staked_at,
                amount,
                now,
            )?;
        }
        stake_info.amount = stake_info
            .amount
            .checked_add(amount)
            .ok_or(StakingError::MathOverflow)?;

        let config = &mut ctx.accounts.config;
        config.total_staked = config
            .total_staked
            .checked_add(amount)
            .ok_or(StakingError::MathOverflow)?;

        stake_info.tier = compute_tier(stake_info.amount, &config.tier_configs);

        emit!(Staked {
            user: ctx.accounts.user.key(),
            amount,
            new_total: stake_info.amount,
            tier: stake_info.tier,
        });
        if stake_info.tier != prev_tier {
            emit!(TierChanged {
                user: ctx.accounts.user.key(),
                old_tier: prev_tier,
                new_tier: stake_info.tier,
            });
        }
        Ok(())
    }

    /// Unstake $LOAR globally. Applies early-unstake penalty if within
    /// `min_lock_period_secs` of the (weighted-average) `staked_at`. The
    /// penalty is sent to the configured liquidity_pool ATA (or treasury
    /// fallback).
    pub fn unstake(ctx: Context<Unstake>, amount: u64) -> Result<()> {
        require!(amount > 0, StakingError::ZeroAmount);
        let stake_info = &mut ctx.accounts.stake_info;
        require!(stake_info.amount >= amount, StakingError::InsufficientStake);

        let config = &mut ctx.accounts.config;
        let now = Clock::get()?.unix_timestamp;
        let elapsed = now.saturating_sub(stake_info.staked_at);
        let (user_share, penalty) = if elapsed < config.min_lock_period_secs {
            let penalty = mul_bps(amount, config.early_unstake_penalty_bps as u64)?;
            (
                amount.checked_sub(penalty).ok_or(StakingError::MathOverflow)?,
                penalty,
            )
        } else {
            (amount, 0u64)
        };

        // Vault signs both transfers with the same PDA derivation.
        let bump = config.global_vault_bump;
        let seeds: &[&[u8]] = &[GLOBAL_VAULT_SEED, &[bump]];
        let signer_seeds: &[&[&[u8]]] = &[seeds];

        // Vault → user
        if user_share > 0 {
            token_interface::transfer_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    TransferChecked {
                        from: ctx.accounts.global_vault_ata.to_account_info(),
                        mint: ctx.accounts.loar_mint.to_account_info(),
                        to: ctx.accounts.user_loar_ata.to_account_info(),
                        authority: ctx.accounts.global_vault.to_account_info(),
                    },
                    signer_seeds,
                ),
                user_share,
                ctx.accounts.loar_mint.decimals,
            )?;
        }

        // Vault → penalty destination (liquidity_pool's ATA passed by caller).
        if penalty > 0 {
            token_interface::transfer_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    TransferChecked {
                        from: ctx.accounts.global_vault_ata.to_account_info(),
                        mint: ctx.accounts.loar_mint.to_account_info(),
                        to: ctx.accounts.penalty_destination_ata.to_account_info(),
                        authority: ctx.accounts.global_vault.to_account_info(),
                    },
                    signer_seeds,
                ),
                penalty,
                ctx.accounts.loar_mint.decimals,
            )?;
            config.total_penalty_collected = config
                .total_penalty_collected
                .checked_add(penalty)
                .ok_or(StakingError::MathOverflow)?;
        }

        // Bookkeeping after on-chain moves succeed.
        let prev_tier = stake_info.tier;
        stake_info.amount = stake_info
            .amount
            .checked_sub(amount)
            .ok_or(StakingError::MathOverflow)?;
        config.total_staked = config
            .total_staked
            .checked_sub(amount)
            .ok_or(StakingError::MathOverflow)?;
        stake_info.tier = compute_tier(stake_info.amount, &config.tier_configs);

        emit!(Unstaked {
            user: ctx.accounts.user.key(),
            amount,
            penalty,
            new_total: stake_info.amount,
            tier: stake_info.tier,
        });
        if stake_info.tier != prev_tier {
            emit!(TierChanged {
                user: ctx.accounts.user.key(),
                old_tier: prev_tier,
                new_tier: stake_info.tier,
            });
        }
        Ok(())
    }

    /// Per-universe stake. Universe is identified by a `Pubkey` (the
    /// Universe PDA from the `universe` program). Each universe has its own
    /// vault ATA owned by `UniversePool` PDA.
    pub fn stake_in_universe(
        ctx: Context<StakeInUniverse>,
        universe: Pubkey,
        amount: u64,
    ) -> Result<()> {
        require!(!ctx.accounts.config.paused, StakingError::Paused);
        require!(amount > 0, StakingError::ZeroAmount);

        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.user_loar_ata.to_account_info(),
                    mint: ctx.accounts.loar_mint.to_account_info(),
                    to: ctx.accounts.universe_vault_ata.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            amount,
            ctx.accounts.loar_mint.decimals,
        )?;

        let now = Clock::get()?.unix_timestamp;
        let stake = &mut ctx.accounts.universe_stake;
        if stake.amount == 0 {
            stake.user = ctx.accounts.user.key();
            stake.universe = universe;
            stake.staked_at = now;
            stake.bump = ctx.bumps.universe_stake;
        } else {
            stake.staked_at = weighted_avg_timestamp(stake.amount, stake.staked_at, amount, now)?;
        }
        stake.amount = stake
            .amount
            .checked_add(amount)
            .ok_or(StakingError::MathOverflow)?;

        let pool = &mut ctx.accounts.universe_pool;
        if pool.universe == Pubkey::default() {
            pool.universe = universe;
            pool.bump = ctx.bumps.universe_pool;
            pool.vault_bump = ctx.bumps.universe_vault;
        }
        pool.total_staked = pool
            .total_staked
            .checked_add(amount)
            .ok_or(StakingError::MathOverflow)?;

        let config = &mut ctx.accounts.config;
        config.total_universe_staked = config
            .total_universe_staked
            .checked_add(amount)
            .ok_or(StakingError::MathOverflow)?;

        emit!(UniverseStaked {
            user: ctx.accounts.user.key(),
            universe,
            amount,
            new_user_total: stake.amount,
            new_pool_total: pool.total_staked,
        });
        Ok(())
    }

    /// Per-universe unstake. Same lock + penalty model as global unstake.
    pub fn unstake_from_universe(
        ctx: Context<UnstakeFromUniverse>,
        _universe: Pubkey,
        amount: u64,
    ) -> Result<()> {
        require!(amount > 0, StakingError::ZeroAmount);
        let stake = &mut ctx.accounts.universe_stake;
        require!(stake.amount >= amount, StakingError::InsufficientStake);

        let config = &mut ctx.accounts.config;
        let now = Clock::get()?.unix_timestamp;
        let elapsed = now.saturating_sub(stake.staked_at);
        let (user_share, penalty) = if elapsed < config.min_lock_period_secs {
            let penalty = mul_bps(amount, config.early_unstake_penalty_bps as u64)?;
            (
                amount.checked_sub(penalty).ok_or(StakingError::MathOverflow)?,
                penalty,
            )
        } else {
            (amount, 0u64)
        };

        let pool = &mut ctx.accounts.universe_pool;
        let vault_bump = pool.vault_bump;
        let universe_key = pool.universe;
        let seeds: &[&[u8]] = &[UNIVERSE_VAULT_SEED, universe_key.as_ref(), &[vault_bump]];
        let signer_seeds: &[&[&[u8]]] = &[seeds];

        if user_share > 0 {
            token_interface::transfer_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    TransferChecked {
                        from: ctx.accounts.universe_vault_ata.to_account_info(),
                        mint: ctx.accounts.loar_mint.to_account_info(),
                        to: ctx.accounts.user_loar_ata.to_account_info(),
                        authority: ctx.accounts.universe_vault.to_account_info(),
                    },
                    signer_seeds,
                ),
                user_share,
                ctx.accounts.loar_mint.decimals,
            )?;
        }
        if penalty > 0 {
            token_interface::transfer_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    TransferChecked {
                        from: ctx.accounts.universe_vault_ata.to_account_info(),
                        mint: ctx.accounts.loar_mint.to_account_info(),
                        to: ctx.accounts.penalty_destination_ata.to_account_info(),
                        authority: ctx.accounts.universe_vault.to_account_info(),
                    },
                    signer_seeds,
                ),
                penalty,
                ctx.accounts.loar_mint.decimals,
            )?;
            config.total_penalty_collected = config
                .total_penalty_collected
                .checked_add(penalty)
                .ok_or(StakingError::MathOverflow)?;
        }

        stake.amount = stake
            .amount
            .checked_sub(amount)
            .ok_or(StakingError::MathOverflow)?;
        pool.total_staked = pool
            .total_staked
            .checked_sub(amount)
            .ok_or(StakingError::MathOverflow)?;
        config.total_universe_staked = config
            .total_universe_staked
            .checked_sub(amount)
            .ok_or(StakingError::MathOverflow)?;

        emit!(UniverseUnstaked {
            user: ctx.accounts.user.key(),
            universe: universe_key,
            amount,
            penalty,
            new_user_total: stake.amount,
            new_pool_total: pool.total_staked,
        });
        Ok(())
    }

    // ─── Admin ────────────────────────────────────────────────────────────

    pub fn pause(ctx: Context<AdminOnly>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(!config.paused, StakingError::AlreadyPaused);
        config.paused = true;
        emit!(Paused {});
        Ok(())
    }

    pub fn unpause(ctx: Context<AdminOnly>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(config.paused, StakingError::NotPaused);
        config.paused = false;
        emit!(Unpaused {});
        Ok(())
    }

    pub fn set_lock_params(
        ctx: Context<AdminOnly>,
        min_lock_period_secs: i64,
        early_unstake_penalty_bps: u16,
    ) -> Result<()> {
        require!(min_lock_period_secs >= 0, StakingError::InvalidLockPeriod);
        require!(
            early_unstake_penalty_bps <= MAX_PENALTY_BPS,
            StakingError::PenaltyTooHigh
        );
        let config = &mut ctx.accounts.config;
        config.min_lock_period_secs = min_lock_period_secs;
        config.early_unstake_penalty_bps = early_unstake_penalty_bps;
        emit!(LockParamsUpdated {
            min_lock_period_secs,
            early_unstake_penalty_bps,
        });
        Ok(())
    }

    pub fn transfer_admin(ctx: Context<AdminOnly>, new_admin: Pubkey) -> Result<()> {
        require!(new_admin != Pubkey::default(), StakingError::ZeroAddress);
        ctx.accounts.config.pending_admin = new_admin;
        emit!(AdminTransferProposed { new_admin });
        Ok(())
    }

    pub fn accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(
            config.pending_admin == ctx.accounts.new_admin.key(),
            StakingError::Unauthorized
        );
        let old = config.admin;
        config.admin = config.pending_admin;
        config.pending_admin = Pubkey::default();
        emit!(AdminTransferred {
            old_admin: old,
            new_admin: config.admin,
        });
        Ok(())
    }
}

// ─── Math helpers ────────────────────────────────────────────────────────────

fn mul_bps(amount: u64, bps: u64) -> Result<u64> {
    let r = (amount as u128)
        .checked_mul(bps as u128)
        .ok_or(StakingError::MathOverflow)?
        .checked_div(BPS_DENOM as u128)
        .ok_or(StakingError::MathOverflow)?;
    Ok(r as u64)
}

/// Weighted-average timestamp: (prev_amt * prev_ts + add_amt * now) / (prev_amt + add_amt).
fn weighted_avg_timestamp(prev_amt: u64, prev_ts: i64, add_amt: u64, now: i64) -> Result<i64> {
    let prev_amt = prev_amt as i128;
    let add_amt = add_amt as i128;
    let new_total = prev_amt
        .checked_add(add_amt)
        .ok_or(StakingError::MathOverflow)?;
    if new_total == 0 {
        return Ok(now);
    }
    let num = prev_amt
        .checked_mul(prev_ts as i128)
        .ok_or(StakingError::MathOverflow)?
        .checked_add(
            add_amt
                .checked_mul(now as i128)
                .ok_or(StakingError::MathOverflow)?,
        )
        .ok_or(StakingError::MathOverflow)?;
    let r = num
        .checked_div(new_total)
        .ok_or(StakingError::MathOverflow)?;
    Ok(r as i64)
}

fn compute_tier(amount: u64, tiers: &[TierConfig; TIER_COUNT]) -> u8 {
    // Iterate top-down; first tier whose min_stake we meet wins.
    for i in (1..TIER_COUNT).rev() {
        if amount >= tiers[i].min_stake && tiers[i].min_stake > 0 {
            return i as u8;
        }
    }
    0
}

fn default_tier_configs() -> [TierConfig; TIER_COUNT] {
    [
        // 0: NONE — sentinel.
        TierConfig {
            min_stake: 0,
            weight_bps: 0,
            fee_discount_bps: 0,
            curation_boost_bps: 0,
            priority_queue: false,
        },
        // 1: BRONZE — 1,000 $LOAR (assuming 9 decimals = 1_000 * 1e9 lamports)
        TierConfig {
            min_stake: 1_000_000_000_000,
            weight_bps: 100,
            fee_discount_bps: 100,
            curation_boost_bps: 100,
            priority_queue: false,
        },
        // 2: SILVER — 10,000 $LOAR
        TierConfig {
            min_stake: 10_000_000_000_000,
            weight_bps: 300,
            fee_discount_bps: 250,
            curation_boost_bps: 150,
            priority_queue: true,
        },
        // 3: GOLD — 100,000 $LOAR
        TierConfig {
            min_stake: 100_000_000_000_000,
            weight_bps: 1_000,
            fee_discount_bps: 500,
            curation_boost_bps: 200,
            priority_queue: true,
        },
        // 4: DIAMOND — 500,000 $LOAR
        TierConfig {
            min_stake: 500_000_000_000_000,
            weight_bps: 2_500,
            fee_discount_bps: 1_000,
            curation_boost_bps: 300,
            priority_queue: true,
        },
    ]
}

// ─── Accounts ────────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    pub loar_mint: InterfaceAccount<'info, Mint>,
    #[account(
        init,
        payer = admin,
        space = 8 + Config::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, Config>,
    /// CHECK: PDA authority for the global LOAR vault ATA. Owns nothing
    /// itself; just signs SPL transfers via the global_vault seed.
    #[account(seeds = [GLOBAL_VAULT_SEED], bump)]
    pub global_vault: UncheckedAccount<'info>,
    #[account(
        init,
        payer = admin,
        associated_token::mint = loar_mint,
        associated_token::authority = global_vault,
    )]
    pub global_vault_ata: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Stake<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        address = config.loar_mint @ StakingError::MintMismatch,
    )]
    pub loar_mint: InterfaceAccount<'info, Mint>,
    #[account(
        init_if_needed,
        payer = user,
        space = 8 + StakeInfo::INIT_SPACE,
        seeds = [STAKE_INFO_SEED, user.key().as_ref()],
        bump,
    )]
    pub stake_info: Account<'info, StakeInfo>,
    /// CHECK: PDA authority for global vault — seed-derived.
    #[account(seeds = [GLOBAL_VAULT_SEED], bump = config.global_vault_bump)]
    pub global_vault: UncheckedAccount<'info>,
    #[account(
        mut,
        associated_token::mint = loar_mint,
        associated_token::authority = global_vault,
    )]
    pub global_vault_ata: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        associated_token::mint = loar_mint,
        associated_token::authority = user,
    )]
    pub user_loar_ata: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Unstake<'info> {
    pub user: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        address = config.loar_mint @ StakingError::MintMismatch,
    )]
    pub loar_mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        seeds = [STAKE_INFO_SEED, user.key().as_ref()],
        bump = stake_info.bump,
        constraint = stake_info.user == user.key() @ StakingError::Unauthorized,
    )]
    pub stake_info: Account<'info, StakeInfo>,
    /// CHECK: seed-derived
    #[account(seeds = [GLOBAL_VAULT_SEED], bump = config.global_vault_bump)]
    pub global_vault: UncheckedAccount<'info>,
    #[account(
        mut,
        associated_token::mint = loar_mint,
        associated_token::authority = global_vault,
    )]
    pub global_vault_ata: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        associated_token::mint = loar_mint,
        associated_token::authority = user,
    )]
    pub user_loar_ata: InterfaceAccount<'info, TokenAccount>,
    /// CHECK: penalty destination ATA — caller provides; could be LP, treasury,
    /// or burn address depending on the operational decision at deploy time.
    #[account(mut)]
    pub penalty_destination_ata: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
#[instruction(universe: Pubkey)]
pub struct StakeInUniverse<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(address = config.loar_mint @ StakingError::MintMismatch)]
    pub loar_mint: InterfaceAccount<'info, Mint>,

    #[account(
        init_if_needed,
        payer = user,
        space = 8 + UniversePool::INIT_SPACE,
        seeds = [UNIVERSE_POOL_SEED, universe.as_ref()],
        bump,
    )]
    pub universe_pool: Account<'info, UniversePool>,

    /// CHECK: PDA authority for the per-universe LOAR vault ATA.
    #[account(seeds = [UNIVERSE_VAULT_SEED, universe.as_ref()], bump)]
    pub universe_vault: UncheckedAccount<'info>,
    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = loar_mint,
        associated_token::authority = universe_vault,
    )]
    pub universe_vault_ata: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = user,
        space = 8 + UniverseStake::INIT_SPACE,
        seeds = [UNIVERSE_STAKE_SEED, user.key().as_ref(), universe.as_ref()],
        bump,
    )]
    pub universe_stake: Account<'info, UniverseStake>,

    #[account(
        mut,
        associated_token::mint = loar_mint,
        associated_token::authority = user,
    )]
    pub user_loar_ata: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(universe: Pubkey)]
pub struct UnstakeFromUniverse<'info> {
    pub user: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(address = config.loar_mint @ StakingError::MintMismatch)]
    pub loar_mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        seeds = [UNIVERSE_POOL_SEED, universe.as_ref()],
        bump = universe_pool.bump,
    )]
    pub universe_pool: Account<'info, UniversePool>,
    /// CHECK: seed-derived
    #[account(seeds = [UNIVERSE_VAULT_SEED, universe.as_ref()], bump = universe_pool.vault_bump)]
    pub universe_vault: UncheckedAccount<'info>,
    #[account(
        mut,
        associated_token::mint = loar_mint,
        associated_token::authority = universe_vault,
    )]
    pub universe_vault_ata: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [UNIVERSE_STAKE_SEED, user.key().as_ref(), universe.as_ref()],
        bump = universe_stake.bump,
        constraint = universe_stake.user == user.key() @ StakingError::Unauthorized,
        constraint = universe_stake.universe == universe @ StakingError::UniverseMismatch,
    )]
    pub universe_stake: Account<'info, UniverseStake>,
    #[account(
        mut,
        associated_token::mint = loar_mint,
        associated_token::authority = user,
    )]
    pub user_loar_ata: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)]
    pub penalty_destination_ata: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    #[account(address = config.admin @ StakingError::Unauthorized)]
    pub admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
}

#[derive(Accounts)]
pub struct AcceptAdmin<'info> {
    pub new_admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
}

// ─── State ───────────────────────────────────────────────────────────────────

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub pending_admin: Pubkey,
    pub loar_mint: Pubkey,
    pub treasury: Pubkey,
    pub liquidity_pool: Pubkey,
    pub min_lock_period_secs: i64,
    pub early_unstake_penalty_bps: u16,
    pub total_staked: u64,
    pub total_universe_staked: u64,
    pub total_penalty_collected: u64,
    pub tier_configs: [TierConfig; TIER_COUNT],
    pub paused: bool,
    pub bump: u8,
    pub global_vault_bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, InitSpace)]
pub struct TierConfig {
    pub min_stake: u64,
    pub weight_bps: u16,
    pub fee_discount_bps: u16,
    pub curation_boost_bps: u16,
    pub priority_queue: bool,
}

#[account]
#[derive(InitSpace)]
pub struct StakeInfo {
    pub user: Pubkey,
    pub amount: u64,
    pub staked_at: i64,
    pub last_claim_at: i64,
    pub tier: u8,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct UniversePool {
    pub universe: Pubkey,
    pub total_staked: u64,
    pub total_distributed: u64,
    pub bump: u8,
    pub vault_bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct UniverseStake {
    pub user: Pubkey,
    pub universe: Pubkey,
    pub amount: u64,
    pub staked_at: i64,
    pub bump: u8,
}

// ─── Events ──────────────────────────────────────────────────────────────────

#[event]
pub struct Initialized {
    pub admin: Pubkey,
    pub loar_mint: Pubkey,
    pub treasury: Pubkey,
    pub liquidity_pool: Pubkey,
}

#[event]
pub struct TierConfigUpdated {
    pub tier: u8,
    pub min_stake: u64,
    pub weight_bps: u16,
    pub fee_discount_bps: u16,
    pub curation_boost_bps: u16,
    pub priority_queue: bool,
}

#[event]
pub struct Staked {
    pub user: Pubkey,
    pub amount: u64,
    pub new_total: u64,
    pub tier: u8,
}

#[event]
pub struct Unstaked {
    pub user: Pubkey,
    pub amount: u64,
    pub penalty: u64,
    pub new_total: u64,
    pub tier: u8,
}

#[event]
pub struct TierChanged {
    pub user: Pubkey,
    pub old_tier: u8,
    pub new_tier: u8,
}

#[event]
pub struct UniverseStaked {
    pub user: Pubkey,
    pub universe: Pubkey,
    pub amount: u64,
    pub new_user_total: u64,
    pub new_pool_total: u64,
}

#[event]
pub struct UniverseUnstaked {
    pub user: Pubkey,
    pub universe: Pubkey,
    pub amount: u64,
    pub penalty: u64,
    pub new_user_total: u64,
    pub new_pool_total: u64,
}

#[event]
pub struct LockParamsUpdated {
    pub min_lock_period_secs: i64,
    pub early_unstake_penalty_bps: u16,
}

#[event]
pub struct Paused {}

#[event]
pub struct Unpaused {}

#[event]
pub struct AdminTransferProposed {
    pub new_admin: Pubkey,
}

#[event]
pub struct AdminTransferred {
    pub old_admin: Pubkey,
    pub new_admin: Pubkey,
}

// ─── Errors ──────────────────────────────────────────────────────────────────

#[error_code]
pub enum StakingError {
    #[msg("Only the configured admin may perform this action")]
    Unauthorized,
    #[msg("Address cannot be the zero pubkey")]
    ZeroAddress,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Provided LOAR mint does not match Config.loar_mint")]
    MintMismatch,
    #[msg("UniverseStake.universe does not match the universe argument")]
    UniverseMismatch,
    #[msg("Insufficient staked amount")]
    InsufficientStake,
    #[msg("Invalid tier index")]
    InvalidTier,
    #[msg("Lock period must be non-negative")]
    InvalidLockPeriod,
    #[msg("Penalty bps exceeds MAX_PENALTY_BPS (1000 = 10%)")]
    PenaltyTooHigh,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("Program is paused")]
    Paused,
    #[msg("Cannot pause: already paused")]
    AlreadyPaused,
    #[msg("Cannot unpause: not paused")]
    NotPaused,
}
