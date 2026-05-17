//! Premium Actions — fee collector on Solana (formerly `loar_burner`).
//!
//! Sister to `apps/contracts/src/revenue/PremiumActions.sol`. The crate +
//! module + `#[program]` symbol were renamed on 2026-05-16 as part of
//! BURN-01: the "burn" framing is misleading — this program never destroys
//! supply, it splits $LOAR between an LP wallet and the DAO treasury for
//! premium actions (priority queue, permanent canon, premium profile,
//! remix boost, custom).
//!
//! On-chain compatibility preservation:
//! - `declare_id!` is unchanged (`6rXM35S…`); program ID and devnet
//!   bytecode are preserved across the rename.
//! - PDA seeds `b"burner_config"` and `b"burner_action"` are unchanged.
//!   Renaming the seeds would orphan every existing PDA on devnet — the
//!   constant names below keep the literal byte sequence.
//! - IDL `instruction`/`account`/`event` names are unchanged. Only the
//!   crate, library, and Rust module identifiers were renamed.
//!
//! v1 design simplification vs EVM:
//! - EVM has two parallel paths: a BurnAction enum (5 variants) + a custom
//!   bytes32 actionName map. We collapse both into one `ActionConfig` PDA
//!   keyed by `[u8; 32]` — predefined actions use deterministic name hashes
//!   (e.g. `sha256("PRIORITY_GENERATION")`), custom actions pass arbitrary
//!   32-byte names. Same on-chain shape, simpler accounts struct.
//! - `executeFor(user, action)` operator-on-behalf path is skipped — Solana
//!   users sign their own txs via Circle DCW; the relay-by-platform pattern
//!   isn't needed.
//!
//! Audit-relevant invariants:
//! - `transfer_checked` on every SPL move; mint+decimals integrity.
//! - LP-ratio capped at MAX_LP_RATIO_BPS = 10000 (100% to LP allowed but
//!   not above).
//! - All u64 math uses `checked_*`.
//! - `paused` blocks every execute path; admin config changes still flow
//!   so an admin can adjust prices on a paused program.

use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{
    self, Mint, TokenAccount, TokenInterface, TransferChecked,
};

declare_id!("6rXM35SaYEViEfHJmeb1cEebJcTzXgLckX5RbshPXPrN");

pub const BPS_DENOM: u64 = 10_000;
pub const MAX_LP_RATIO_BPS: u16 = 10_000;
pub const DEFAULT_LP_RATIO_BPS: u16 = 5_000; // 50%

// PDA seeds preserve the legacy `burner_*` literal bytes from the
// pre-rename loar_burner program so every existing devnet PDA stays
// addressable. Do NOT change these unless you are intentionally
// migrating off-chain state.
pub const CONFIG_SEED: &[u8] = b"burner_config";
pub const ACTION_SEED: &[u8] = b"burner_action";

#[program]
pub mod premium_actions {
    use super::*;

    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        treasury: Pubkey,
        liquidity_pool: Pubkey,
        platform: Pubkey,
        lp_ratio_bps: u16,
    ) -> Result<()> {
        require!(treasury != Pubkey::default(), BurnerError::ZeroAddress);
        require!(liquidity_pool != Pubkey::default(), BurnerError::ZeroAddress);
        require!(platform != Pubkey::default(), BurnerError::ZeroAddress);
        require!(lp_ratio_bps <= MAX_LP_RATIO_BPS, BurnerError::RatioTooHigh);

        let config = &mut ctx.accounts.config;
        config.admin = ctx.accounts.admin.key();
        config.pending_admin = Pubkey::default();
        config.platform = platform;
        config.loar_mint = ctx.accounts.loar_mint.key();
        config.treasury = treasury;
        config.liquidity_pool = liquidity_pool;
        config.lp_ratio_bps = lp_ratio_bps;
        config.total_collected = 0;
        config.total_to_lp = 0;
        config.paused = false;
        config.bump = ctx.bumps.config;

        emit!(ConfigInitialized {
            admin: config.admin,
            loar_mint: config.loar_mint,
            treasury,
            liquidity_pool,
            platform,
            lp_ratio_bps,
        });
        Ok(())
    }

    /// Configure an action's cost + active flag. Admin only. `name` is a
    /// 32-byte identifier — for the EVM predefined enum variants, use the
    /// well-known sha256 hash of the variant name.
    pub fn set_action_config(
        ctx: Context<SetActionConfig>,
        name: [u8; 32],
        cost: u64,
        active: bool,
    ) -> Result<()> {
        require!(name != [0u8; 32], BurnerError::ZeroName);
        let action = &mut ctx.accounts.action;
        if action.name == [0u8; 32] {
            action.name = name;
            action.bump = ctx.bumps.action;
        }
        action.cost = cost;
        action.active = active;
        emit!(ActionConfigUpdated { name, cost, active });
        Ok(())
    }

    /// Execute an action — user pays `cost` $LOAR from their ATA; split goes
    /// to LP and treasury per `config.lp_ratio_bps`.
    pub fn execute_action(ctx: Context<ExecuteAction>, _name: [u8; 32]) -> Result<()> {
        require!(!ctx.accounts.config.paused, BurnerError::Paused);
        let action = &mut ctx.accounts.action;
        require!(action.active, BurnerError::ActionNotActive);
        let cost = action.cost;
        require!(cost > 0, BurnerError::ZeroAmount);

        let lp_cut = (cost as u128)
            .checked_mul(ctx.accounts.config.lp_ratio_bps as u128)
            .ok_or(BurnerError::MathOverflow)?
            .checked_div(BPS_DENOM as u128)
            .ok_or(BurnerError::MathOverflow)? as u64;
        let treasury_cut = cost.checked_sub(lp_cut).ok_or(BurnerError::MathOverflow)?;

        let mint = &ctx.accounts.loar_mint;
        let decimals = mint.decimals;

        if lp_cut > 0 {
            token_interface::transfer_checked(
                CpiContext::new(
                    ctx.accounts.token_program.to_account_info(),
                    TransferChecked {
                        from: ctx.accounts.user_loar_ata.to_account_info(),
                        mint: mint.to_account_info(),
                        to: ctx.accounts.lp_ata.to_account_info(),
                        authority: ctx.accounts.user.to_account_info(),
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
                        from: ctx.accounts.user_loar_ata.to_account_info(),
                        mint: mint.to_account_info(),
                        to: ctx.accounts.treasury_ata.to_account_info(),
                        authority: ctx.accounts.user.to_account_info(),
                    },
                ),
                treasury_cut,
                decimals,
            )?;
        }

        let config = &mut ctx.accounts.config;
        config.total_collected = config
            .total_collected
            .checked_add(cost)
            .ok_or(BurnerError::MathOverflow)?;
        config.total_to_lp = config
            .total_to_lp
            .checked_add(lp_cut)
            .ok_or(BurnerError::MathOverflow)?;
        action.total_collected = action
            .total_collected
            .checked_add(cost)
            .ok_or(BurnerError::MathOverflow)?;
        action.total_count = action
            .total_count
            .checked_add(1)
            .ok_or(BurnerError::MathOverflow)?;

        emit!(ActionExecuted {
            user: ctx.accounts.user.key(),
            name: action.name,
            cost,
            to_lp: lp_cut,
            to_treasury: treasury_cut,
        });
        Ok(())
    }

    // ─── Admin ────────────────────────────────────────────────────────────

    pub fn set_lp_ratio(ctx: Context<AdminOnly>, lp_ratio_bps: u16) -> Result<()> {
        require!(lp_ratio_bps <= MAX_LP_RATIO_BPS, BurnerError::RatioTooHigh);
        let config = &mut ctx.accounts.config;
        let old = config.lp_ratio_bps;
        config.lp_ratio_bps = lp_ratio_bps;
        emit!(LpRatioUpdated { old, new_ratio: lp_ratio_bps });
        Ok(())
    }

    pub fn set_treasury(ctx: Context<AdminOnly>, treasury: Pubkey) -> Result<()> {
        require!(treasury != Pubkey::default(), BurnerError::ZeroAddress);
        let config = &mut ctx.accounts.config;
        let old = config.treasury;
        config.treasury = treasury;
        emit!(TreasuryUpdated { old, new_treasury: treasury });
        Ok(())
    }

    pub fn set_liquidity_pool(ctx: Context<AdminOnly>, lp: Pubkey) -> Result<()> {
        require!(lp != Pubkey::default(), BurnerError::ZeroAddress);
        let config = &mut ctx.accounts.config;
        let old = config.liquidity_pool;
        config.liquidity_pool = lp;
        emit!(LpUpdated { old, new_lp: lp });
        Ok(())
    }

    pub fn set_platform(ctx: Context<AdminOnly>, platform: Pubkey) -> Result<()> {
        require!(platform != Pubkey::default(), BurnerError::ZeroAddress);
        let config = &mut ctx.accounts.config;
        let old = config.platform;
        config.platform = platform;
        emit!(PlatformUpdated { old, new_platform: platform });
        Ok(())
    }

    pub fn pause(ctx: Context<AdminOnly>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(!config.paused, BurnerError::AlreadyPaused);
        config.paused = true;
        emit!(Paused {});
        Ok(())
    }

    pub fn unpause(ctx: Context<AdminOnly>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(config.paused, BurnerError::NotPaused);
        config.paused = false;
        emit!(Unpaused {});
        Ok(())
    }

    pub fn transfer_admin(ctx: Context<AdminOnly>, new_admin: Pubkey) -> Result<()> {
        require!(new_admin != Pubkey::default(), BurnerError::ZeroAddress);
        ctx.accounts.config.pending_admin = new_admin;
        emit!(AdminTransferProposed { new_admin });
        Ok(())
    }

    pub fn accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(
            config.pending_admin == ctx.accounts.new_admin.key(),
            BurnerError::Unauthorized
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
#[instruction(name: [u8; 32])]
pub struct SetActionConfig<'info> {
    #[account(mut, address = config.admin @ BurnerError::Unauthorized)]
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        init_if_needed,
        payer = admin,
        space = 8 + Action::INIT_SPACE,
        seeds = [ACTION_SEED, name.as_ref()],
        bump,
    )]
    pub action: Account<'info, Action>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(name: [u8; 32])]
pub struct ExecuteAction<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(address = config.loar_mint @ BurnerError::MintMismatch)]
    pub loar_mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        seeds = [ACTION_SEED, name.as_ref()],
        bump = action.bump,
    )]
    pub action: Account<'info, Action>,
    #[account(
        mut,
        associated_token::mint = loar_mint,
        associated_token::authority = user,
    )]
    pub user_loar_ata: InterfaceAccount<'info, TokenAccount>,
    /// LP destination — validated against config.liquidity_pool below.
    #[account(
        mut,
        token::mint = loar_mint,
        constraint = lp_ata.owner == config.liquidity_pool @ BurnerError::LpMismatch,
    )]
    pub lp_ata: InterfaceAccount<'info, TokenAccount>,
    /// Treasury destination — validated against config.treasury.
    #[account(
        mut,
        token::mint = loar_mint,
        constraint = treasury_ata.owner == config.treasury @ BurnerError::TreasuryMismatch,
    )]
    pub treasury_ata: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    #[account(address = config.admin @ BurnerError::Unauthorized)]
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
    pub platform: Pubkey,
    pub loar_mint: Pubkey,
    pub treasury: Pubkey,
    pub liquidity_pool: Pubkey,
    pub lp_ratio_bps: u16,
    pub total_collected: u64,
    pub total_to_lp: u64,
    pub paused: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Action {
    pub name: [u8; 32],
    pub cost: u64,
    pub active: bool,
    pub total_collected: u64,
    pub total_count: u64,
    pub bump: u8,
}

// ─── Events ──────────────────────────────────────────────────────────────────

#[event]
pub struct ConfigInitialized {
    pub admin: Pubkey,
    pub loar_mint: Pubkey,
    pub treasury: Pubkey,
    pub liquidity_pool: Pubkey,
    pub platform: Pubkey,
    pub lp_ratio_bps: u16,
}

#[event]
pub struct ActionConfigUpdated {
    pub name: [u8; 32],
    pub cost: u64,
    pub active: bool,
}

#[event]
pub struct ActionExecuted {
    pub user: Pubkey,
    pub name: [u8; 32],
    pub cost: u64,
    pub to_lp: u64,
    pub to_treasury: u64,
}

#[event]
pub struct LpRatioUpdated {
    pub old: u16,
    pub new_ratio: u16,
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
pub struct PlatformUpdated {
    pub old: Pubkey,
    pub new_platform: Pubkey,
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
pub enum BurnerError {
    #[msg("Only the configured admin may perform this action")]
    Unauthorized,
    #[msg("Address cannot be the zero pubkey")]
    ZeroAddress,
    #[msg("Name (action identifier) cannot be all zeros")]
    ZeroName,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Provided LOAR mint does not match Config.loar_mint")]
    MintMismatch,
    #[msg("Action is not active")]
    ActionNotActive,
    #[msg("LP ATA owner does not match Config.liquidity_pool")]
    LpMismatch,
    #[msg("Treasury ATA owner does not match Config.treasury")]
    TreasuryMismatch,
    #[msg("LP ratio exceeds 10000 bps (100%)")]
    RatioTooHigh,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("Program is paused")]
    Paused,
    #[msg("Cannot pause: already paused")]
    AlreadyPaused,
    #[msg("Cannot unpause: not paused")]
    NotPaused,
}
