//! LOAR FeeLocker — multi-token pull-pattern fee escrow on Solana.
//!
//! Sister to `apps/contracts/src/LoarFeeLocker.sol`. Whitelisted depositors
//! credit per-(owner, mint) fee balances; owners pull their accrued fees.
//!
//! v1 scope:
//! - Whitelist `Depositor` PDAs (admin-only)
//! - `store_fees(fee_owner, amount)` — depositor transfers SPL tokens in;
//!   `FeeBalance` PDA per (owner, mint) accumulates the amount.
//! - `claim()` — owner pulls their entire balance for a mint from the vault
//! - `available_fees` view is just a `FeeBalance.amount` read off-chain.
//! - Admin: pause + two-step transfer.
//!
//! Audit-relevant invariants:
//! - Depositor whitelist gates `store_fees` — random callers can't poison
//!   the locker with garbage transfers.
//! - Balance accounting is per-(owner, mint) — different tokens can't collide.
//! - `transfer_checked` on every SPL move; mint+decimals integrity.
//! - All u64 math uses `checked_*`.
//! - Vault PDA per mint, owned by `fee_locker` program — depositor sends
//!   tokens into the program-owned vault, owner pulls from it.

use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{
    self, Mint, TokenAccount, TokenInterface, TransferChecked,
};

declare_id!("AwUfDktCrNYe4PU7YSBgWG6sBVTQCZEMuYL9ZWsKWtde");

pub const CONFIG_SEED: &[u8] = b"fee_locker_config";
pub const DEPOSITOR_SEED: &[u8] = b"fee_locker_depositor";
pub const FEE_BALANCE_SEED: &[u8] = b"fee_balance";
pub const VAULT_SEED: &[u8] = b"fee_vault";

#[program]
pub mod fee_locker {
    use super::*;

    pub fn initialize_config(ctx: Context<InitializeConfig>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.admin = ctx.accounts.admin.key();
        config.pending_admin = Pubkey::default();
        config.paused = false;
        config.bump = ctx.bumps.config;
        emit!(ConfigInitialized { admin: config.admin });
        Ok(())
    }

    /// Add a depositor — only this pubkey can call `store_fees`. Admin only.
    /// Idempotent on the depositor pubkey via PDA seeds.
    pub fn add_depositor(ctx: Context<AddDepositor>, depositor_key: Pubkey) -> Result<()> {
        require!(depositor_key != Pubkey::default(), FeeLockerError::ZeroAddress);
        let rec = &mut ctx.accounts.depositor;
        rec.depositor = depositor_key;
        rec.active = true;
        rec.bump = ctx.bumps.depositor;
        emit!(DepositorAdded { depositor: depositor_key });
        Ok(())
    }

    pub fn remove_depositor(ctx: Context<RemoveDepositor>, depositor_key: Pubkey) -> Result<()> {
        require!(
            ctx.accounts.depositor.depositor == depositor_key,
            FeeLockerError::DepositorMismatch
        );
        let rec = &mut ctx.accounts.depositor;
        rec.active = false;
        emit!(DepositorRemoved { depositor: depositor_key });
        Ok(())
    }

    /// Admin closes an *already-inactive* Depositor PDA and reclaims the
    /// rent. Keeping the two-step (deactivate → close) ensures admin can't
    /// accidentally close an active depositor and that off-chain consumers
    /// see the `DepositorRemoved` event before the account vanishes.
    /// (M12 fix — rent leak in `remove_depositor`.)
    pub fn close_depositor(ctx: Context<CloseDepositor>, depositor_key: Pubkey) -> Result<()> {
        // M-3: pause gate. While paused, admin should not be able to mutate
        // depositor state (closing a Depositor PDA permanently removes the
        // historical record); align with `add_depositor` / `remove_depositor`
        // behavior. `pause` itself is still callable (`AdminOnly`), so this
        // doesn't strand any operational path — admin can unpause first.
        require!(!ctx.accounts.config.paused, FeeLockerError::Paused);
        require!(
            ctx.accounts.depositor.depositor == depositor_key,
            FeeLockerError::DepositorMismatch
        );
        require!(
            !ctx.accounts.depositor.active,
            FeeLockerError::DepositorStillActive
        );
        emit!(DepositorClosed { depositor: depositor_key });
        Ok(())
    }

    /// Depositor calls to credit `fee_owner` with `amount` of `mint`.
    /// Transfers tokens from depositor's ATA into the program-owned vault
    /// and increments the FeeBalance PDA.
    pub fn store_fees(
        ctx: Context<StoreFees>,
        fee_owner: Pubkey,
        amount: u64,
    ) -> Result<()> {
        require!(!ctx.accounts.config.paused, FeeLockerError::Paused);
        require!(amount > 0, FeeLockerError::ZeroAmount);
        require!(fee_owner != Pubkey::default(), FeeLockerError::ZeroAddress);
        require!(ctx.accounts.depositor.active, FeeLockerError::NotActiveDepositor);
        require!(
            ctx.accounts.depositor.depositor == ctx.accounts.depositor_signer.key(),
            FeeLockerError::NotActiveDepositor
        );

        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.depositor_ata.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.vault_ata.to_account_info(),
                    authority: ctx.accounts.depositor_signer.to_account_info(),
                },
            ),
            amount,
            ctx.accounts.mint.decimals,
        )?;

        let bal = &mut ctx.accounts.fee_balance;
        if bal.fee_owner == Pubkey::default() {
            bal.fee_owner = fee_owner;
            bal.mint = ctx.accounts.mint.key();
            bal.bump = ctx.bumps.fee_balance;
        }
        bal.amount = bal
            .amount
            .checked_add(amount)
            .ok_or(FeeLockerError::MathOverflow)?;
        bal.total_deposited = bal
            .total_deposited
            .checked_add(amount)
            .ok_or(FeeLockerError::MathOverflow)?;

        emit!(FeesStored {
            depositor: ctx.accounts.depositor_signer.key(),
            fee_owner,
            mint: ctx.accounts.mint.key(),
            amount,
            new_balance: bal.amount,
        });
        Ok(())
    }

    /// Owner claims their accrued fees for `mint`. Pulls full balance.
    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        let bal = &mut ctx.accounts.fee_balance;
        require!(
            bal.fee_owner == ctx.accounts.fee_owner.key(),
            FeeLockerError::Unauthorized
        );
        let amount = bal.amount;
        require!(amount > 0, FeeLockerError::NothingToClaim);

        let mint_key = ctx.accounts.mint.key();
        let bump = ctx.bumps.vault_authority;
        let seeds: &[&[u8]] = &[VAULT_SEED, mint_key.as_ref(), &[bump]];
        let signer_seeds: &[&[&[u8]]] = &[seeds];

        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.vault_ata.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.fee_owner_ata.to_account_info(),
                    authority: ctx.accounts.vault_authority.to_account_info(),
                },
                signer_seeds,
            ),
            amount,
            ctx.accounts.mint.decimals,
        )?;

        bal.amount = 0;
        bal.total_claimed = bal
            .total_claimed
            .checked_add(amount)
            .ok_or(FeeLockerError::MathOverflow)?;

        emit!(FeesClaimed {
            fee_owner: bal.fee_owner,
            mint: bal.mint,
            amount,
        });
        Ok(())
    }

    // ─── Admin ────────────────────────────────────────────────────────────

    pub fn pause(ctx: Context<AdminOnly>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(!config.paused, FeeLockerError::AlreadyPaused);
        config.paused = true;
        emit!(Paused {});
        Ok(())
    }

    pub fn unpause(ctx: Context<AdminOnly>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(config.paused, FeeLockerError::NotPaused);
        config.paused = false;
        emit!(Unpaused {});
        Ok(())
    }

    pub fn transfer_admin(ctx: Context<AdminOnly>, new_admin: Pubkey) -> Result<()> {
        require!(new_admin != Pubkey::default(), FeeLockerError::ZeroAddress);
        ctx.accounts.config.pending_admin = new_admin;
        emit!(AdminTransferProposed { new_admin });
        Ok(())
    }

    pub fn accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(
            config.pending_admin == ctx.accounts.new_admin.key(),
            FeeLockerError::Unauthorized
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
        bump,
    )]
    pub config: Account<'info, Config>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(depositor_key: Pubkey)]
pub struct AddDepositor<'info> {
    #[account(mut, address = config.admin @ FeeLockerError::Unauthorized)]
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        init_if_needed,
        payer = admin,
        space = 8 + Depositor::INIT_SPACE,
        seeds = [DEPOSITOR_SEED, depositor_key.as_ref()],
        bump,
    )]
    pub depositor: Account<'info, Depositor>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(depositor_key: Pubkey)]
pub struct RemoveDepositor<'info> {
    #[account(address = config.admin @ FeeLockerError::Unauthorized)]
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [DEPOSITOR_SEED, depositor_key.as_ref()],
        bump = depositor.bump,
    )]
    pub depositor: Account<'info, Depositor>,
}

#[derive(Accounts)]
#[instruction(depositor_key: Pubkey)]
pub struct CloseDepositor<'info> {
    #[account(mut, address = config.admin @ FeeLockerError::Unauthorized)]
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        close = admin,
        seeds = [DEPOSITOR_SEED, depositor_key.as_ref()],
        bump = depositor.bump,
    )]
    pub depositor: Account<'info, Depositor>,
}

#[derive(Accounts)]
#[instruction(fee_owner: Pubkey)]
pub struct StoreFees<'info> {
    #[account(mut)]
    pub depositor_signer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        seeds = [DEPOSITOR_SEED, depositor_signer.key().as_ref()],
        bump = depositor.bump,
    )]
    pub depositor: Account<'info, Depositor>,
    pub mint: InterfaceAccount<'info, Mint>,
    /// CHECK: PDA authority for the per-mint vault ATA.
    #[account(
        seeds = [VAULT_SEED, mint.key().as_ref()],
        bump,
    )]
    pub vault_authority: UncheckedAccount<'info>,
    #[account(
        init_if_needed,
        payer = depositor_signer,
        associated_token::mint = mint,
        associated_token::authority = vault_authority,
    )]
    pub vault_ata: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = depositor_signer,
    )]
    pub depositor_ata: InterfaceAccount<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = depositor_signer,
        space = 8 + FeeBalance::INIT_SPACE,
        seeds = [FEE_BALANCE_SEED, fee_owner.as_ref(), mint.key().as_ref()],
        bump,
    )]
    pub fee_balance: Account<'info, FeeBalance>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub fee_owner: Signer<'info>,
    pub mint: InterfaceAccount<'info, Mint>,
    /// CHECK: seed-derived
    #[account(
        seeds = [VAULT_SEED, mint.key().as_ref()],
        bump,
    )]
    pub vault_authority: UncheckedAccount<'info>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = vault_authority,
    )]
    pub vault_ata: InterfaceAccount<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = fee_owner,
        associated_token::mint = mint,
        associated_token::authority = fee_owner,
    )]
    pub fee_owner_ata: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [FEE_BALANCE_SEED, fee_owner.key().as_ref(), mint.key().as_ref()],
        bump = fee_balance.bump,
    )]
    pub fee_balance: Account<'info, FeeBalance>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    #[account(address = config.admin @ FeeLockerError::Unauthorized)]
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
    pub paused: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Depositor {
    pub depositor: Pubkey,
    pub active: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct FeeBalance {
    pub fee_owner: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub total_deposited: u64,
    pub total_claimed: u64,
    pub bump: u8,
}

// ─── Events ──────────────────────────────────────────────────────────────────

#[event]
pub struct ConfigInitialized {
    pub admin: Pubkey,
}

#[event]
pub struct DepositorAdded {
    pub depositor: Pubkey,
}

#[event]
pub struct DepositorRemoved {
    pub depositor: Pubkey,
}

#[event]
pub struct DepositorClosed {
    pub depositor: Pubkey,
}

#[event]
pub struct FeesStored {
    pub depositor: Pubkey,
    pub fee_owner: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub new_balance: u64,
}

#[event]
pub struct FeesClaimed {
    pub fee_owner: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
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
pub enum FeeLockerError {
    #[msg("Only the configured admin or owner may perform this action")]
    Unauthorized,
    #[msg("Caller is not an active depositor")]
    NotActiveDepositor,
    #[msg("Depositor argument does not match the supplied Depositor PDA")]
    DepositorMismatch,
    #[msg("Depositor is still active — call remove_depositor first")]
    DepositorStillActive,
    #[msg("Address cannot be the zero pubkey")]
    ZeroAddress,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Nothing to claim")]
    NothingToClaim,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("Program is paused")]
    Paused,
    #[msg("Cannot pause: already paused")]
    AlreadyPaused,
    #[msg("Cannot unpause: not paused")]
    NotPaused,
}
