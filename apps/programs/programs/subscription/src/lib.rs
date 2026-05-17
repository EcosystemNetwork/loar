//! LOAR SubscriptionManager — per-universe subscription tiers on Solana.
//!
//! Sister to `apps/contracts/src/revenue/SubscriptionManager.sol`. Each
//! universe can configure up to 4 subscription tiers (FREE / BASIC / PREMIUM /
//! VIP) with monthly SOL pricing + a perks bitmask. Subscribers pay
//! `months × price_per_month`, the platform takes `platform_fee_bps`, and the
//! remainder routes to the universe creator's wallet.
//!
//! v1 scope:
//! - Configure / deactivate tier (creator-only via live `Universe.creator` lookup)
//! - Subscribe (SOL, integer months, platform fee deduction)
//! - Cancel (sets expires_at = now; no refund in v1)
//! - Admin: pause + two-step admin/platform rotation
//!
//! Deferred to v2 (clearly marked):
//! - Tier upgrade/downgrade with proration (SUB-04 fix logic). EVM's
//!   `remainingSecs * oldPrice / newPrice` is a straightforward math port;
//!   shipping in v2 alongside subscriber-count gates.
//! - $LOAR payment path — SOL only in v1.
//! - Auto-renew via Solana Pay recurring intents (separate design).
//! - Refunds on early cancel (deliberate UX choice — matches subscription
//!   conventions; can be added later as a creator-opt-in).
//!
//! Audit-relevant invariants (parallels EVM after SUB-* fixes):
//! - `pricePerMonth` capped at `MAX_PRICE_PER_MONTH_LAMPORTS` (SUB-02 analog).
//! - `months` bounded to `[1, MAX_MONTHS]` to prevent overflow + abuse
//!   (SUB-03 analog; mirrors EVM's 120-month cap).
//! - Active subscription extension by `subscribe` to the same tier adds to
//!   `expires_at`; downgrades blocked while active (SUB-01 analog).
//! - Universe creator is read live from the Universe PDA on every config
//!   write — NFT-style ownership transfer of the universe immediately
//!   reroutes subscription authority (REVENUE-01 analog).
//! - `platform_fee_bps` capped at MAX_FEE_BPS = 5000 (50%).
//! - All u64 math uses `checked_*`.

use anchor_lang::prelude::*;
use anchor_lang::system_program;
use universe::Universe;

declare_id!("Hnnkuf933sv2rEucpCLaLbXxA1zPNxTNpUsp1WX9Fwbm");

pub const BPS_DENOM: u64 = 10_000;
pub const MAX_FEE_BPS: u16 = 5_000; // 50% — matches EVM SubscriptionManager
pub const TIER_COUNT: u8 = 4; // FREE=0, BASIC=1, PREMIUM=2, VIP=3
pub const MAX_MONTHS: u8 = 120; // 10 years (EVM cap)
pub const SECONDS_PER_MONTH: i64 = 30 * 24 * 60 * 60; // 30 days
pub const MAX_PRICE_PER_MONTH_LAMPORTS: u64 = 100 * 1_000_000_000; // 100 SOL/mo, matches EVM 100 ether

pub const CONFIG_SEED: &[u8] = b"subscription_config";
pub const TIER_SEED: &[u8] = b"tier";
pub const SUBSCRIPTION_SEED: &[u8] = b"subscription";

#[program]
pub mod subscription {
    use super::*;

    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        platform: Pubkey,
        platform_fee_bps: u16,
    ) -> Result<()> {
        require!(platform != Pubkey::default(), SubError::ZeroAddress);
        require!(platform_fee_bps <= MAX_FEE_BPS, SubError::FeeTooHigh);
        let config = &mut ctx.accounts.config;
        config.admin = ctx.accounts.admin.key();
        config.pending_admin = Pubkey::default();
        config.platform = platform;
        config.pending_platform = Pubkey::default();
        config.platform_fee_bps = platform_fee_bps;
        config.paused = false;
        config.bump = ctx.bumps.config;
        emit!(ConfigInitialized {
            admin: config.admin,
            platform,
            platform_fee_bps,
        });
        Ok(())
    }

    /// Configure or update a tier for a universe. Caller must be the
    /// universe's current creator (read live from the Universe PDA).
    pub fn configure_tier(
        ctx: Context<ConfigureTier>,
        _universe: Pubkey, // present in seeds for the Tier PDA
        tier_id: u8,
        price_per_month_lamports: u64,
        perks: u8,
        credit_bonus: u16,
    ) -> Result<()> {
        require!(!ctx.accounts.config.paused, SubError::Paused);
        require!(tier_id < TIER_COUNT, SubError::InvalidTier);
        require!(
            price_per_month_lamports <= MAX_PRICE_PER_MONTH_LAMPORTS,
            SubError::PriceTooHigh
        );
        require!(
            ctx.accounts.universe_account.creator == ctx.accounts.signer.key()
                || ctx.accounts.config.platform == ctx.accounts.signer.key(),
            SubError::NotCreatorOrPlatform
        );

        let tier = &mut ctx.accounts.tier;
        if tier.tier_id == 0 && tier.universe == Pubkey::default() {
            // First write
            tier.universe = ctx.accounts.universe_account.key();
            tier.bump = ctx.bumps.tier;
        }
        tier.tier_id = tier_id;
        tier.price_per_month_lamports = price_per_month_lamports;
        tier.perks = perks;
        tier.credit_bonus = credit_bonus;
        tier.active = true;
        emit!(TierConfigured {
            universe: tier.universe,
            tier_id,
            price_per_month_lamports,
            perks,
            credit_bonus,
        });
        Ok(())
    }

    pub fn deactivate_tier(
        ctx: Context<ConfigureTier>,
        _universe: Pubkey,
        tier_id: u8,
    ) -> Result<()> {
        require!(!ctx.accounts.config.paused, SubError::Paused);
        require!(tier_id < TIER_COUNT, SubError::InvalidTier);
        require!(
            ctx.accounts.universe_account.creator == ctx.accounts.signer.key()
                || ctx.accounts.config.platform == ctx.accounts.signer.key(),
            SubError::NotCreatorOrPlatform
        );
        let tier = &mut ctx.accounts.tier;
        tier.active = false;
        emit!(TierDeactivated {
            universe: tier.universe,
            tier_id,
        });
        Ok(())
    }

    /// Subscribe (or extend) to a tier. Pays `months × price_per_month`
    /// lamports; platform fee goes to `platform` wallet, remainder to
    /// the universe creator.
    pub fn subscribe(
        ctx: Context<Subscribe>,
        _universe: Pubkey,
        tier_id: u8,
        months: u8,
    ) -> Result<()> {
        require!(!ctx.accounts.config.paused, SubError::Paused);
        require!(tier_id < TIER_COUNT, SubError::InvalidTier);
        require!(months > 0 && months <= MAX_MONTHS, SubError::InvalidMonths);

        let tier = &ctx.accounts.tier;
        require!(tier.active, SubError::TierNotActive);
        require!(tier.tier_id == tier_id, SubError::TierMismatch);

        let creator = ctx.accounts.universe_account.creator;
        require!(
            ctx.accounts.creator.key() == creator,
            SubError::CreatorMismatch
        );

        let total = (tier.price_per_month_lamports as u128)
            .checked_mul(months as u128)
            .ok_or(SubError::MathOverflow)? as u64;

        // Subscription account write — disallow downgrade on active sub
        // (SUB-01 analog). Same tier extends; different tier requires sub to
        // be inactive.
        let now = Clock::get()?.unix_timestamp;
        let sub = &mut ctx.accounts.subscription;
        let extending_existing = sub.expires_at > now;
        if extending_existing {
            require!(sub.tier_id == tier_id, SubError::TierChangeBlocked);
        } else {
            // First-time or expired — reset start.
            sub.user = ctx.accounts.subscriber.key();
            sub.universe = ctx.accounts.universe_account.key();
            sub.started_at = now;
            sub.bump = ctx.bumps.subscription;
        }
        sub.tier_id = tier_id;
        let added_secs = (months as i64).saturating_mul(SECONDS_PER_MONTH);
        let base = if extending_existing { sub.expires_at } else { now };
        sub.expires_at = base.saturating_add(added_secs);

        // Payment splits (only when there's actually a fee to charge).
        if total > 0 {
            let platform_cut = (total as u128)
                .checked_mul(ctx.accounts.config.platform_fee_bps as u128)
                .ok_or(SubError::MathOverflow)?
                .checked_div(BPS_DENOM as u128)
                .ok_or(SubError::MathOverflow)? as u64;
            let creator_cut = total
                .checked_sub(platform_cut)
                .ok_or(SubError::MathOverflow)?;

            if platform_cut > 0 {
                system_program::transfer(
                    CpiContext::new(
                        ctx.accounts.system_program.to_account_info(),
                        system_program::Transfer {
                            from: ctx.accounts.subscriber.to_account_info(),
                            to: ctx.accounts.platform_treasury.to_account_info(),
                        },
                    ),
                    platform_cut,
                )?;
            }
            if creator_cut > 0 {
                system_program::transfer(
                    CpiContext::new(
                        ctx.accounts.system_program.to_account_info(),
                        system_program::Transfer {
                            from: ctx.accounts.subscriber.to_account_info(),
                            to: ctx.accounts.creator.to_account_info(),
                        },
                    ),
                    creator_cut,
                )?;
            }
        }

        emit!(Subscribed {
            user: sub.user,
            universe: sub.universe,
            tier_id,
            months,
            paid_lamports: total,
            expires_at: sub.expires_at,
            extended: extending_existing,
        });
        Ok(())
    }

    /// Cancel a subscription — sets `expires_at = now`. No refund in v1.
    pub fn cancel_subscription(ctx: Context<CancelSubscription>, _universe: Pubkey) -> Result<()> {
        let sub = &mut ctx.accounts.subscription;
        require!(
            sub.user == ctx.accounts.subscriber.key(),
            SubError::Unauthorized
        );
        let now = Clock::get()?.unix_timestamp;
        require!(sub.expires_at > now, SubError::NoActiveSubscription);
        sub.expires_at = now;
        emit!(SubscriptionCancelled {
            user: sub.user,
            universe: sub.universe,
        });
        Ok(())
    }

    // ─── Admin ────────────────────────────────────────────────────────────

    pub fn set_platform_fee(ctx: Context<AdminOnly>, platform_fee_bps: u16) -> Result<()> {
        require!(platform_fee_bps <= MAX_FEE_BPS, SubError::FeeTooHigh);
        let config = &mut ctx.accounts.config;
        config.platform_fee_bps = platform_fee_bps;
        emit!(PlatformFeeUpdated { platform_fee_bps });
        Ok(())
    }

    pub fn pause(ctx: Context<AdminOnly>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(!config.paused, SubError::AlreadyPaused);
        config.paused = true;
        emit!(Paused {});
        Ok(())
    }

    pub fn unpause(ctx: Context<AdminOnly>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(config.paused, SubError::NotPaused);
        config.paused = false;
        emit!(Unpaused {});
        Ok(())
    }

    pub fn transfer_admin(ctx: Context<AdminOnly>, new_admin: Pubkey) -> Result<()> {
        require!(new_admin != Pubkey::default(), SubError::ZeroAddress);
        ctx.accounts.config.pending_admin = new_admin;
        emit!(AdminTransferProposed { new_admin });
        Ok(())
    }

    pub fn accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(
            config.pending_admin == ctx.accounts.new_admin.key(),
            SubError::Unauthorized
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

    pub fn transfer_platform(ctx: Context<AdminOnly>, new_platform: Pubkey) -> Result<()> {
        require!(new_platform != Pubkey::default(), SubError::ZeroAddress);
        ctx.accounts.config.pending_platform = new_platform;
        emit!(PlatformTransferProposed { new_platform });
        Ok(())
    }

    pub fn accept_platform(ctx: Context<AcceptPlatform>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(
            config.pending_platform == ctx.accounts.new_platform.key(),
            SubError::Unauthorized
        );
        let old = config.platform;
        config.platform = config.pending_platform;
        config.pending_platform = Pubkey::default();
        emit!(PlatformTransferred {
            old_platform: old,
            new_platform: config.platform,
        });
        Ok(())
    }
}

// ─── Accounts ────────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        init,
        payer = admin,
        space = 8 + Config::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump,
    )]
    pub config: Account<'info, Config>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(universe: Pubkey, tier_id: u8)]
pub struct ConfigureTier<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    /// Universe PDA from the `universe` program — Anchor's Account<Universe>
    /// constraint verifies the account is owned by the universe program, so
    /// a forged record from another program won't deserialize.
    #[account(
        constraint = universe_account.key() == universe @ SubError::UniverseMismatch,
    )]
    pub universe_account: Account<'info, Universe>,
    #[account(
        init_if_needed,
        payer = signer,
        space = 8 + Tier::INIT_SPACE,
        seeds = [TIER_SEED, universe.as_ref(), &[tier_id]],
        bump,
    )]
    pub tier: Account<'info, Tier>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(universe: Pubkey, tier_id: u8)]
pub struct Subscribe<'info> {
    #[account(mut)]
    pub subscriber: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        constraint = universe_account.key() == universe @ SubError::UniverseMismatch,
    )]
    pub universe_account: Account<'info, Universe>,
    #[account(
        seeds = [TIER_SEED, universe.as_ref(), &[tier_id]],
        bump = tier.bump,
    )]
    pub tier: Account<'info, Tier>,
    #[account(
        init_if_needed,
        payer = subscriber,
        space = 8 + Subscription::INIT_SPACE,
        seeds = [SUBSCRIPTION_SEED, subscriber.key().as_ref(), universe.as_ref()],
        bump,
    )]
    pub subscription: Account<'info, Subscription>,
    /// CHECK: Creator wallet. Validated to match `universe_account.creator`
    /// inside the handler — guards against rerouted payouts.
    #[account(mut)]
    pub creator: AccountInfo<'info>,
    /// CHECK: Platform treasury wallet — receives `platform_fee_bps` share.
    /// Constrained to `config.platform` in the account constraint.
    #[account(mut, address = config.platform @ SubError::TreasuryMismatch)]
    pub platform_treasury: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(universe: Pubkey)]
pub struct CancelSubscription<'info> {
    pub subscriber: Signer<'info>,
    #[account(
        mut,
        seeds = [SUBSCRIPTION_SEED, subscriber.key().as_ref(), universe.as_ref()],
        bump = subscription.bump,
    )]
    pub subscription: Account<'info, Subscription>,
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    #[account(address = config.admin @ SubError::Unauthorized)]
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

#[derive(Accounts)]
pub struct AcceptPlatform<'info> {
    pub new_platform: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
}

// ─── State ───────────────────────────────────────────────────────────────────

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub pending_admin: Pubkey,
    pub platform: Pubkey,
    pub pending_platform: Pubkey,
    pub platform_fee_bps: u16,
    pub paused: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Tier {
    pub universe: Pubkey,
    pub tier_id: u8,
    pub price_per_month_lamports: u64,
    /// Bitmask: early_access=1, voting_boost=2, premium_content=4, behind_scenes=8
    pub perks: u8,
    pub credit_bonus: u16,
    pub active: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Subscription {
    pub user: Pubkey,
    pub universe: Pubkey,
    pub tier_id: u8,
    pub started_at: i64,
    pub expires_at: i64,
    pub bump: u8,
}

// ─── Events ──────────────────────────────────────────────────────────────────

#[event]
pub struct ConfigInitialized {
    pub admin: Pubkey,
    pub platform: Pubkey,
    pub platform_fee_bps: u16,
}

#[event]
pub struct TierConfigured {
    pub universe: Pubkey,
    pub tier_id: u8,
    pub price_per_month_lamports: u64,
    pub perks: u8,
    pub credit_bonus: u16,
}

#[event]
pub struct TierDeactivated {
    pub universe: Pubkey,
    pub tier_id: u8,
}

#[event]
pub struct Subscribed {
    pub user: Pubkey,
    pub universe: Pubkey,
    pub tier_id: u8,
    pub months: u8,
    pub paid_lamports: u64,
    pub expires_at: i64,
    pub extended: bool,
}

#[event]
pub struct SubscriptionCancelled {
    pub user: Pubkey,
    pub universe: Pubkey,
}

#[event]
pub struct PlatformFeeUpdated {
    pub platform_fee_bps: u16,
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

#[event]
pub struct PlatformTransferProposed {
    pub new_platform: Pubkey,
}

#[event]
pub struct PlatformTransferred {
    pub old_platform: Pubkey,
    pub new_platform: Pubkey,
}

// ─── Errors ──────────────────────────────────────────────────────────────────

#[error_code]
pub enum SubError {
    #[msg("Only the configured admin may perform this action")]
    Unauthorized,
    #[msg("Caller must be the universe creator or platform")]
    NotCreatorOrPlatform,
    #[msg("Address cannot be the zero pubkey")]
    ZeroAddress,
    #[msg("tier_id must be < 4 (FREE/BASIC/PREMIUM/VIP)")]
    InvalidTier,
    #[msg("months must be in [1, 120]")]
    InvalidMonths,
    #[msg("Tier is not active")]
    TierNotActive,
    #[msg("Tier ID arg does not match the supplied Tier PDA")]
    TierMismatch,
    #[msg("Tier change on an active subscription is blocked — cancel first or wait for expiry")]
    TierChangeBlocked,
    #[msg("Universe arg does not match the supplied Universe account")]
    UniverseMismatch,
    #[msg("Creator account does not match Universe.creator")]
    CreatorMismatch,
    #[msg("Platform treasury account does not match Config.platform")]
    TreasuryMismatch,
    #[msg("No active subscription to cancel")]
    NoActiveSubscription,
    #[msg("Price per month exceeds MAX_PRICE_PER_MONTH_LAMPORTS (100 SOL)")]
    PriceTooHigh,
    #[msg("Platform fee exceeds MAX_FEE_BPS (5000 = 50%)")]
    FeeTooHigh,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("Program is paused")]
    Paused,
    #[msg("Cannot pause: already paused")]
    AlreadyPaused,
    #[msg("Cannot unpause: not paused")]
    NotPaused,
}
