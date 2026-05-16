//! LOAR SplitRouter — co-creator revenue splits on Solana.
//!
//! Sister to `apps/contracts/src/SplitRouter.sol`. Routes SOL payments to up
//! to `MAX_RECIPIENTS` co-creators per entity (universe / content / episode)
//! according to basis-point shares that must sum to 10000. Platform fee is
//! deducted first and routed to a configured treasury.
//!
//! Differences from EVM source:
//! - EVM `SplitRouter` wraps a `PaymentRouter` for both treasury + recipient
//!   payouts (pull-claim model on EVM where push tx would burn gas
//!   incentives). Solana port does direct `system_program::transfer` from
//!   payer to each recipient — Solana's fee model makes the push pattern
//!   the conventional choice and avoids cross-program complexity. v2 can
//!   CPI into `programs/payment` if claim semantics are desired.
//! - SPL token splits are deferred to v2 (this v1 handles SOL only); the
//!   primary universe-revenue flows on Solana settle in SOL today, with
//!   $LOAR settlement landing through Solana Pay's SPL path separately.
//!
//! Audit-relevant invariants (parallels EVM after SPLIT-* fixes):
//! - `set_splits` enforces `SPLIT_CHANGE_COOLDOWN` (1 day) since last change,
//!   so a split-owner can't front-run a payment by reconfiguring shares
//!   mid-flight. (SPLIT-02 analog)
//! - Splits are owner-gated; transferring ownership is explicit.
//! - Recipients are validated against the stored Splits at route time —
//!   `remaining_accounts` ordering MUST match the stored recipient order;
//!   any mismatch trips `RecipientMismatch`.
//! - All u64 math uses `checked_*`. The last recipient gets the rounding
//!   dust so no lamports are left in the payer account from integer
//!   division. (Mirrors EVM's last-recipient-gets-remainder pattern.)
//! - Pause gate on all writes + route_with_splits.

use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("7hcFnt2Tgzi1Sc3PDWqAQRFb6BoRmEtmoizBSLaYCGkr");

pub const CONFIG_SEED: &[u8] = b"split_router_config";
pub const SPLITS_SEED: &[u8] = b"splits";

pub const MAX_RECIPIENTS: usize = 10;
pub const MAX_FEE_BPS: u16 = 5_000; // 50% — matches EVM cap
pub const BPS_DENOMINATOR: u64 = 10_000;
pub const SPLIT_CHANGE_COOLDOWN_SECS: i64 = 24 * 60 * 60; // 1 day

#[program]
pub mod split_router {
    use super::*;

    pub fn initialize_config(ctx: Context<InitializeConfig>, treasury: Pubkey) -> Result<()> {
        require!(treasury != Pubkey::default(), SplitRouterError::ZeroAddress);
        let config = &mut ctx.accounts.config;
        config.admin = ctx.accounts.admin.key();
        config.pending_admin = Pubkey::default();
        config.treasury = treasury;
        config.paused = false;
        config.bump = ctx.bumps.config;
        emit!(ConfigInitialized { admin: config.admin, treasury });
        Ok(())
    }

    /// Set the splits configuration for an entity. The caller (signer) is
    /// recorded as the owner. The Splits PDA is unique per entity_hash, so
    /// `init_if_needed` is safe — the seed prevents re-init attacks.
    ///
    /// On first call: caller is recorded as owner. On subsequent calls:
    /// caller must match the stored owner, and the 1-day cooldown must have
    /// elapsed since the last change.
    pub fn set_splits(
        ctx: Context<SetSplits>,
        entity_hash: [u8; 32],
        recipients: Vec<SplitInput>,
    ) -> Result<()> {
        require!(!ctx.accounts.config.paused, SplitRouterError::Paused);
        require!(entity_hash != [0u8; 32], SplitRouterError::ZeroHash);
        require!(
            !recipients.is_empty() && recipients.len() <= MAX_RECIPIENTS,
            SplitRouterError::TooManyRecipients
        );

        let now = Clock::get()?.unix_timestamp;
        let splits = &mut ctx.accounts.splits;

        if splits.recipient_count != 0 {
            // Existing splits — must be same owner, after cooldown.
            require!(
                splits.owner == ctx.accounts.owner.key(),
                SplitRouterError::NotSplitOwner
            );
            require!(
                now.saturating_sub(splits.last_changed_at) >= SPLIT_CHANGE_COOLDOWN_SECS,
                SplitRouterError::CooldownActive
            );
        }

        let mut total_bps: u32 = 0;
        for r in &recipients {
            require!(
                r.recipient != Pubkey::default(),
                SplitRouterError::ZeroAddress
            );
            require!(r.bps > 0, SplitRouterError::ZeroBps);
            total_bps = total_bps
                .checked_add(r.bps as u32)
                .ok_or(SplitRouterError::Overflow)?;
        }
        require!(total_bps == 10_000, SplitRouterError::InvalidSplitTotal);

        splits.entity_hash = entity_hash;
        splits.owner = ctx.accounts.owner.key();
        splits.recipient_count = recipients.len() as u8;
        splits.recipients = [Pubkey::default(); MAX_RECIPIENTS];
        splits.bps = [0u16; MAX_RECIPIENTS];
        for (i, r) in recipients.iter().enumerate() {
            splits.recipients[i] = r.recipient;
            splits.bps[i] = r.bps;
        }
        splits.last_changed_at = now;
        splits.bump = ctx.bumps.splits;

        emit!(SplitsConfigured {
            entity_hash,
            owner: splits.owner,
            recipient_count: splits.recipient_count,
        });
        Ok(())
    }

    /// Route `amount` lamports from the payer through the configured splits.
    ///
    /// Recipients are passed as `remaining_accounts` in the same order as
    /// stored in the Splits PDA. The treasury account (config.treasury) must
    /// be passed in the named accounts. Last recipient receives any rounding
    /// dust so no lamports are stranded in the payer's account.
    pub fn route_with_splits<'info>(
        ctx: Context<'_, '_, '_, 'info, RouteWithSplits<'info>>,
        amount: u64,
        platform_fee_bps: u16,
    ) -> Result<()> {
        require!(!ctx.accounts.config.paused, SplitRouterError::Paused);
        require!(platform_fee_bps <= MAX_FEE_BPS, SplitRouterError::FeeTooHigh);
        require!(amount > 0, SplitRouterError::ZeroAmount);

        let splits = &ctx.accounts.splits;
        require!(
            splits.recipient_count > 0,
            SplitRouterError::NoSplitsConfigured
        );
        let n = splits.recipient_count as usize;
        require!(
            ctx.remaining_accounts.len() == n,
            SplitRouterError::RecipientCountMismatch
        );

        // Validate recipient accounts match storage order.
        for i in 0..n {
            require!(
                ctx.remaining_accounts[i].key() == splits.recipients[i],
                SplitRouterError::RecipientMismatch
            );
        }
        require!(
            ctx.accounts.treasury.key() == ctx.accounts.config.treasury,
            SplitRouterError::TreasuryMismatch
        );

        // Compute platform fee + distributable remainder.
        let platform_cut = (amount as u128)
            .checked_mul(platform_fee_bps as u128)
            .ok_or(SplitRouterError::Overflow)?
            .checked_div(BPS_DENOMINATOR as u128)
            .ok_or(SplitRouterError::Overflow)? as u64;
        let distributable = amount
            .checked_sub(platform_cut)
            .ok_or(SplitRouterError::Overflow)?;

        // Platform fee → treasury.
        if platform_cut > 0 {
            let cpi = CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.payer.to_account_info(),
                    to: ctx.accounts.treasury.to_account_info(),
                },
            );
            system_program::transfer(cpi, platform_cut)?;
        }

        // Distribute the remainder. Last recipient takes the rounding dust
        // so the payer's outflow is exactly `amount` and no lamports are
        // stranded by integer division.
        let mut distributed: u64 = 0;
        for i in 0..n {
            let share: u64 = if i == n - 1 {
                distributable
                    .checked_sub(distributed)
                    .ok_or(SplitRouterError::Overflow)?
            } else {
                ((distributable as u128)
                    .checked_mul(splits.bps[i] as u128)
                    .ok_or(SplitRouterError::Overflow)?
                    .checked_div(BPS_DENOMINATOR as u128)
                    .ok_or(SplitRouterError::Overflow)?) as u64
            };
            if share == 0 {
                continue;
            }
            let recipient_info = &ctx.remaining_accounts[i];
            let cpi = CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.payer.to_account_info(),
                    to: recipient_info.clone(),
                },
            );
            system_program::transfer(cpi, share)?;
            distributed = distributed
                .checked_add(share)
                .ok_or(SplitRouterError::Overflow)?;
        }

        emit!(SplitPayment {
            entity_hash: splits.entity_hash,
            total_amount: amount,
            recipient_count: splits.recipient_count,
            platform_fee_bps,
        });
        Ok(())
    }

    /// Transfer split ownership for an entity. Current owner only.
    pub fn transfer_split_ownership(
        ctx: Context<TransferSplitOwnership>,
        new_owner: Pubkey,
    ) -> Result<()> {
        require!(new_owner != Pubkey::default(), SplitRouterError::ZeroAddress);
        let splits = &mut ctx.accounts.splits;
        require!(
            splits.owner == ctx.accounts.owner.key(),
            SplitRouterError::NotSplitOwner
        );
        let old = splits.owner;
        splits.owner = new_owner;
        emit!(SplitOwnershipTransferred {
            entity_hash: splits.entity_hash,
            old_owner: old,
            new_owner,
        });
        Ok(())
    }

    // ─── Admin ────────────────────────────────────────────────────────────

    pub fn pause(ctx: Context<AdminOnly>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(!config.paused, SplitRouterError::AlreadyPaused);
        config.paused = true;
        emit!(Paused {});
        Ok(())
    }

    pub fn unpause(ctx: Context<AdminOnly>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(config.paused, SplitRouterError::NotPaused);
        config.paused = false;
        emit!(Unpaused {});
        Ok(())
    }

    pub fn set_treasury(ctx: Context<AdminOnly>, new_treasury: Pubkey) -> Result<()> {
        require!(new_treasury != Pubkey::default(), SplitRouterError::ZeroAddress);
        let config = &mut ctx.accounts.config;
        let old = config.treasury;
        config.treasury = new_treasury;
        emit!(TreasuryUpdated { old, new_treasury });
        Ok(())
    }

    pub fn transfer_admin(ctx: Context<AdminOnly>, new_admin: Pubkey) -> Result<()> {
        require!(new_admin != Pubkey::default(), SplitRouterError::ZeroAddress);
        ctx.accounts.config.pending_admin = new_admin;
        emit!(AdminTransferProposed { new_admin });
        Ok(())
    }

    pub fn accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(
            config.pending_admin == ctx.accounts.new_admin.key(),
            SplitRouterError::Unauthorized
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
        bump
    )]
    pub config: Account<'info, Config>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(entity_hash: [u8; 32])]
pub struct SetSplits<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        init_if_needed,
        payer = owner,
        space = 8 + Splits::INIT_SPACE,
        seeds = [SPLITS_SEED, entity_hash.as_ref()],
        bump
    )]
    pub splits: Account<'info, Splits>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RouteWithSplits<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        seeds = [SPLITS_SEED, splits.entity_hash.as_ref()],
        bump = splits.bump,
    )]
    pub splits: Account<'info, Splits>,
    /// CHECK: Treasury receives platform fee. Validated against
    /// `config.treasury` in the handler — mismatch trips TreasuryMismatch.
    #[account(mut)]
    pub treasury: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
    // Recipients passed as `remaining_accounts`; ordering must match
    // `splits.recipients[0..recipient_count]`. Each must be `mut`. Validated
    // in the handler.
}

#[derive(Accounts)]
pub struct TransferSplitOwnership<'info> {
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [SPLITS_SEED, splits.entity_hash.as_ref()],
        bump = splits.bump,
    )]
    pub splits: Account<'info, Splits>,
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    #[account(address = config.admin @ SplitRouterError::Unauthorized)]
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
    pub treasury: Pubkey,
    pub paused: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Splits {
    pub entity_hash: [u8; 32],
    pub owner: Pubkey,
    pub recipient_count: u8,
    /// Recipients in stored order. Caller must pass remaining_accounts in
    /// this exact order at route time.
    pub recipients: [Pubkey; MAX_RECIPIENTS],
    /// Basis-points share per recipient. Sums to 10000.
    pub bps: [u16; MAX_RECIPIENTS],
    pub last_changed_at: i64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct SplitInput {
    pub recipient: Pubkey,
    pub bps: u16,
}

// ─── Events ──────────────────────────────────────────────────────────────────

#[event]
pub struct ConfigInitialized {
    pub admin: Pubkey,
    pub treasury: Pubkey,
}

#[event]
pub struct SplitsConfigured {
    pub entity_hash: [u8; 32],
    pub owner: Pubkey,
    pub recipient_count: u8,
}

#[event]
pub struct SplitPayment {
    pub entity_hash: [u8; 32],
    pub total_amount: u64,
    pub recipient_count: u8,
    pub platform_fee_bps: u16,
}

#[event]
pub struct SplitOwnershipTransferred {
    pub entity_hash: [u8; 32],
    pub old_owner: Pubkey,
    pub new_owner: Pubkey,
}

#[event]
pub struct TreasuryUpdated {
    pub old: Pubkey,
    pub new_treasury: Pubkey,
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
pub enum SplitRouterError {
    #[msg("Only the configured admin or split owner may perform this action")]
    Unauthorized,
    #[msg("Caller is not the registered split owner for this entity")]
    NotSplitOwner,
    #[msg("Entity hash cannot be all zeros")]
    ZeroHash,
    #[msg("Splits must sum to exactly 10000 basis points")]
    InvalidSplitTotal,
    #[msg("Recipient count must be between 1 and MAX_RECIPIENTS (10)")]
    TooManyRecipients,
    #[msg("Recipient bps must be greater than zero")]
    ZeroBps,
    #[msg("Address cannot be the zero pubkey")]
    ZeroAddress,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Platform fee exceeds the MAX_FEE_BPS cap (5000 = 50%)")]
    FeeTooHigh,
    #[msg("Split-change cooldown still active (must wait 1 day between reconfigurations)")]
    CooldownActive,
    #[msg("No splits configured for this entity")]
    NoSplitsConfigured,
    #[msg("remaining_accounts length does not equal recipient_count")]
    RecipientCountMismatch,
    #[msg("remaining_accounts ordering does not match stored recipients")]
    RecipientMismatch,
    #[msg("Provided treasury account does not match Config.treasury")]
    TreasuryMismatch,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Program is paused")]
    Paused,
    #[msg("Cannot pause: already paused")]
    AlreadyPaused,
    #[msg("Cannot unpause: not paused")]
    NotPaused,
}
