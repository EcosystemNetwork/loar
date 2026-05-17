//! LOAR RemixFees — derivative-content royalty layer on Solana.
//!
//! Sister to `apps/contracts/src/revenue/RemixFees.sol`. Every time someone
//! remixes content from another creator's universe, a $LOAR fee is collected
//! and split three ways: original creator (default 70%), LP (20%), DAO
//! treasury (10%). Universe creators can override the per-universe fee
//! amount; platform sets default + minimum.
//!
//! v1 scope:
//! - Universe-level fee config (custom or default) — creator-only set via
//!   live Universe.creator read
//! - `charge_remix_fee` — atomic 3-way SPL split via `transfer_checked`
//! - Admin: set defaults / split ratios / treasury+LP wallets / pause
//!
//! Audit-relevant invariants (parallels EVM after REMIX-* / REVENUE-01 fixes):
//! - `creator_share_bps + lp_share_bps + treasury_share_bps` MUST sum to
//!   10000; updates atomic via a single `set_split_bps` ix.
//! - Universe creator read live from Universe PDA on every config write —
//!   NFT-style ownership transfer rotates fee authority immediately.
//! - `min_remix_fee` floor prevents race-to-zero competitive undercutting.
//! - `transfer_checked` enforces mint+decimals integrity on every SPL move.
//! - All u64 math uses `checked_*`.

use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{
    self, Mint, TokenAccount, TokenInterface, TransferChecked,
};
use universe::Universe;

declare_id!("5JdzozEXeto8CRgUZmLqrtwkGtt8smpaM4vhahW1gNLs");

pub const BPS_DENOM: u32 = 10_000;
pub const MAX_FEE_BPS: u16 = 10_000; // sums to 100% across three recipients

pub const CONFIG_SEED: &[u8] = b"remix_fees_config";
pub const UNIVERSE_FEE_SEED: &[u8] = b"universe_fee";

#[program]
pub mod remix_fees {
    use super::*;

    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        treasury: Pubkey,
        liquidity_pool: Pubkey,
        default_remix_fee: u64,
        min_remix_fee: u64,
        creator_share_bps: u16,
        lp_share_bps: u16,
        treasury_share_bps: u16,
    ) -> Result<()> {
        require!(treasury != Pubkey::default(), RemixError::ZeroAddress);
        require!(liquidity_pool != Pubkey::default(), RemixError::ZeroAddress);
        require!(default_remix_fee >= min_remix_fee, RemixError::FeeBelowMin);
        validate_split(creator_share_bps, lp_share_bps, treasury_share_bps)?;

        let config = &mut ctx.accounts.config;
        config.admin = ctx.accounts.admin.key();
        config.pending_admin = Pubkey::default();
        config.loar_mint = ctx.accounts.loar_mint.key();
        config.treasury = treasury;
        config.liquidity_pool = liquidity_pool;
        config.default_remix_fee = default_remix_fee;
        config.min_remix_fee = min_remix_fee;
        config.creator_share_bps = creator_share_bps;
        config.lp_share_bps = lp_share_bps;
        config.treasury_share_bps = treasury_share_bps;
        config.total_remix_fees = 0;
        config.total_remixes = 0;
        config.paused = false;
        config.bump = ctx.bumps.config;

        emit!(ConfigInitialized {
            admin: config.admin,
            loar_mint: config.loar_mint,
            treasury,
            liquidity_pool,
            default_remix_fee,
            min_remix_fee,
            creator_share_bps,
            lp_share_bps,
            treasury_share_bps,
        });
        Ok(())
    }

    /// Set a per-universe remix fee. Caller must be the universe's current
    /// creator (read live from Universe PDA) OR the admin.
    pub fn set_universe_fee(
        ctx: Context<SetUniverseFee>,
        _universe: Pubkey,
        fee: u64,
    ) -> Result<()> {
        require!(!ctx.accounts.config.paused, RemixError::Paused);
        require!(fee >= ctx.accounts.config.min_remix_fee, RemixError::FeeBelowMin);
        require!(
            ctx.accounts.signer.key() == ctx.accounts.universe_account.creator
                || ctx.accounts.signer.key() == ctx.accounts.config.admin,
            RemixError::NotCreatorOrAdmin,
        );
        let cfg = &mut ctx.accounts.universe_fee;
        if cfg.universe == Pubkey::default() {
            cfg.universe = ctx.accounts.universe_account.key();
            cfg.bump = ctx.bumps.universe_fee;
        }
        cfg.fee = fee;
        cfg.custom_fee = true;
        emit!(UniverseFeeUpdated {
            universe: cfg.universe,
            fee,
        });
        Ok(())
    }

    /// Pay the remix fee for content from `universe`. Splits 3 ways:
    ///   - creator share → `original_creator` ATA
    ///   - LP share      → `liquidity_pool` ATA
    ///   - treasury      → `treasury` ATA
    ///
    /// Uses `universe_fee.fee` when custom set, else `config.default_remix_fee`.
    pub fn charge_remix_fee(
        ctx: Context<ChargeRemixFee>,
        _universe: Pubkey,
        content_hash: [u8; 32],
    ) -> Result<()> {
        require!(!ctx.accounts.config.paused, RemixError::Paused);
        require!(content_hash != [0u8; 32], RemixError::ZeroHash);

        let universe_pubkey = ctx.accounts.universe_account.key();
        let original_creator_pubkey = ctx.accounts.universe_account.creator;
        require!(
            ctx.accounts.original_creator.key() == original_creator_pubkey,
            RemixError::CreatorMismatch,
        );
        require!(
            ctx.accounts.treasury_ata.owner == ctx.accounts.config.treasury,
            RemixError::TreasuryMismatch,
        );
        require!(
            ctx.accounts.lp_ata.owner == ctx.accounts.config.liquidity_pool,
            RemixError::LpMismatch,
        );

        let fee = if ctx.accounts.universe_fee.custom_fee {
            ctx.accounts.universe_fee.fee
        } else {
            ctx.accounts.config.default_remix_fee
        };
        require!(fee >= ctx.accounts.config.min_remix_fee, RemixError::FeeBelowMin);

        let creator_cut = mul_bps(fee, ctx.accounts.config.creator_share_bps as u32)?;
        let lp_cut = mul_bps(fee, ctx.accounts.config.lp_share_bps as u32)?;
        // Treasury gets the rounding dust to keep payer-out = fee.
        let treasury_cut = fee
            .checked_sub(creator_cut)
            .ok_or(RemixError::MathOverflow)?
            .checked_sub(lp_cut)
            .ok_or(RemixError::MathOverflow)?;

        let mint = &ctx.accounts.loar_mint;
        let decimals = mint.decimals;

        if creator_cut > 0 {
            token_interface::transfer_checked(
                CpiContext::new(
                    ctx.accounts.token_program.to_account_info(),
                    TransferChecked {
                        from: ctx.accounts.remixer_ata.to_account_info(),
                        mint: mint.to_account_info(),
                        to: ctx.accounts.creator_ata.to_account_info(),
                        authority: ctx.accounts.remixer.to_account_info(),
                    },
                ),
                creator_cut,
                decimals,
            )?;
        }
        if lp_cut > 0 {
            token_interface::transfer_checked(
                CpiContext::new(
                    ctx.accounts.token_program.to_account_info(),
                    TransferChecked {
                        from: ctx.accounts.remixer_ata.to_account_info(),
                        mint: mint.to_account_info(),
                        to: ctx.accounts.lp_ata.to_account_info(),
                        authority: ctx.accounts.remixer.to_account_info(),
                    },
                ),
                lp_cut,
                decimals,
            )?;
        }
        if treasury_cut > 0 {
            token_interface::transfer_checked(
                CpiContext::new(
                    ctx.accounts.token_program.to_account_info(),
                    TransferChecked {
                        from: ctx.accounts.remixer_ata.to_account_info(),
                        mint: mint.to_account_info(),
                        to: ctx.accounts.treasury_ata.to_account_info(),
                        authority: ctx.accounts.remixer.to_account_info(),
                    },
                ),
                treasury_cut,
                decimals,
            )?;
        }

        let config = &mut ctx.accounts.config;
        config.total_remix_fees = config
            .total_remix_fees
            .checked_add(fee)
            .ok_or(RemixError::MathOverflow)?;
        config.total_remixes = config
            .total_remixes
            .checked_add(1)
            .ok_or(RemixError::MathOverflow)?;

        emit!(RemixFeeCharged {
            remixer: ctx.accounts.remixer.key(),
            original_creator: original_creator_pubkey,
            universe: universe_pubkey,
            content_hash,
            fee,
            to_creator: creator_cut,
            to_lp: lp_cut,
            to_treasury: treasury_cut,
        });
        Ok(())
    }

    // ─── Admin ────────────────────────────────────────────────────────────

    pub fn set_default_fee(ctx: Context<AdminOnly>, default_fee: u64) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(default_fee >= config.min_remix_fee, RemixError::FeeBelowMin);
        config.default_remix_fee = default_fee;
        emit!(DefaultFeeUpdated { default_fee });
        Ok(())
    }

    pub fn set_min_fee(ctx: Context<AdminOnly>, min_fee: u64) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.min_remix_fee = min_fee;
        if config.default_remix_fee < min_fee {
            config.default_remix_fee = min_fee;
        }
        emit!(MinFeeUpdated { min_fee });
        Ok(())
    }

    pub fn set_split_bps(
        ctx: Context<AdminOnly>,
        creator_share_bps: u16,
        lp_share_bps: u16,
        treasury_share_bps: u16,
    ) -> Result<()> {
        validate_split(creator_share_bps, lp_share_bps, treasury_share_bps)?;
        let config = &mut ctx.accounts.config;
        config.creator_share_bps = creator_share_bps;
        config.lp_share_bps = lp_share_bps;
        config.treasury_share_bps = treasury_share_bps;
        emit!(SplitUpdated {
            creator_share_bps,
            lp_share_bps,
            treasury_share_bps,
        });
        Ok(())
    }

    pub fn set_treasury(ctx: Context<AdminOnly>, treasury: Pubkey) -> Result<()> {
        require!(treasury != Pubkey::default(), RemixError::ZeroAddress);
        let config = &mut ctx.accounts.config;
        let old = config.treasury;
        config.treasury = treasury;
        emit!(TreasuryUpdated { old, new_treasury: treasury });
        Ok(())
    }

    pub fn set_liquidity_pool(ctx: Context<AdminOnly>, lp: Pubkey) -> Result<()> {
        require!(lp != Pubkey::default(), RemixError::ZeroAddress);
        let config = &mut ctx.accounts.config;
        let old = config.liquidity_pool;
        config.liquidity_pool = lp;
        emit!(LpUpdated { old, new_lp: lp });
        Ok(())
    }

    pub fn pause(ctx: Context<AdminOnly>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(!config.paused, RemixError::AlreadyPaused);
        config.paused = true;
        emit!(Paused {});
        Ok(())
    }

    pub fn unpause(ctx: Context<AdminOnly>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(config.paused, RemixError::NotPaused);
        config.paused = false;
        emit!(Unpaused {});
        Ok(())
    }

    pub fn transfer_admin(ctx: Context<AdminOnly>, new_admin: Pubkey) -> Result<()> {
        require!(new_admin != Pubkey::default(), RemixError::ZeroAddress);
        ctx.accounts.config.pending_admin = new_admin;
        emit!(AdminTransferProposed { new_admin });
        Ok(())
    }

    pub fn accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(
            config.pending_admin == ctx.accounts.new_admin.key(),
            RemixError::Unauthorized
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

fn mul_bps(amount: u64, bps: u32) -> Result<u64> {
    let r = (amount as u128)
        .checked_mul(bps as u128)
        .ok_or(RemixError::MathOverflow)?
        .checked_div(BPS_DENOM as u128)
        .ok_or(RemixError::MathOverflow)?;
    Ok(r as u64)
}

fn validate_split(creator: u16, lp: u16, treasury: u16) -> Result<()> {
    let total = (creator as u32)
        .checked_add(lp as u32)
        .and_then(|s| s.checked_add(treasury as u32))
        .ok_or(RemixError::MathOverflow)?;
    require!(total == BPS_DENOM, RemixError::InvalidSplitTotal);
    Ok(())
}

// ─── Accounts ────────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    pub loar_mint: InterfaceAccount<'info, Mint>,
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
#[instruction(universe: Pubkey)]
pub struct SetUniverseFee<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        constraint = universe_account.key() == universe @ RemixError::UniverseMismatch,
    )]
    pub universe_account: Account<'info, Universe>,
    #[account(
        init_if_needed,
        payer = signer,
        space = 8 + UniverseFee::INIT_SPACE,
        seeds = [UNIVERSE_FEE_SEED, universe.as_ref()],
        bump,
    )]
    pub universe_fee: Account<'info, UniverseFee>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(universe: Pubkey)]
pub struct ChargeRemixFee<'info> {
    #[account(mut)]
    pub remixer: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(address = config.loar_mint @ RemixError::MintMismatch)]
    pub loar_mint: InterfaceAccount<'info, Mint>,
    #[account(
        constraint = universe_account.key() == universe @ RemixError::UniverseMismatch,
    )]
    pub universe_account: Account<'info, Universe>,
    /// Optional per-universe fee override. Default-state account works fine
    /// when the universe hasn't set a custom fee (custom_fee = false).
    #[account(
        init_if_needed,
        payer = remixer,
        space = 8 + UniverseFee::INIT_SPACE,
        seeds = [UNIVERSE_FEE_SEED, universe.as_ref()],
        bump,
    )]
    pub universe_fee: Account<'info, UniverseFee>,

    /// Remixer's $LOAR ATA (source).
    #[account(
        mut,
        associated_token::mint = loar_mint,
        associated_token::authority = remixer,
    )]
    pub remixer_ata: InterfaceAccount<'info, TokenAccount>,

    /// CHECK: Original creator's wallet pubkey. Validated to match
    /// `universe_account.creator` in handler.
    pub original_creator: AccountInfo<'info>,
    #[account(
        mut,
        associated_token::mint = loar_mint,
        associated_token::authority = original_creator,
    )]
    pub creator_ata: InterfaceAccount<'info, TokenAccount>,

    /// LP ATA receives lp_cut. `lp_ata.owner` is validated to match
    /// `config.liquidity_pool` in handler.
    #[account(mut, token::mint = loar_mint)]
    pub lp_ata: InterfaceAccount<'info, TokenAccount>,

    /// Treasury ATA receives treasury_cut. `treasury_ata.owner` is validated
    /// to match `config.treasury` in handler.
    #[account(mut, token::mint = loar_mint)]
    pub treasury_ata: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    #[account(address = config.admin @ RemixError::Unauthorized)]
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
    pub default_remix_fee: u64,
    pub min_remix_fee: u64,
    pub creator_share_bps: u16,
    pub lp_share_bps: u16,
    pub treasury_share_bps: u16,
    pub total_remix_fees: u64,
    pub total_remixes: u64,
    pub paused: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct UniverseFee {
    pub universe: Pubkey,
    pub fee: u64,
    pub custom_fee: bool,
    pub bump: u8,
}

// ─── Events ──────────────────────────────────────────────────────────────────

#[event]
pub struct ConfigInitialized {
    pub admin: Pubkey,
    pub loar_mint: Pubkey,
    pub treasury: Pubkey,
    pub liquidity_pool: Pubkey,
    pub default_remix_fee: u64,
    pub min_remix_fee: u64,
    pub creator_share_bps: u16,
    pub lp_share_bps: u16,
    pub treasury_share_bps: u16,
}

#[event]
pub struct UniverseFeeUpdated {
    pub universe: Pubkey,
    pub fee: u64,
}

#[event]
pub struct RemixFeeCharged {
    pub remixer: Pubkey,
    pub original_creator: Pubkey,
    pub universe: Pubkey,
    pub content_hash: [u8; 32],
    pub fee: u64,
    pub to_creator: u64,
    pub to_lp: u64,
    pub to_treasury: u64,
}

#[event]
pub struct DefaultFeeUpdated {
    pub default_fee: u64,
}

#[event]
pub struct MinFeeUpdated {
    pub min_fee: u64,
}

#[event]
pub struct SplitUpdated {
    pub creator_share_bps: u16,
    pub lp_share_bps: u16,
    pub treasury_share_bps: u16,
}

#[event]
pub struct TreasuryUpdated {
    pub old: Pubkey,
    pub new_treasury: Pubkey,
}

#[event]
pub struct LpUpdated {
    pub old: Pubkey,
    pub new_lp: Pubkey,
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
pub enum RemixError {
    #[msg("Only the configured admin may perform this action")]
    Unauthorized,
    #[msg("Caller must be the universe creator or admin")]
    NotCreatorOrAdmin,
    #[msg("Address cannot be the zero pubkey")]
    ZeroAddress,
    #[msg("Content hash cannot be all zeros")]
    ZeroHash,
    #[msg("Fee is below the configured minimum")]
    FeeBelowMin,
    #[msg("Split shares must sum to exactly 10000 basis points")]
    InvalidSplitTotal,
    #[msg("Provided LOAR mint does not match Config.loar_mint")]
    MintMismatch,
    #[msg("Universe argument does not match supplied Universe account")]
    UniverseMismatch,
    #[msg("Original creator pubkey does not match Universe.creator")]
    CreatorMismatch,
    #[msg("Treasury ATA owner does not match Config.treasury")]
    TreasuryMismatch,
    #[msg("LP ATA owner does not match Config.liquidity_pool")]
    LpMismatch,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("Program is paused")]
    Paused,
    #[msg("Cannot pause: already paused")]
    AlreadyPaused,
    #[msg("Cannot unpause: not paused")]
    NotPaused,
}
