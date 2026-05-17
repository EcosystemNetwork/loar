//! LOAR CreditManager — AI-generation credit balance + purchase on Solana.
//!
//! Sister to `apps/contracts/src/revenue/CreditManager.sol`. Tracks per-user
//! credit balances, supports purchase with SOL or $LOAR (Token-2022), and
//! exposes a rate-limited grant path for the platform key.
//!
//! v1 scope:
//! - Add/deactivate packages (admin)
//! - Purchase with SOL → credits + bonus
//! - Purchase with $LOAR → credits + bonus
//! - Spend credits (platform-only, mirrors `spendCredits` from server flow)
//! - Grant credits (platform-only, rate-limited per CREDIT-01/CREDIT-06)
//! - Admin: pause, two-step admin/platform transfer
//!
//! Deferred to v2 (clearly marked):
//! - Holder discount (universe-token-balance-gated discount). Requires
//!   passing the universe token mint + holder ATA + threshold check; the
//!   EVM `setHolderDiscount` semantics map cleanly but the account
//!   plumbing is verbose enough to merit a focused pass.
//! - Per-generation-type cost map (currently authoritative server-side;
//!   on-chain enforcement is a nice-to-have, not a parity blocker).
//!
//! Audit-relevant invariants (parallels EVM after CREDIT-* fixes):
//! - `grant_credits` enforces:
//!   * `daily_grant_limit` rolling window (CREDIT-01)
//!   * `max_grant_per_user` cumulative cap via `granted_per_user`
//!     (CREDIT-06 — spending no longer resets the cap)
//! - `platform` and `admin` are separate roles; either can be rotated
//!   independently via two-step transfers.
//! - All u64 math uses `checked_*`.
//! - `transfer_checked` on every SPL movement.

use anchor_lang::prelude::*;
use anchor_lang::system_program::{self};
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{
    self, Mint, TokenAccount, TokenInterface, TransferChecked,
};

declare_id!("71rtSGzuBENiQa1cdmBbrN5F496CGQ46TnRGbGNpQ3xs");

pub const SECONDS_PER_DAY: i64 = 24 * 60 * 60;

pub const CONFIG_SEED: &[u8] = b"credit_manager_config";
pub const SOL_VAULT_SEED: &[u8] = b"credit_sol_vault";
pub const LOAR_VAULT_SEED: &[u8] = b"credit_loar_vault";
pub const USER_CREDITS_SEED: &[u8] = b"user_credits";
pub const PACKAGE_SEED: &[u8] = b"package";

#[program]
pub mod credit_manager {
    use super::*;

    /// Initialize the singleton config + SOL/LOAR treasury vaults.
    pub fn initialize(
        ctx: Context<Initialize>,
        platform: Pubkey,
        daily_grant_limit: u64,
        max_grant_per_user: u64,
    ) -> Result<()> {
        require!(platform != Pubkey::default(), CreditError::ZeroAddress);
        let config = &mut ctx.accounts.config;
        config.admin = ctx.accounts.admin.key();
        config.pending_admin = Pubkey::default();
        config.platform = platform;
        config.pending_platform = Pubkey::default();
        config.loar_mint = ctx.accounts.loar_mint.key();
        config.daily_grant_limit = daily_grant_limit;
        config.max_grant_per_user = max_grant_per_user;
        config.current_grant_day = 0;
        config.granted_today = 0;
        config.next_package_id = 1;
        config.paused = false;
        config.bump = ctx.bumps.config;
        config.sol_vault_bump = ctx.bumps.sol_vault;
        config.loar_vault_bump = ctx.bumps.loar_vault;
        emit!(Initialized {
            admin: config.admin,
            platform,
            loar_mint: config.loar_mint,
        });
        Ok(())
    }

    /// Create a credit package. Admin-only.
    pub fn create_package(
        ctx: Context<CreatePackage>,
        name: String,
        credits: u64,
        price_lamports: u64,
        price_loar: u64,
        bonus_credits: u64,
    ) -> Result<()> {
        require!(name.len() <= 64, CreditError::NameTooLong);
        require!(credits > 0, CreditError::ZeroAmount);
        require!(
            price_lamports > 0 || price_loar > 0,
            CreditError::ZeroPrice
        );
        let config = &mut ctx.accounts.config;
        let id = config.next_package_id;
        config.next_package_id = config
            .next_package_id
            .checked_add(1)
            .ok_or(CreditError::MathOverflow)?;

        let pkg = &mut ctx.accounts.package;
        pkg.id = id;
        pkg.name = name.clone();
        pkg.credits = credits;
        pkg.price_lamports = price_lamports;
        pkg.price_loar = price_loar;
        pkg.bonus_credits = bonus_credits;
        pkg.active = true;
        pkg.bump = ctx.bumps.package;

        emit!(PackageCreated {
            package_id: id,
            name,
            credits,
            price_lamports,
            price_loar,
            bonus_credits,
        });
        Ok(())
    }

    /// Set package active flag. Admin-only.
    pub fn set_package_active(ctx: Context<UpdatePackage>, active: bool) -> Result<()> {
        let pkg = &mut ctx.accounts.package;
        pkg.active = active;
        emit!(PackageActiveChanged {
            package_id: pkg.id,
            active,
        });
        Ok(())
    }

    /// Purchase credits by paying SOL. Routes the SOL to the program's
    /// `sol_vault` PDA which the admin can sweep to treasury later.
    pub fn purchase_with_sol(ctx: Context<PurchaseWithSol>, package_id: u64) -> Result<()> {
        require!(!ctx.accounts.config.paused, CreditError::Paused);
        let pkg = &ctx.accounts.package;
        require!(pkg.id == package_id, CreditError::PackageMismatch);
        require!(pkg.active, CreditError::PackageInactive);
        require!(pkg.price_lamports > 0, CreditError::PackageNotForSol);

        // Move SOL from buyer to vault.
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.buyer.to_account_info(),
                    to: ctx.accounts.sol_vault.to_account_info(),
                },
            ),
            pkg.price_lamports,
        )?;

        let user = &mut ctx.accounts.user_credits;
        if user.user == Pubkey::default() {
            user.user = ctx.accounts.buyer.key();
            user.bump = ctx.bumps.user_credits;
        }
        let credited = pkg
            .credits
            .checked_add(pkg.bonus_credits)
            .ok_or(CreditError::MathOverflow)?;
        user.balance = user
            .balance
            .checked_add(credited)
            .ok_or(CreditError::MathOverflow)?;
        user.total_purchased = user
            .total_purchased
            .checked_add(pkg.credits)
            .ok_or(CreditError::MathOverflow)?;
        user.total_bonus_received = user
            .total_bonus_received
            .checked_add(pkg.bonus_credits)
            .ok_or(CreditError::MathOverflow)?;

        emit!(CreditsPurchasedWithSol {
            user: user.user,
            package_id,
            credits: pkg.credits,
            bonus: pkg.bonus_credits,
            paid_lamports: pkg.price_lamports,
            new_balance: user.balance,
        });
        Ok(())
    }

    /// Purchase credits by paying $LOAR (Token-2022).
    pub fn purchase_with_loar(ctx: Context<PurchaseWithLoar>, package_id: u64) -> Result<()> {
        require!(!ctx.accounts.config.paused, CreditError::Paused);
        let pkg = &ctx.accounts.package;
        require!(pkg.id == package_id, CreditError::PackageMismatch);
        require!(pkg.active, CreditError::PackageInactive);
        require!(pkg.price_loar > 0, CreditError::PackageNotForLoar);

        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.buyer_loar_ata.to_account_info(),
                    mint: ctx.accounts.loar_mint.to_account_info(),
                    to: ctx.accounts.loar_vault_ata.to_account_info(),
                    authority: ctx.accounts.buyer.to_account_info(),
                },
            ),
            pkg.price_loar,
            ctx.accounts.loar_mint.decimals,
        )?;

        let user = &mut ctx.accounts.user_credits;
        if user.user == Pubkey::default() {
            user.user = ctx.accounts.buyer.key();
            user.bump = ctx.bumps.user_credits;
        }
        let credited = pkg
            .credits
            .checked_add(pkg.bonus_credits)
            .ok_or(CreditError::MathOverflow)?;
        user.balance = user
            .balance
            .checked_add(credited)
            .ok_or(CreditError::MathOverflow)?;
        user.total_purchased = user
            .total_purchased
            .checked_add(pkg.credits)
            .ok_or(CreditError::MathOverflow)?;
        user.total_bonus_received = user
            .total_bonus_received
            .checked_add(pkg.bonus_credits)
            .ok_or(CreditError::MathOverflow)?;

        emit!(CreditsPurchasedWithLoar {
            user: user.user,
            package_id,
            credits: pkg.credits,
            bonus: pkg.bonus_credits,
            paid_loar: pkg.price_loar,
            new_balance: user.balance,
        });
        Ok(())
    }

    /// Spend credits. Platform-only. Mirrors EVM `spendCredits`.
    pub fn spend_credits(
        ctx: Context<SpendCredits>,
        amount: u64,
        generation_type: String,
    ) -> Result<()> {
        require!(!ctx.accounts.config.paused, CreditError::Paused);
        require!(amount > 0, CreditError::ZeroAmount);
        require!(generation_type.len() <= 32, CreditError::NameTooLong);

        let user = &mut ctx.accounts.user_credits;
        require!(user.balance >= amount, CreditError::InsufficientCredits);
        user.balance = user
            .balance
            .checked_sub(amount)
            .ok_or(CreditError::MathOverflow)?;
        user.total_spent = user
            .total_spent
            .checked_add(amount)
            .ok_or(CreditError::MathOverflow)?;

        emit!(CreditsSpent {
            user: user.user,
            amount,
            new_balance: user.balance,
            generation_type,
        });
        Ok(())
    }

    /// Grant credits. Platform-only. Rate-limited by daily total + per-user
    /// cumulative cap (CREDIT-01 / CREDIT-06 analog).
    pub fn grant_credits(
        ctx: Context<GrantCredits>,
        amount: u64,
        reason: String,
    ) -> Result<()> {
        require!(!ctx.accounts.config.paused, CreditError::Paused);
        require!(amount > 0, CreditError::ZeroAmount);
        require!(reason.len() <= 128, CreditError::NameTooLong);

        let config = &mut ctx.accounts.config;
        let now = Clock::get()?.unix_timestamp;
        let today = now / SECONDS_PER_DAY;

        // Daily window roll
        if today as u64 != config.current_grant_day {
            config.current_grant_day = today as u64;
            config.granted_today = 0;
        }
        let new_daily = config
            .granted_today
            .checked_add(amount)
            .ok_or(CreditError::MathOverflow)?;
        require!(
            new_daily <= config.daily_grant_limit,
            CreditError::DailyGrantLimitExceeded
        );
        config.granted_today = new_daily;

        // Per-user cumulative cap (granted_per_user, not balance)
        let user = &mut ctx.accounts.user_credits;
        if user.user == Pubkey::default() {
            user.user = ctx.accounts.recipient.key();
            user.bump = ctx.bumps.user_credits;
        }
        let new_granted = user
            .granted_total
            .checked_add(amount)
            .ok_or(CreditError::MathOverflow)?;
        require!(
            new_granted <= config.max_grant_per_user,
            CreditError::MaxGrantPerUserExceeded
        );
        user.granted_total = new_granted;
        user.balance = user
            .balance
            .checked_add(amount)
            .ok_or(CreditError::MathOverflow)?;

        emit!(CreditsGranted {
            user: user.user,
            amount,
            new_balance: user.balance,
            reason,
        });
        Ok(())
    }

    /// Sweep accrued SOL from the program-owned `sol_vault` PDA to a
    /// destination account. Admin-only. Mirrors `payment::claim_treasury_sol`.
    /// Enforces the rent-exempt floor on the vault so the runtime cannot
    /// garbage-collect the account and take the discriminator with it.
    pub fn sweep_sol(ctx: Context<SweepSol>, amount: u64) -> Result<()> {
        require!(amount > 0, CreditError::ZeroAmount);
        transfer_lamports_from_vault(
            &ctx.accounts.sol_vault.to_account_info(),
            &ctx.accounts.destination.to_account_info(),
            amount,
        )?;
        emit!(SolSwept {
            destination: ctx.accounts.destination.key(),
            amount,
        });
        Ok(())
    }

    // ─── Admin / Platform rotation ─────────────────────────────────────────

    pub fn pause(ctx: Context<AdminOnly>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(!config.paused, CreditError::AlreadyPaused);
        config.paused = true;
        emit!(Paused {});
        Ok(())
    }

    pub fn unpause(ctx: Context<AdminOnly>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(config.paused, CreditError::NotPaused);
        config.paused = false;
        emit!(Unpaused {});
        Ok(())
    }

    pub fn set_grant_limits(
        ctx: Context<AdminOnly>,
        daily_grant_limit: u64,
        max_grant_per_user: u64,
    ) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.daily_grant_limit = daily_grant_limit;
        config.max_grant_per_user = max_grant_per_user;
        emit!(GrantLimitsUpdated {
            daily_grant_limit,
            max_grant_per_user,
        });
        Ok(())
    }

    pub fn transfer_admin(ctx: Context<AdminOnly>, new_admin: Pubkey) -> Result<()> {
        require!(new_admin != Pubkey::default(), CreditError::ZeroAddress);
        ctx.accounts.config.pending_admin = new_admin;
        emit!(AdminTransferProposed { new_admin });
        Ok(())
    }

    pub fn accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(
            config.pending_admin == ctx.accounts.new_admin.key(),
            CreditError::Unauthorized
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
        require!(new_platform != Pubkey::default(), CreditError::ZeroAddress);
        ctx.accounts.config.pending_platform = new_platform;
        emit!(PlatformTransferProposed { new_platform });
        Ok(())
    }

    pub fn accept_platform(ctx: Context<AcceptPlatform>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(
            config.pending_platform == ctx.accounts.new_platform.key(),
            CreditError::Unauthorized
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
    /// SOL vault — program-owned account; lamports accrue from buyer SOL
    /// purchases. The 8-byte discriminator + InitSpace empty body keeps the
    /// account rent-exempt; lamports on top are sweepable by admin via a
    /// future `sweep_sol` ix (v2). Same shape as `payment::SolVault`.
    #[account(
        init,
        payer = admin,
        space = 8 + SolVault::INIT_SPACE,
        seeds = [SOL_VAULT_SEED],
        bump,
    )]
    pub sol_vault: Account<'info, SolVault>,
    /// CHECK: PDA authority for the LOAR token vault.
    #[account(seeds = [LOAR_VAULT_SEED], bump)]
    pub loar_vault: UncheckedAccount<'info>,
    #[account(
        init,
        payer = admin,
        associated_token::mint = loar_mint,
        associated_token::authority = loar_vault,
    )]
    pub loar_vault_ata: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(name: String)]
pub struct CreatePackage<'info> {
    #[account(mut, address = config.admin @ CreditError::Unauthorized)]
    pub admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = admin,
        space = 8 + Package::INIT_SPACE,
        seeds = [PACKAGE_SEED, &config.next_package_id.to_le_bytes()],
        bump
    )]
    pub package: Account<'info, Package>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdatePackage<'info> {
    #[account(address = config.admin @ CreditError::Unauthorized)]
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [PACKAGE_SEED, &package.id.to_le_bytes()],
        bump = package.bump,
    )]
    pub package: Account<'info, Package>,
}

#[derive(Accounts)]
#[instruction(package_id: u64)]
pub struct PurchaseWithSol<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        seeds = [PACKAGE_SEED, &package_id.to_le_bytes()],
        bump = package.bump,
    )]
    pub package: Account<'info, Package>,
    #[account(
        mut,
        seeds = [SOL_VAULT_SEED],
        bump = config.sol_vault_bump,
    )]
    pub sol_vault: Account<'info, SolVault>,
    #[account(
        init_if_needed,
        payer = buyer,
        space = 8 + UserCredits::INIT_SPACE,
        seeds = [USER_CREDITS_SEED, buyer.key().as_ref()],
        bump,
    )]
    pub user_credits: Account<'info, UserCredits>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(package_id: u64)]
pub struct PurchaseWithLoar<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(address = config.loar_mint @ CreditError::MintMismatch)]
    pub loar_mint: InterfaceAccount<'info, Mint>,
    #[account(
        seeds = [PACKAGE_SEED, &package_id.to_le_bytes()],
        bump = package.bump,
    )]
    pub package: Account<'info, Package>,
    /// CHECK: seed-derived authority for LOAR vault ATA.
    #[account(seeds = [LOAR_VAULT_SEED], bump = config.loar_vault_bump)]
    pub loar_vault: UncheckedAccount<'info>,
    #[account(
        mut,
        associated_token::mint = loar_mint,
        associated_token::authority = loar_vault,
    )]
    pub loar_vault_ata: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        associated_token::mint = loar_mint,
        associated_token::authority = buyer,
    )]
    pub buyer_loar_ata: InterfaceAccount<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = buyer,
        space = 8 + UserCredits::INIT_SPACE,
        seeds = [USER_CREDITS_SEED, buyer.key().as_ref()],
        bump,
    )]
    pub user_credits: Account<'info, UserCredits>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SpendCredits<'info> {
    #[account(address = config.platform @ CreditError::NotPlatform)]
    pub platform: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [USER_CREDITS_SEED, user_credits.user.as_ref()],
        bump = user_credits.bump,
    )]
    pub user_credits: Account<'info, UserCredits>,
}

#[derive(Accounts)]
pub struct GrantCredits<'info> {
    #[account(address = config.platform @ CreditError::NotPlatform)]
    pub platform: Signer<'info>,
    /// CHECK: Recipient of the grant; pubkey only — no data deserialized.
    pub recipient: UncheckedAccount<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + UserCredits::INIT_SPACE,
        seeds = [USER_CREDITS_SEED, recipient.key().as_ref()],
        bump,
    )]
    pub user_credits: Account<'info, UserCredits>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SweepSol<'info> {
    #[account(address = config.admin @ CreditError::Unauthorized)]
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [SOL_VAULT_SEED],
        bump = config.sol_vault_bump,
    )]
    pub sol_vault: Account<'info, SolVault>,
    /// CHECK: lamport recipient — admin picks the destination at call time.
    /// No data deserialized; balance-only manipulation.
    #[account(mut)]
    pub destination: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    #[account(address = config.admin @ CreditError::Unauthorized)]
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
    pub loar_mint: Pubkey,
    pub daily_grant_limit: u64,
    pub max_grant_per_user: u64,
    pub current_grant_day: u64,
    pub granted_today: u64,
    pub next_package_id: u64,
    pub paused: bool,
    pub bump: u8,
    pub sol_vault_bump: u8,
    pub loar_vault_bump: u8,
}

/// Empty marker — exists only to give the SOL vault PDA a program-owned
/// container so lamports above the rent-exempt minimum belong to the program.
#[account]
#[derive(InitSpace)]
pub struct SolVault {}

#[account]
#[derive(InitSpace)]
pub struct Package {
    pub id: u64,
    #[max_len(64)]
    pub name: String,
    pub credits: u64,
    pub price_lamports: u64,
    pub price_loar: u64,
    pub bonus_credits: u64,
    pub active: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct UserCredits {
    pub user: Pubkey,
    pub balance: u64,
    pub total_purchased: u64,
    pub total_spent: u64,
    pub total_bonus_received: u64,
    /// Cumulative grants — never reset by spending. Caps `max_grant_per_user`.
    pub granted_total: u64,
    pub bump: u8,
}

// ─── Events ──────────────────────────────────────────────────────────────────

#[event]
pub struct Initialized {
    pub admin: Pubkey,
    pub platform: Pubkey,
    pub loar_mint: Pubkey,
}

#[event]
pub struct PackageCreated {
    pub package_id: u64,
    pub name: String,
    pub credits: u64,
    pub price_lamports: u64,
    pub price_loar: u64,
    pub bonus_credits: u64,
}

#[event]
pub struct PackageActiveChanged {
    pub package_id: u64,
    pub active: bool,
}

#[event]
pub struct CreditsPurchasedWithSol {
    pub user: Pubkey,
    pub package_id: u64,
    pub credits: u64,
    pub bonus: u64,
    pub paid_lamports: u64,
    pub new_balance: u64,
}

#[event]
pub struct CreditsPurchasedWithLoar {
    pub user: Pubkey,
    pub package_id: u64,
    pub credits: u64,
    pub bonus: u64,
    pub paid_loar: u64,
    pub new_balance: u64,
}

#[event]
pub struct CreditsSpent {
    pub user: Pubkey,
    pub amount: u64,
    pub new_balance: u64,
    pub generation_type: String,
}

#[event]
pub struct CreditsGranted {
    pub user: Pubkey,
    pub amount: u64,
    pub new_balance: u64,
    pub reason: String,
}

#[event]
pub struct SolSwept {
    pub destination: Pubkey,
    pub amount: u64,
}

#[event]
pub struct GrantLimitsUpdated {
    pub daily_grant_limit: u64,
    pub max_grant_per_user: u64,
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
pub enum CreditError {
    #[msg("Only the configured admin may perform this action")]
    Unauthorized,
    #[msg("Only the configured platform key may perform this action")]
    NotPlatform,
    #[msg("Address cannot be the zero pubkey")]
    ZeroAddress,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Price must be greater than zero in at least one currency")]
    ZeroPrice,
    #[msg("Name exceeds the maximum length")]
    NameTooLong,
    #[msg("Provided LOAR mint does not match Config.loar_mint")]
    MintMismatch,
    #[msg("Package ID argument does not match the supplied package PDA")]
    PackageMismatch,
    #[msg("Package is inactive")]
    PackageInactive,
    #[msg("Package is not configured for SOL purchases")]
    PackageNotForSol,
    #[msg("Package is not configured for $LOAR purchases")]
    PackageNotForLoar,
    #[msg("Insufficient credit balance")]
    InsufficientCredits,
    #[msg("Daily grant limit exceeded")]
    DailyGrantLimitExceeded,
    #[msg("Per-user cumulative grant cap exceeded")]
    MaxGrantPerUserExceeded,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("Program is paused")]
    Paused,
    #[msg("Cannot pause: already paused")]
    AlreadyPaused,
    #[msg("Cannot unpause: not paused")]
    NotPaused,
    #[msg("SOL vault has insufficient lamports above the rent-exempt floor")]
    InsufficientVault,
}

/// Move lamports out of a program-owned vault PDA directly. CPI to the system
/// program won't work for a non-system-owned source, so we manipulate lamports
/// via try_borrow_mut_lamports. The rent-exempt floor is preserved so the
/// runtime can't reap the account.
fn transfer_lamports_from_vault(
    vault: &AccountInfo,
    to: &AccountInfo,
    amount: u64,
) -> Result<()> {
    let vault_balance = vault.lamports();
    let post_balance = vault_balance
        .checked_sub(amount)
        .ok_or(CreditError::InsufficientVault)?;

    let rent_min = Rent::get()?.minimum_balance(vault.data_len());
    require!(post_balance >= rent_min, CreditError::InsufficientVault);

    **vault.try_borrow_mut_lamports()? = post_balance;
    **to.try_borrow_mut_lamports()? = to
        .lamports()
        .checked_add(amount)
        .ok_or(CreditError::MathOverflow)?;
    Ok(())
}
