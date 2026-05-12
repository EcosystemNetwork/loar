//! LOAR Payment — Solana sister to apps/contracts/src/PaymentRouter.sol.
//!
//! Routes SOL and SPL ($LOAR) payments with a configurable platform fee. Two
//! pull-style accumulators per creator (one for SOL, one for $LOAR) match the
//! `claimable` / `claimableLoar` mappings in the EVM router. Treasury fees
//! accrue in singleton config counters and are pulled by the owner.
//!
//! Audit-relevant invariants:
//! - Two-step ownership transfer (propose → accept) prevents accidental key
//!   loss to a typo'd address.
//! - `MAX_FEE_BPS = 1_000` (10%) hard cap on `default_fee_bps`; per-call
//!   `fee_bps_override` is also capped on every routing entrypoint.
//! - `loar_fee_discount_bps` is `saturating_sub`'d, never panics on
//!   discount > fee.
//! - `pause` blocks every routing path; claims remain open so creators can
//!   exit if the router is frozen.
//! - `lock_loar_mint` is a one-way switch — once set, the LOAR mint can never
//!   change. Lets integrators trust the SPL mint over the lifetime of the
//!   program without watching an upgrade authority.
//! - All accumulator math uses `checked_add` / `checked_sub`; overflow is a
//!   hard error, not silent wrap.
//! - SPL transfers use `transfer_checked` exclusively (legacy `transfer` is
//!   never invoked) so we get the mint+decimals integrity check on every
//!   token movement. Works against both classic SPL and Token-2022 via
//!   `token_interface`.
//! - Treasury & vault SOL movements use direct lamport manipulation on
//!   program-owned accounts; no `system_program::transfer` CPI from PDAs
//!   (which Solana disallows for program-owned accounts).

use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{
    self, Mint, TokenAccount, TokenInterface, TransferChecked,
};

declare_id!("9xWo4djcHmGFkJnLQF9phdpsUhj6BQFW6yR8sHUsKVbj");

pub const BPS_DENOM: u64 = 10_000;
pub const MAX_FEE_BPS: u16 = 1_000; // 10% — hard cap, matches EVM PaymentRouter

pub const CONFIG_SEED: &[u8] = b"config";
pub const SOL_VAULT_SEED: &[u8] = b"sol_vault";
pub const LOAR_VAULT_SEED: &[u8] = b"loar_vault";
pub const CLAIM_SOL_SEED: &[u8] = b"claim_sol";
pub const CLAIM_LOAR_SEED: &[u8] = b"claim_loar";

#[program]
pub mod payment {
    use super::*;

    /// Initialize the singleton config. Callable exactly once.
    pub fn initialize(
        ctx: Context<Initialize>,
        treasury: Pubkey,
        default_fee_bps: u16,
    ) -> Result<()> {
        require!(default_fee_bps <= MAX_FEE_BPS, PaymentError::FeeTooHigh);
        require!(treasury != Pubkey::default(), PaymentError::ZeroAddress);

        let config = &mut ctx.accounts.config;
        config.owner = ctx.accounts.owner.key();
        config.pending_owner = Pubkey::default();
        config.treasury = treasury;
        config.default_fee_bps = default_fee_bps;
        config.loar_mint = Pubkey::default();
        config.loar_fee_discount_bps = 0;
        config.loar_locked = false;
        config.paused = false;
        config.treasury_claimable_sol = 0;
        config.treasury_claimable_loar = 0;
        config.bump = ctx.bumps.config;
        config.sol_vault_bump = ctx.bumps.sol_vault;
        config.loar_vault_bump = ctx.bumps.loar_vault;

        emit!(Initialized {
            owner: config.owner,
            treasury,
            default_fee_bps,
        });
        Ok(())
    }

    // ─── Routing — SOL ────────────────────────────────────────────────────

    /// Route SOL: split between creator (accrues) and treasury (accrues).
    /// `fee_bps_override` lets a caller pin the platform fee; uses
    /// `config.default_fee_bps` when `None`.
    pub fn route(
        ctx: Context<Route>,
        amount: u64,
        fee_bps_override: Option<u16>,
    ) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(!config.paused, PaymentError::Paused);
        require!(amount > 0, PaymentError::ZeroAmount);

        let fee_bps = fee_bps_override.unwrap_or(config.default_fee_bps);
        require!(fee_bps <= MAX_FEE_BPS, PaymentError::FeeTooHigh);

        let platform = mul_bps(amount, fee_bps as u64)?;
        let creator_amount = amount
            .checked_sub(platform)
            .ok_or(PaymentError::MathOverflow)?;

        // Move payer → sol_vault (system CPI; payer is a user-owned account).
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.payer.to_account_info(),
                    to: ctx.accounts.sol_vault.to_account_info(),
                },
            ),
            amount,
        )?;

        // Accrue creator share.
        let claim = &mut ctx.accounts.claim_sol;
        if claim.creator == Pubkey::default() {
            claim.creator = ctx.accounts.creator.key();
            claim.bump = ctx.bumps.claim_sol;
        }
        claim.amount = claim
            .amount
            .checked_add(creator_amount)
            .ok_or(PaymentError::MathOverflow)?;

        // Accrue treasury share.
        config.treasury_claimable_sol = config
            .treasury_claimable_sol
            .checked_add(platform)
            .ok_or(PaymentError::MathOverflow)?;

        emit!(PaymentRouted {
            creator: ctx.accounts.creator.key(),
            creator_amount,
            platform_amount: platform,
            fee_bps,
            currency: Currency::Sol,
        });
        Ok(())
    }

    /// Route SOL with 100% to treasury (e.g. credit purchases, ad spend).
    pub fn route_to_treasury(ctx: Context<RouteToTreasury>, amount: u64) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(!config.paused, PaymentError::Paused);
        require!(amount > 0, PaymentError::ZeroAmount);

        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.payer.to_account_info(),
                    to: ctx.accounts.sol_vault.to_account_info(),
                },
            ),
            amount,
        )?;

        config.treasury_claimable_sol = config
            .treasury_claimable_sol
            .checked_add(amount)
            .ok_or(PaymentError::MathOverflow)?;

        emit!(PaymentRouted {
            creator: config.treasury,
            creator_amount: 0,
            platform_amount: amount,
            fee_bps: BPS_DENOM as u16, // 10_000 == "all to treasury" sentinel
            currency: Currency::Sol,
        });
        Ok(())
    }

    /// Creator pulls their accrued SOL.
    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        let claim = &mut ctx.accounts.claim_sol;
        let amount = claim.amount;
        require!(amount > 0, PaymentError::NothingToClaim);
        require!(
            claim.creator == ctx.accounts.creator.key(),
            PaymentError::Unauthorized
        );

        claim.amount = 0;
        transfer_lamports_from_vault(
            &ctx.accounts.sol_vault.to_account_info(),
            &ctx.accounts.creator.to_account_info(),
            amount,
        )?;

        emit!(Claimed {
            creator: ctx.accounts.creator.key(),
            amount,
            currency: Currency::Sol,
        });
        Ok(())
    }

    /// Owner pulls accrued treasury SOL to the treasury address.
    pub fn claim_treasury_sol(ctx: Context<ClaimTreasurySol>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        let amount = config.treasury_claimable_sol;
        require!(amount > 0, PaymentError::NothingToClaim);

        config.treasury_claimable_sol = 0;
        transfer_lamports_from_vault(
            &ctx.accounts.sol_vault.to_account_info(),
            &ctx.accounts.treasury.to_account_info(),
            amount,
        )?;

        emit!(Claimed {
            creator: ctx.accounts.treasury.key(),
            amount,
            currency: Currency::Sol,
        });
        Ok(())
    }

    // ─── Routing — $LOAR (SPL / Token-2022) ───────────────────────────────

    /// Route $LOAR. Fee_bps minus `loar_fee_discount_bps` (saturating). The
    /// caller's token account is debited; vault is credited; creator + treasury
    /// accumulators move.
    pub fn route_spl(
        ctx: Context<RouteSpl>,
        amount: u64,
        fee_bps_override: Option<u16>,
    ) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(!config.paused, PaymentError::Paused);
        require!(amount > 0, PaymentError::ZeroAmount);
        require!(
            config.loar_mint != Pubkey::default(),
            PaymentError::LoarMintNotSet
        );
        require!(
            ctx.accounts.loar_mint.key() == config.loar_mint,
            PaymentError::WrongLoarMint
        );

        let raw_fee = fee_bps_override.unwrap_or(config.default_fee_bps);
        require!(raw_fee <= MAX_FEE_BPS, PaymentError::FeeTooHigh);
        let effective_fee = raw_fee.saturating_sub(config.loar_fee_discount_bps);

        let platform = mul_bps(amount, effective_fee as u64)?;
        let creator_amount = amount
            .checked_sub(platform)
            .ok_or(PaymentError::MathOverflow)?;

        // Pull tokens from payer → vault ATA. transfer_checked enforces
        // mint + decimals match, protecting against malicious token swap.
        let decimals = ctx.accounts.loar_mint.decimals;
        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.payer_ata.to_account_info(),
                    mint: ctx.accounts.loar_mint.to_account_info(),
                    to: ctx.accounts.vault_ata.to_account_info(),
                    authority: ctx.accounts.payer.to_account_info(),
                },
            ),
            amount,
            decimals,
        )?;

        let claim = &mut ctx.accounts.claim_loar;
        if claim.creator == Pubkey::default() {
            claim.creator = ctx.accounts.creator.key();
            claim.bump = ctx.bumps.claim_loar;
        }
        claim.amount = claim
            .amount
            .checked_add(creator_amount)
            .ok_or(PaymentError::MathOverflow)?;

        config.treasury_claimable_loar = config
            .treasury_claimable_loar
            .checked_add(platform)
            .ok_or(PaymentError::MathOverflow)?;

        emit!(PaymentRouted {
            creator: ctx.accounts.creator.key(),
            creator_amount,
            platform_amount: platform,
            fee_bps: effective_fee,
            currency: Currency::Loar,
        });
        Ok(())
    }

    /// Route $LOAR 100% to treasury accumulator.
    pub fn route_spl_to_treasury(ctx: Context<RouteSplToTreasury>, amount: u64) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(!config.paused, PaymentError::Paused);
        require!(amount > 0, PaymentError::ZeroAmount);
        require!(
            config.loar_mint != Pubkey::default(),
            PaymentError::LoarMintNotSet
        );
        require!(
            ctx.accounts.loar_mint.key() == config.loar_mint,
            PaymentError::WrongLoarMint
        );

        let decimals = ctx.accounts.loar_mint.decimals;
        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.payer_ata.to_account_info(),
                    mint: ctx.accounts.loar_mint.to_account_info(),
                    to: ctx.accounts.vault_ata.to_account_info(),
                    authority: ctx.accounts.payer.to_account_info(),
                },
            ),
            amount,
            decimals,
        )?;

        config.treasury_claimable_loar = config
            .treasury_claimable_loar
            .checked_add(amount)
            .ok_or(PaymentError::MathOverflow)?;

        emit!(PaymentRouted {
            creator: config.treasury,
            creator_amount: 0,
            platform_amount: amount,
            fee_bps: BPS_DENOM as u16,
            currency: Currency::Loar,
        });
        Ok(())
    }

    /// Creator pulls accrued $LOAR.
    pub fn claim_spl(ctx: Context<ClaimSpl>) -> Result<()> {
        let claim = &mut ctx.accounts.claim_loar;
        let amount = claim.amount;
        require!(amount > 0, PaymentError::NothingToClaim);
        require!(
            claim.creator == ctx.accounts.creator.key(),
            PaymentError::Unauthorized
        );
        require!(
            ctx.accounts.loar_mint.key() == ctx.accounts.config.loar_mint,
            PaymentError::WrongLoarMint
        );

        claim.amount = 0;
        let decimals = ctx.accounts.loar_mint.decimals;
        let loar_vault_bump = ctx.accounts.config.loar_vault_bump;
        let signer_seeds: &[&[&[u8]]] = &[&[LOAR_VAULT_SEED, &[loar_vault_bump]]];

        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.vault_ata.to_account_info(),
                    mint: ctx.accounts.loar_mint.to_account_info(),
                    to: ctx.accounts.creator_ata.to_account_info(),
                    authority: ctx.accounts.loar_vault.to_account_info(),
                },
                signer_seeds,
            ),
            amount,
            decimals,
        )?;

        emit!(Claimed {
            creator: ctx.accounts.creator.key(),
            amount,
            currency: Currency::Loar,
        });
        Ok(())
    }

    /// Owner pulls accrued treasury $LOAR to the treasury's ATA.
    pub fn claim_treasury_spl(ctx: Context<ClaimTreasurySpl>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        let amount = config.treasury_claimable_loar;
        require!(amount > 0, PaymentError::NothingToClaim);
        require!(
            ctx.accounts.loar_mint.key() == config.loar_mint,
            PaymentError::WrongLoarMint
        );

        config.treasury_claimable_loar = 0;
        let decimals = ctx.accounts.loar_mint.decimals;
        let loar_vault_bump = config.loar_vault_bump;
        let signer_seeds: &[&[&[u8]]] = &[&[LOAR_VAULT_SEED, &[loar_vault_bump]]];

        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.vault_ata.to_account_info(),
                    mint: ctx.accounts.loar_mint.to_account_info(),
                    to: ctx.accounts.treasury_ata.to_account_info(),
                    authority: ctx.accounts.loar_vault.to_account_info(),
                },
                signer_seeds,
            ),
            amount,
            decimals,
        )?;

        emit!(Claimed {
            creator: ctx.accounts.config.treasury,
            amount,
            currency: Currency::Loar,
        });
        Ok(())
    }

    // ─── Owner-gated configuration ────────────────────────────────────────

    pub fn set_treasury(ctx: Context<OwnerOnly>, new_treasury: Pubkey) -> Result<()> {
        require!(new_treasury != Pubkey::default(), PaymentError::ZeroAddress);
        let config = &mut ctx.accounts.config;
        let old = config.treasury;
        config.treasury = new_treasury;
        emit!(TreasuryUpdated {
            old_treasury: old,
            new_treasury,
        });
        Ok(())
    }

    pub fn set_default_fee(ctx: Context<OwnerOnly>, new_fee_bps: u16) -> Result<()> {
        require!(new_fee_bps <= MAX_FEE_BPS, PaymentError::FeeTooHigh);
        ctx.accounts.config.default_fee_bps = new_fee_bps;
        emit!(DefaultFeeUpdated { new_fee_bps });
        Ok(())
    }

    pub fn set_loar_mint(ctx: Context<OwnerOnly>, mint: Pubkey) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(!config.loar_locked, PaymentError::LoarMintLocked);
        require!(mint != Pubkey::default(), PaymentError::ZeroAddress);
        config.loar_mint = mint;
        emit!(LoarMintUpdated { new_mint: mint });
        Ok(())
    }

    /// One-way switch: once locked, the $LOAR mint cannot change again.
    pub fn lock_loar_mint(ctx: Context<OwnerOnly>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(
            config.loar_mint != Pubkey::default(),
            PaymentError::LoarMintNotSet
        );
        require!(!config.loar_locked, PaymentError::LoarMintLocked);
        config.loar_locked = true;
        emit!(LoarMintLocked {
            mint: config.loar_mint,
        });
        Ok(())
    }

    pub fn set_loar_fee_discount(ctx: Context<OwnerOnly>, discount_bps: u16) -> Result<()> {
        require!(discount_bps <= MAX_FEE_BPS, PaymentError::DiscountTooHigh);
        ctx.accounts.config.loar_fee_discount_bps = discount_bps;
        emit!(LoarFeeDiscountUpdated { discount_bps });
        Ok(())
    }

    pub fn pause(ctx: Context<OwnerOnly>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(!config.paused, PaymentError::AlreadyPaused);
        config.paused = true;
        emit!(Paused {});
        Ok(())
    }

    pub fn unpause(ctx: Context<OwnerOnly>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(config.paused, PaymentError::NotPaused);
        config.paused = false;
        emit!(Unpaused {});
        Ok(())
    }

    /// Step 1 of ownership transfer — owner proposes the new owner.
    pub fn transfer_ownership(ctx: Context<OwnerOnly>, new_owner: Pubkey) -> Result<()> {
        require!(new_owner != Pubkey::default(), PaymentError::ZeroAddress);
        ctx.accounts.config.pending_owner = new_owner;
        emit!(OwnershipTransferProposed { new_owner });
        Ok(())
    }

    /// Step 2 of ownership transfer — pending owner accepts. Atomic flip.
    pub fn accept_ownership(ctx: Context<AcceptOwnership>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(
            config.pending_owner == ctx.accounts.new_owner.key(),
            PaymentError::Unauthorized
        );
        let old = config.owner;
        config.owner = config.pending_owner;
        config.pending_owner = Pubkey::default();
        emit!(OwnershipTransferred {
            old_owner: old,
            new_owner: config.owner,
        });
        Ok(())
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────

fn mul_bps(amount: u64, bps: u64) -> Result<u64> {
    amount
        .checked_mul(bps)
        .and_then(|v| v.checked_div(BPS_DENOM))
        .ok_or_else(|| error!(PaymentError::MathOverflow))
}

/// Move `amount` lamports from a program-owned vault to an arbitrary
/// destination. Solana disallows `system_program::transfer` from accounts
/// owned by a non-system program, so we manipulate lamports directly.
/// Safe because the vault PDA is owned by this program.
fn transfer_lamports_from_vault(
    vault: &AccountInfo,
    to: &AccountInfo,
    amount: u64,
) -> Result<()> {
    let vault_balance = vault.lamports();
    require!(vault_balance >= amount, PaymentError::InsufficientVault);

    **vault.try_borrow_mut_lamports()? = vault_balance
        .checked_sub(amount)
        .ok_or(PaymentError::MathOverflow)?;
    **to.try_borrow_mut_lamports()? = to
        .lamports()
        .checked_add(amount)
        .ok_or(PaymentError::MathOverflow)?;
    Ok(())
}

// ─── Accounts ────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        init,
        payer = owner,
        space = 8 + Config::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, Config>,
    /// SOL vault — program-owned account whose lamports are the unclaimed
    /// SOL balance (rent-exempt minimum kept on top of accrued accumulators).
    #[account(
        init,
        payer = owner,
        space = 8 + SolVault::INIT_SPACE,
        seeds = [SOL_VAULT_SEED],
        bump
    )]
    pub sol_vault: Account<'info, SolVault>,
    /// LOAR vault authority PDA — owns the program's $LOAR ATA.
    #[account(
        init,
        payer = owner,
        space = 8 + LoarVault::INIT_SPACE,
        seeds = [LOAR_VAULT_SEED],
        bump
    )]
    pub loar_vault: Account<'info, LoarVault>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Route<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: Routed-to address. Stored verbatim in the claim PDA seeds; no
    /// data is read from it. Permission to receive funds is derived from
    /// matching the seeds, not the account state.
    pub creator: UncheckedAccount<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [SOL_VAULT_SEED], bump = config.sol_vault_bump)]
    pub sol_vault: Account<'info, SolVault>,
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + ClaimSol::INIT_SPACE,
        seeds = [CLAIM_SOL_SEED, creator.key().as_ref()],
        bump
    )]
    pub claim_sol: Account<'info, ClaimSol>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RouteToTreasury<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [SOL_VAULT_SEED], bump = config.sol_vault_bump)]
    pub sol_vault: Account<'info, SolVault>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [SOL_VAULT_SEED], bump = config.sol_vault_bump)]
    pub sol_vault: Account<'info, SolVault>,
    #[account(
        mut,
        seeds = [CLAIM_SOL_SEED, creator.key().as_ref()],
        bump = claim_sol.bump,
        has_one = creator @ PaymentError::Unauthorized
    )]
    pub claim_sol: Account<'info, ClaimSol>,
}

#[derive(Accounts)]
pub struct ClaimTreasurySol<'info> {
    #[account(mut, address = config.owner @ PaymentError::Unauthorized)]
    pub owner: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [SOL_VAULT_SEED], bump = config.sol_vault_bump)]
    pub sol_vault: Account<'info, SolVault>,
    /// CHECK: Pinned to `config.treasury`; only receives lamports.
    #[account(mut, address = config.treasury @ PaymentError::WrongTreasury)]
    pub treasury: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct RouteSpl<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: Routed-to address. Used only for PDA seed derivation.
    pub creator: UncheckedAccount<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    /// LOAR vault PDA — authority of vault_ata.
    #[account(seeds = [LOAR_VAULT_SEED], bump = config.loar_vault_bump)]
    pub loar_vault: Account<'info, LoarVault>,
    #[account(address = config.loar_mint @ PaymentError::WrongLoarMint)]
    pub loar_mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        token::mint = loar_mint,
        token::authority = payer,
    )]
    pub payer_ata: InterfaceAccount<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = loar_mint,
        associated_token::authority = loar_vault,
        associated_token::token_program = token_program,
    )]
    pub vault_ata: InterfaceAccount<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + ClaimLoar::INIT_SPACE,
        seeds = [CLAIM_LOAR_SEED, creator.key().as_ref()],
        bump
    )]
    pub claim_loar: Account<'info, ClaimLoar>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RouteSplToTreasury<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(seeds = [LOAR_VAULT_SEED], bump = config.loar_vault_bump)]
    pub loar_vault: Account<'info, LoarVault>,
    #[account(address = config.loar_mint @ PaymentError::WrongLoarMint)]
    pub loar_mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        token::mint = loar_mint,
        token::authority = payer,
    )]
    pub payer_ata: InterfaceAccount<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = loar_mint,
        associated_token::authority = loar_vault,
        associated_token::token_program = token_program,
    )]
    pub vault_ata: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClaimSpl<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(seeds = [LOAR_VAULT_SEED], bump = config.loar_vault_bump)]
    pub loar_vault: Account<'info, LoarVault>,
    #[account(address = config.loar_mint @ PaymentError::WrongLoarMint)]
    pub loar_mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        seeds = [CLAIM_LOAR_SEED, creator.key().as_ref()],
        bump = claim_loar.bump,
        has_one = creator @ PaymentError::Unauthorized
    )]
    pub claim_loar: Account<'info, ClaimLoar>,
    #[account(
        mut,
        token::mint = loar_mint,
        token::authority = loar_vault,
    )]
    pub vault_ata: InterfaceAccount<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = creator,
        associated_token::mint = loar_mint,
        associated_token::authority = creator,
        associated_token::token_program = token_program,
    )]
    pub creator_ata: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClaimTreasurySpl<'info> {
    #[account(mut, address = config.owner @ PaymentError::Unauthorized)]
    pub owner: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(seeds = [LOAR_VAULT_SEED], bump = config.loar_vault_bump)]
    pub loar_vault: Account<'info, LoarVault>,
    #[account(address = config.loar_mint @ PaymentError::WrongLoarMint)]
    pub loar_mint: InterfaceAccount<'info, Mint>,
    /// CHECK: Address-pinned to config.treasury — must match for receipts.
    #[account(address = config.treasury @ PaymentError::WrongTreasury)]
    pub treasury: UncheckedAccount<'info>,
    #[account(
        mut,
        token::mint = loar_mint,
        token::authority = loar_vault,
    )]
    pub vault_ata: InterfaceAccount<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = owner,
        associated_token::mint = loar_mint,
        associated_token::authority = treasury,
        associated_token::token_program = token_program,
    )]
    pub treasury_ata: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct OwnerOnly<'info> {
    #[account(address = config.owner @ PaymentError::Unauthorized)]
    pub owner: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
}

#[derive(Accounts)]
pub struct AcceptOwnership<'info> {
    pub new_owner: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
}

// ─── State ───────────────────────────────────────────────────────────────

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub owner: Pubkey,
    pub pending_owner: Pubkey,
    pub treasury: Pubkey,
    pub loar_mint: Pubkey,
    pub default_fee_bps: u16,
    pub loar_fee_discount_bps: u16,
    pub loar_locked: bool,
    pub paused: bool,
    pub treasury_claimable_sol: u64,
    pub treasury_claimable_loar: u64,
    pub bump: u8,
    pub sol_vault_bump: u8,
    pub loar_vault_bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct SolVault {
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct LoarVault {
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct ClaimSol {
    pub creator: Pubkey,
    pub amount: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct ClaimLoar {
    pub creator: Pubkey,
    pub amount: u64,
    pub bump: u8,
}

// ─── Events ──────────────────────────────────────────────────────────────

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum Currency {
    Sol,
    Loar,
}

#[event]
pub struct Initialized {
    pub owner: Pubkey,
    pub treasury: Pubkey,
    pub default_fee_bps: u16,
}

#[event]
pub struct PaymentRouted {
    pub creator: Pubkey,
    pub creator_amount: u64,
    pub platform_amount: u64,
    pub fee_bps: u16,
    pub currency: Currency,
}

#[event]
pub struct Claimed {
    pub creator: Pubkey,
    pub amount: u64,
    pub currency: Currency,
}

#[event]
pub struct TreasuryUpdated {
    pub old_treasury: Pubkey,
    pub new_treasury: Pubkey,
}

#[event]
pub struct DefaultFeeUpdated {
    pub new_fee_bps: u16,
}

#[event]
pub struct LoarMintUpdated {
    pub new_mint: Pubkey,
}

#[event]
pub struct LoarMintLocked {
    pub mint: Pubkey,
}

#[event]
pub struct LoarFeeDiscountUpdated {
    pub discount_bps: u16,
}

#[event]
pub struct Paused {}

#[event]
pub struct Unpaused {}

#[event]
pub struct OwnershipTransferProposed {
    pub new_owner: Pubkey,
}

#[event]
pub struct OwnershipTransferred {
    pub old_owner: Pubkey,
    pub new_owner: Pubkey,
}

// ─── Errors ──────────────────────────────────────────────────────────────

#[error_code]
pub enum PaymentError {
    #[msg("Only the program owner may perform this action")]
    Unauthorized,
    #[msg("Routing is paused")]
    Paused,
    #[msg("Cannot pause: already paused")]
    AlreadyPaused,
    #[msg("Cannot unpause: not paused")]
    NotPaused,
    #[msg("Fee exceeds MAX_FEE_BPS (10%)")]
    FeeTooHigh,
    #[msg("Discount exceeds MAX_FEE_BPS (10%)")]
    DiscountTooHigh,
    #[msg("$LOAR mint is not configured")]
    LoarMintNotSet,
    #[msg("$LOAR mint is permanently locked")]
    LoarMintLocked,
    #[msg("Provided mint does not match config.loar_mint")]
    WrongLoarMint,
    #[msg("Provided treasury does not match config.treasury")]
    WrongTreasury,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Address cannot be the zero pubkey")]
    ZeroAddress,
    #[msg("Nothing to claim")]
    NothingToClaim,
    #[msg("Vault has insufficient lamports")]
    InsufficientVault,
    #[msg("Arithmetic overflow / division error")]
    MathOverflow,
}
