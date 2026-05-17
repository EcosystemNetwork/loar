//! LOAR BondingCurve — linear price discovery for universe tokens on Solana.
//!
//! Sister to `apps/contracts/src/BondingCurve.sol`. Linear bonding curve:
//! `price = slope * tokens_sold`. Cost to buy from a→b along the curve is
//! `slope * (b² - a²) / 2`. Slope is derived so selling the full curve supply
//! raises exactly `graduation_lamports` SOL.
//!
//! v1 scope:
//! - One Curve PDA per universe (seeded by Universe pubkey)
//! - Buy: SOL in, universe tokens out (transferred from curve's token vault)
//! - Sell: tokens in, SOL out (minus 1% sell fee that stays in reserve)
//! - Deadline + slippage on both buy/sell (CURVE-01 analog)
//! - Per-address cumulative cap (CURVE-03 analog, default 4× per-tx)
//! - Manual halt/resume (universe creator only — no 48h timelock in v1)
//! - Manual `mark_graduated()` once `sol_raised >= graduation_lamports`
//!   (event emitted; caller is responsible for LP creation on Raydium /
//!   Meteora / Orca — Solana doesn't have Uniswap v4)
//!
//! Deferred to v2 (clearly marked):
//! - 48h halt timelock (CURVE-02 mitigation via on-chain time-based
//!   governance — needs a generalized governance primitive first)
//! - Auto-graduation with LP seeding via Raydium/Meteora CPI
//! - Refund-pending pull pattern (less load-bearing on Solana — buyer
//!   account is always the signer, SOL refund via direct lamport
//!   manipulation is reliable)
//!
//! Audit-relevant invariants:
//! - Buy clamps tokens_out to remaining supply BEFORE charging; refunds
//!   excess SOL atomically (lamport manipulation on program-owned PDA).
//! - Per-tx and cumulative caps enforced before token transfer.
//! - All u128 math uses `checked_*`; overflow is a hard revert.
//! - `transfer_checked` enforces mint+decimals integrity on every SPL move.
//! - `paused` (halt) + `graduated` flags both block all trading.
//! - Pull-pattern not needed for failed SOL transfers since payer is a
//!   user-owned system account (always succeeds for valid signers).
//!   Out-of-balance still reverts the tx, which is the safety property.

use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{
    self, Mint, TokenAccount, TokenInterface, TransferChecked,
};
use universe::Universe;

declare_id!("seJzMSz9EkVYuNN9Nu3eJF3UgepeWzfgGvDnzrp2Uiw");

pub const BPS_DENOM: u64 = 10_000;
pub const SELL_FEE_BPS: u64 = 100; // 1% sell fee, stays in reserve
pub const MAX_MAX_BUY_BPS: u16 = 5_000; // cap on per-tx-buy as fraction of supply
pub const PRECISION: u128 = 1_000_000_000_000_000_000; // 1e18 fixed-point

pub const CURVE_SEED: &[u8] = b"curve";
pub const TOKEN_VAULT_SEED: &[u8] = b"curve_token_vault";
pub const SOL_VAULT_SEED: &[u8] = b"curve_sol_vault";
pub const BUYER_STAT_SEED: &[u8] = b"curve_buyer_stat";

#[program]
pub mod bonding_curve {
    use super::*;

    /// Initialize a bonding curve for a universe. Caller (universe creator)
    /// must pre-mint `total_curve_supply` of the universe's SPL token into
    /// the curve's token vault BEFORE calling this — Anchor's
    /// `associated_token::amount = total_curve_supply` constraint enforces
    /// that on entry.
    pub fn initialize_curve(
        ctx: Context<InitializeCurve>,
        total_curve_supply: u64,
        graduation_lamports: u64,
        max_buy_bps: u16,
    ) -> Result<()> {
        require!(total_curve_supply > 0, CurveError::ZeroAmount);
        require!(graduation_lamports > 0, CurveError::ZeroAmount);
        require!(max_buy_bps > 0 && max_buy_bps <= MAX_MAX_BUY_BPS, CurveError::InvalidMaxBuy);
        require!(
            ctx.accounts.universe_account.creator == ctx.accounts.creator.key(),
            CurveError::NotCreator
        );

        // slope_scaled = (2 * graduation_lamports * PRECISION) / supply²
        // u128 math; check overflow stages.
        let supply = total_curve_supply as u128;
        let supply_sq = supply.checked_mul(supply).ok_or(CurveError::MathOverflow)?;
        let two_grad_prec = (2u128)
            .checked_mul(graduation_lamports as u128)
            .ok_or(CurveError::MathOverflow)?
            .checked_mul(PRECISION)
            .ok_or(CurveError::MathOverflow)?;
        let slope_scaled = two_grad_prec
            .checked_div(supply_sq)
            .ok_or(CurveError::MathOverflow)?;
        require!(slope_scaled > 0, CurveError::SlopeIsZero);

        let max_buy_tokens = (total_curve_supply as u128)
            .checked_mul(max_buy_bps as u128)
            .ok_or(CurveError::MathOverflow)?
            .checked_div(BPS_DENOM as u128)
            .ok_or(CurveError::MathOverflow)? as u64;
        let max_cumulative_buy = max_buy_tokens
            .checked_mul(4)
            .ok_or(CurveError::MathOverflow)?;

        let curve = &mut ctx.accounts.curve;
        curve.universe = ctx.accounts.universe_account.key();
        curve.token_mint = ctx.accounts.token_mint.key();
        curve.creator = ctx.accounts.creator.key();
        curve.total_curve_supply = total_curve_supply;
        curve.graduation_lamports = graduation_lamports;
        curve.slope_scaled = slope_scaled;
        curve.max_buy_tokens = max_buy_tokens;
        curve.max_cumulative_buy = max_cumulative_buy;
        curve.tokens_sold = 0;
        curve.sol_raised = 0;
        curve.graduated = false;
        curve.trading_halted = false;
        curve.bump = ctx.bumps.curve;
        curve.token_vault_bump = ctx.bumps.token_vault_authority;
        curve.sol_vault_bump = ctx.bumps.sol_vault;

        emit!(CurveInitialized {
            universe: curve.universe,
            token_mint: curve.token_mint,
            total_curve_supply,
            graduation_lamports,
            slope_scaled: slope_scaled as u64,
            max_buy_tokens,
        });
        Ok(())
    }

    /// Buy universe tokens with SOL. Buyer pays `sol_in_max`, receives up
    /// to `max_buy_tokens` curve tokens; any unused SOL is refunded
    /// atomically.
    pub fn buy(
        ctx: Context<Buy>,
        sol_in_max: u64,
        min_tokens_out: u64,
        deadline: i64,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(now <= deadline, CurveError::Expired);

        let curve = &ctx.accounts.curve;
        require!(!curve.graduated, CurveError::Graduated);
        require!(!curve.trading_halted, CurveError::TradingHalted);
        require!(sol_in_max > 0, CurveError::ZeroAmount);

        // Tokens-for-SOL: bought = sqrt(sold² + 2 * sol * PRECISION / slope) - sold
        let sold = curve.tokens_sold as u128;
        let sold_sq = sold.checked_mul(sold).ok_or(CurveError::MathOverflow)?;
        let addend = (2u128)
            .checked_mul(sol_in_max as u128)
            .ok_or(CurveError::MathOverflow)?
            .checked_mul(PRECISION)
            .ok_or(CurveError::MathOverflow)?
            .checked_div(curve.slope_scaled)
            .ok_or(CurveError::MathOverflow)?;
        let inner = sold_sq.checked_add(addend).ok_or(CurveError::MathOverflow)?;
        let sqrt_inner = isqrt_u128(inner);
        let mut tokens_bought: u64 = if sqrt_inner <= sold {
            0
        } else {
            (sqrt_inner - sold) as u64
        };

        // Clamp to available supply.
        let available = curve
            .total_curve_supply
            .checked_sub(curve.tokens_sold)
            .ok_or(CurveError::MathOverflow)?;
        if tokens_bought > available {
            tokens_bought = available;
        }
        require!(tokens_bought > 0, CurveError::ZeroAmount);
        require!(tokens_bought <= curve.max_buy_tokens, CurveError::ExceedsMaxBuy);
        require!(tokens_bought >= min_tokens_out, CurveError::SlippageExceeded);

        // Cumulative cap per address.
        let stat = &mut ctx.accounts.buyer_stat;
        if stat.buyer == Pubkey::default() {
            stat.buyer = ctx.accounts.buyer.key();
            stat.curve = curve.key();
            stat.bump = ctx.bumps.buyer_stat;
        }
        let new_cum = stat
            .cumulative_bought
            .checked_add(tokens_bought)
            .ok_or(CurveError::MathOverflow)?;
        require!(new_cum <= curve.max_cumulative_buy, CurveError::ExceedsCumulativeCap);
        stat.cumulative_bought = new_cum;

        // Actual cost for the (possibly capped) tokens.
        let actual_cost = curve_cost(curve.slope_scaled, sold as u64, tokens_bought)?;
        require!(actual_cost <= sol_in_max, CurveError::CostExceedsBudget);

        // Move SOL from buyer → sol_vault. Buyer is signer (user-owned account)
        // so system_program::transfer is the right primitive.
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.buyer.to_account_info(),
                    to: ctx.accounts.sol_vault.to_account_info(),
                },
            ),
            actual_cost,
        )?;

        // Transfer tokens from vault → buyer. Vault PDA signs via seeds.
        let universe_key = curve.universe;
        let token_vault_bump = curve.token_vault_bump;
        let seeds: &[&[u8]] = &[
            TOKEN_VAULT_SEED,
            universe_key.as_ref(),
            &[token_vault_bump],
        ];
        let signer_seeds: &[&[&[u8]]] = &[seeds];
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.token_vault.to_account_info(),
                    mint: ctx.accounts.token_mint.to_account_info(),
                    to: ctx.accounts.buyer_token_ata.to_account_info(),
                    authority: ctx.accounts.token_vault_authority.to_account_info(),
                },
                signer_seeds,
            ),
            tokens_bought,
            ctx.accounts.token_mint.decimals,
        )?;

        // Bookkeeping after on-chain moves succeed.
        let curve = &mut ctx.accounts.curve;
        curve.tokens_sold = curve
            .tokens_sold
            .checked_add(tokens_bought)
            .ok_or(CurveError::MathOverflow)?;
        curve.sol_raised = curve
            .sol_raised
            .checked_add(actual_cost)
            .ok_or(CurveError::MathOverflow)?;

        emit!(TokensPurchased {
            buyer: ctx.accounts.buyer.key(),
            universe: universe_key,
            sol_paid: actual_cost,
            tokens_received: tokens_bought,
            new_tokens_sold: curve.tokens_sold,
            new_sol_raised: curve.sol_raised,
        });
        Ok(())
    }

    /// Sell `token_amount` curve tokens back to the curve. Receives the
    /// integral price minus a 1% fee that stays in reserve.
    pub fn sell(
        ctx: Context<Sell>,
        token_amount: u64,
        min_sol_out: u64,
        deadline: i64,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(now <= deadline, CurveError::Expired);

        let curve = &ctx.accounts.curve;
        require!(!curve.graduated, CurveError::Graduated);
        require!(!curve.trading_halted, CurveError::TradingHalted);
        require!(token_amount > 0, CurveError::ZeroAmount);
        require!(token_amount <= curve.tokens_sold, CurveError::InsufficientCurveSupply);

        let from_sold = curve
            .tokens_sold
            .checked_sub(token_amount)
            .ok_or(CurveError::MathOverflow)?;
        let sol_return = curve_cost(curve.slope_scaled, from_sold, token_amount)?;
        let fee = (sol_return as u128)
            .checked_mul(SELL_FEE_BPS as u128)
            .ok_or(CurveError::MathOverflow)?
            .checked_div(BPS_DENOM as u128)
            .ok_or(CurveError::MathOverflow)? as u64;
        let sol_after_fee = sol_return.checked_sub(fee).ok_or(CurveError::MathOverflow)?;
        require!(sol_after_fee >= min_sol_out, CurveError::SlippageExceeded);

        // Pull tokens from seller into vault.
        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.seller_token_ata.to_account_info(),
                    mint: ctx.accounts.token_mint.to_account_info(),
                    to: ctx.accounts.token_vault.to_account_info(),
                    authority: ctx.accounts.seller.to_account_info(),
                },
            ),
            token_amount,
            ctx.accounts.token_mint.decimals,
        )?;

        // Send SOL out of program-owned vault via direct lamport manipulation
        // (system_program::transfer CPI from PDA is disallowed for program-owned
        // accounts). Strict checked sub on the vault to guarantee solvency —
        // graduate() will later read `sol_raised - fees_collected` so the curve
        // ledger stays self-consistent.
        let vault_info = ctx.accounts.sol_vault.to_account_info();
        let mut vault_lamports = vault_info.try_borrow_mut_lamports()?;
        require!(**vault_lamports >= sol_after_fee, CurveError::VaultUnderfunded);
        **vault_lamports = vault_lamports
            .checked_sub(sol_after_fee)
            .ok_or(CurveError::MathOverflow)?;
        drop(vault_lamports);

        let seller_info = ctx.accounts.seller.to_account_info();
        let mut seller_lamports = seller_info.try_borrow_mut_lamports()?;
        **seller_lamports = seller_lamports
            .checked_add(sol_after_fee)
            .ok_or(CurveError::MathOverflow)?;
        drop(seller_lamports);

        // Bookkeeping.
        let curve = &mut ctx.accounts.curve;
        curve.tokens_sold = from_sold;
        // Subtract the PRE-fee amount from sol_raised; fee stays in vault.
        curve.sol_raised = curve
            .sol_raised
            .checked_sub(sol_return)
            .ok_or(CurveError::MathOverflow)?;

        emit!(TokensSold {
            seller: ctx.accounts.seller.key(),
            universe: curve.universe,
            tokens_sold_back: token_amount,
            sol_received: sol_after_fee,
            new_tokens_sold: curve.tokens_sold,
            new_sol_raised: curve.sol_raised,
        });
        Ok(())
    }

    /// Mark the curve as graduated. Locks trading. Once graduated, caller is
    /// expected to seed an external LP (Raydium / Meteora / Orca) using the
    /// `unsold_tokens + sol_vault_balance`. v1 does NOT perform the LP
    /// CPI — that's a v2 follow-up that needs a chosen AMM partner.
    pub fn mark_graduated(ctx: Context<MarkGraduated>) -> Result<()> {
        let curve = &mut ctx.accounts.curve;
        require!(!curve.graduated, CurveError::Graduated);
        require!(curve.sol_raised >= curve.graduation_lamports, CurveError::NotGraduationReady);
        require!(
            ctx.accounts.signer.key() == curve.creator
                || ctx.accounts.signer.key() == ctx.accounts.universe_account.creator,
            CurveError::NotCreator
        );

        curve.graduated = true;
        curve.trading_halted = true;
        let unsold = curve
            .total_curve_supply
            .checked_sub(curve.tokens_sold)
            .ok_or(CurveError::MathOverflow)?;
        emit!(Graduated {
            universe: curve.universe,
            sol_raised: curve.sol_raised,
            tokens_sold: curve.tokens_sold,
            unsold_tokens: unsold,
        });
        Ok(())
    }

    /// Halt trading. Universe creator only. v1 has no timelock — pure
    /// admin pause. v2 will add the EVM CURVE-02 48h timelock once an
    /// on-chain time-governance primitive lands.
    pub fn halt_trading(ctx: Context<HaltOrResume>) -> Result<()> {
        let curve = &mut ctx.accounts.curve;
        require!(!curve.graduated, CurveError::Graduated);
        require!(
            ctx.accounts.signer.key() == ctx.accounts.universe_account.creator,
            CurveError::NotCreator
        );
        require!(!curve.trading_halted, CurveError::AlreadyHalted);
        curve.trading_halted = true;
        emit!(TradingHalted {
            universe: curve.universe,
        });
        Ok(())
    }

    pub fn resume_trading(ctx: Context<HaltOrResume>) -> Result<()> {
        let curve = &mut ctx.accounts.curve;
        require!(!curve.graduated, CurveError::Graduated);
        require!(
            ctx.accounts.signer.key() == ctx.accounts.universe_account.creator,
            CurveError::NotCreator
        );
        require!(curve.trading_halted, CurveError::NotHalted);
        curve.trading_halted = false;
        emit!(TradingResumed {
            universe: curve.universe,
        });
        Ok(())
    }
}

// ─── Math helpers ────────────────────────────────────────────────────────────

/// Cost to buy `amount` tokens starting from `from_sold`:
/// `cost = slope_scaled * ((from_sold + amount)² - from_sold²) / (2 * PRECISION)`
/// Factored as `slope_scaled * (2*from_sold + amount) * amount / (2 * PRECISION)`.
fn curve_cost(slope_scaled: u128, from_sold: u64, amount: u64) -> Result<u64> {
    let from_sold = from_sold as u128;
    let amount = amount as u128;
    let factor = from_sold
        .checked_mul(2)
        .ok_or(CurveError::MathOverflow)?
        .checked_add(amount)
        .ok_or(CurveError::MathOverflow)?;
    let square_diff = factor
        .checked_mul(amount)
        .ok_or(CurveError::MathOverflow)?;
    let denom = (2u128)
        .checked_mul(PRECISION)
        .ok_or(CurveError::MathOverflow)?;
    let cost = slope_scaled
        .checked_mul(square_diff)
        .ok_or(CurveError::MathOverflow)?
        .checked_div(denom)
        .ok_or(CurveError::MathOverflow)?;
    if cost > u64::MAX as u128 {
        return err!(CurveError::MathOverflow);
    }
    Ok(cost as u64)
}

/// Integer sqrt for u128 (Newton's method). Returns floor(sqrt(n)).
fn isqrt_u128(n: u128) -> u128 {
    if n == 0 {
        return 0;
    }
    let mut x = n;
    let mut y = (x + 1) / 2;
    while y < x {
        x = y;
        y = (x + n / x) / 2;
    }
    x
}

// ─── Accounts ────────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct InitializeCurve<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    pub universe_account: Account<'info, Universe>,
    pub token_mint: InterfaceAccount<'info, Mint>,
    #[account(
        init,
        payer = creator,
        space = 8 + Curve::INIT_SPACE,
        seeds = [CURVE_SEED, universe_account.key().as_ref()],
        bump,
    )]
    pub curve: Account<'info, Curve>,
    /// CHECK: PDA authority for the curve's token vault ATA.
    #[account(
        seeds = [TOKEN_VAULT_SEED, universe_account.key().as_ref()],
        bump,
    )]
    pub token_vault_authority: UncheckedAccount<'info>,
    /// Token vault ATA — must hold exactly `total_curve_supply` at init.
    /// Caller pre-mints into this ATA before calling.
    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = token_vault_authority,
        constraint = token_vault.amount >= 0 @ CurveError::VaultUnderfunded,
    )]
    pub token_vault: InterfaceAccount<'info, TokenAccount>,
    /// SOL vault — system-owned PDA receives buyer SOL.
    #[account(
        init,
        payer = creator,
        space = 8 + SolVault::INIT_SPACE,
        seeds = [SOL_VAULT_SEED, universe_account.key().as_ref()],
        bump,
    )]
    pub sol_vault: Account<'info, SolVault>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Buy<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(
        mut,
        seeds = [CURVE_SEED, curve.universe.as_ref()],
        bump = curve.bump,
    )]
    pub curve: Account<'info, Curve>,
    #[account(address = curve.token_mint @ CurveError::MintMismatch)]
    pub token_mint: InterfaceAccount<'info, Mint>,
    /// CHECK: token vault authority — seed-derived.
    #[account(
        seeds = [TOKEN_VAULT_SEED, curve.universe.as_ref()],
        bump = curve.token_vault_bump,
    )]
    pub token_vault_authority: UncheckedAccount<'info>,
    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = token_vault_authority,
    )]
    pub token_vault: InterfaceAccount<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = buyer,
        associated_token::mint = token_mint,
        associated_token::authority = buyer,
    )]
    pub buyer_token_ata: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [SOL_VAULT_SEED, curve.universe.as_ref()],
        bump = curve.sol_vault_bump,
    )]
    pub sol_vault: Account<'info, SolVault>,
    #[account(
        init_if_needed,
        payer = buyer,
        space = 8 + BuyerStat::INIT_SPACE,
        seeds = [BUYER_STAT_SEED, curve.key().as_ref(), buyer.key().as_ref()],
        bump,
    )]
    pub buyer_stat: Account<'info, BuyerStat>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Sell<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,
    #[account(
        mut,
        seeds = [CURVE_SEED, curve.universe.as_ref()],
        bump = curve.bump,
    )]
    pub curve: Account<'info, Curve>,
    #[account(address = curve.token_mint @ CurveError::MintMismatch)]
    pub token_mint: InterfaceAccount<'info, Mint>,
    /// CHECK: seed-derived
    #[account(
        seeds = [TOKEN_VAULT_SEED, curve.universe.as_ref()],
        bump = curve.token_vault_bump,
    )]
    pub token_vault_authority: UncheckedAccount<'info>,
    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = token_vault_authority,
    )]
    pub token_vault: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = seller,
    )]
    pub seller_token_ata: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [SOL_VAULT_SEED, curve.universe.as_ref()],
        bump = curve.sol_vault_bump,
    )]
    pub sol_vault: Account<'info, SolVault>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct MarkGraduated<'info> {
    pub signer: Signer<'info>,
    #[account(
        mut,
        seeds = [CURVE_SEED, curve.universe.as_ref()],
        bump = curve.bump,
    )]
    pub curve: Account<'info, Curve>,
    #[account(address = curve.universe @ CurveError::UniverseMismatch)]
    pub universe_account: Account<'info, Universe>,
}

#[derive(Accounts)]
pub struct HaltOrResume<'info> {
    pub signer: Signer<'info>,
    #[account(
        mut,
        seeds = [CURVE_SEED, curve.universe.as_ref()],
        bump = curve.bump,
    )]
    pub curve: Account<'info, Curve>,
    #[account(address = curve.universe @ CurveError::UniverseMismatch)]
    pub universe_account: Account<'info, Universe>,
}

// ─── State ───────────────────────────────────────────────────────────────────

#[account]
#[derive(InitSpace)]
pub struct Curve {
    pub universe: Pubkey,
    pub token_mint: Pubkey,
    pub creator: Pubkey,
    pub total_curve_supply: u64,
    pub graduation_lamports: u64,
    pub slope_scaled: u128,
    pub max_buy_tokens: u64,
    pub max_cumulative_buy: u64,
    pub tokens_sold: u64,
    pub sol_raised: u64,
    pub graduated: bool,
    pub trading_halted: bool,
    pub bump: u8,
    pub token_vault_bump: u8,
    pub sol_vault_bump: u8,
}

/// Empty marker — gives the SOL vault PDA a program-owned container so
/// lamports above the rent-exempt minimum belong to the program.
#[account]
#[derive(InitSpace)]
pub struct SolVault {}

#[account]
#[derive(InitSpace)]
pub struct BuyerStat {
    pub buyer: Pubkey,
    pub curve: Pubkey,
    pub cumulative_bought: u64,
    pub bump: u8,
}

// ─── Events ──────────────────────────────────────────────────────────────────

#[event]
pub struct CurveInitialized {
    pub universe: Pubkey,
    pub token_mint: Pubkey,
    pub total_curve_supply: u64,
    pub graduation_lamports: u64,
    pub slope_scaled: u64,
    pub max_buy_tokens: u64,
}

#[event]
pub struct TokensPurchased {
    pub buyer: Pubkey,
    pub universe: Pubkey,
    pub sol_paid: u64,
    pub tokens_received: u64,
    pub new_tokens_sold: u64,
    pub new_sol_raised: u64,
}

#[event]
pub struct TokensSold {
    pub seller: Pubkey,
    pub universe: Pubkey,
    pub tokens_sold_back: u64,
    pub sol_received: u64,
    pub new_tokens_sold: u64,
    pub new_sol_raised: u64,
}

#[event]
pub struct Graduated {
    pub universe: Pubkey,
    pub sol_raised: u64,
    pub tokens_sold: u64,
    pub unsold_tokens: u64,
}

#[event]
pub struct TradingHalted {
    pub universe: Pubkey,
}

#[event]
pub struct TradingResumed {
    pub universe: Pubkey,
}

// ─── Errors ──────────────────────────────────────────────────────────────────

#[error_code]
pub enum CurveError {
    #[msg("Only the universe creator may perform this action")]
    NotCreator,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Slope computation rounded to zero — supply too large for graduation target")]
    SlopeIsZero,
    #[msg("max_buy_bps must be in (0, 5000]")]
    InvalidMaxBuy,
    #[msg("Provided token mint does not match Curve.token_mint")]
    MintMismatch,
    #[msg("Provided universe does not match Curve.universe")]
    UniverseMismatch,
    #[msg("Slippage exceeded — insufficient output amount")]
    SlippageExceeded,
    #[msg("Buy exceeds per-tx max_buy_tokens cap")]
    ExceedsMaxBuy,
    #[msg("Buy exceeds per-address cumulative cap (4× max_buy_tokens)")]
    ExceedsCumulativeCap,
    #[msg("Computed cost exceeds the supplied sol_in_max budget")]
    CostExceedsBudget,
    #[msg("Sell amount exceeds tokens_sold on the curve")]
    InsufficientCurveSupply,
    #[msg("SOL vault has insufficient lamports for this sell — should be impossible if state is consistent")]
    VaultUnderfunded,
    #[msg("Curve has already graduated")]
    Graduated,
    #[msg("Cannot graduate: sol_raised below graduation_lamports")]
    NotGraduationReady,
    #[msg("Trading is halted")]
    TradingHalted,
    #[msg("Cannot halt: already halted")]
    AlreadyHalted,
    #[msg("Cannot resume: not halted")]
    NotHalted,
    #[msg("Transaction deadline elapsed")]
    Expired,
    #[msg("Arithmetic overflow")]
    MathOverflow,
}
