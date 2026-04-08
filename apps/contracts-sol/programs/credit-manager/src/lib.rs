use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::token_2022;

declare_id!("CrdMgrxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");

/// Credit Manager — Manages AI generation credit purchases on Solana.
/// Equivalent to CreditManager.sol on EVM.
///
/// Dual pricing:
/// - SOL payments: 35% platform margin
/// - $LOAR payments: 25% margin + 10% bonus credits
///
/// Credit balances stored on-chain per user. Off-chain server reads
/// these to gate AI generation access.
///
/// Uses a separate backend_signer for deductions (not the same as authority)
/// to follow principle of least privilege.
#[program]
pub mod credit_manager {
    use super::*;

    /// Initialize the credit manager.
    pub fn initialize(
        ctx: Context<Initialize>,
        loar_mint: Pubkey,
        backend_signer: Pubkey,
    ) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.authority = ctx.accounts.authority.key();
        config.backend_signer = backend_signer;
        config.treasury = ctx.accounts.treasury.key();
        config.loar_mint = loar_mint;
        config.sol_margin_bps = 3500;   // 35%
        config.loar_margin_bps = 2500;  // 25%
        config.loar_bonus_bps = 1000;   // 10% bonus credits
        config.total_credits_sold = 0;
        config.total_sol_revenue = 0;
        config.total_loar_revenue = 0;
        config.bump = ctx.bumps.config;
        Ok(())
    }

    /// Purchase credits with SOL.
    pub fn purchase_credits_sol(
        ctx: Context<PurchaseCreditsSol>,
        tier: CreditTier,
    ) -> Result<()> {
        let config = &ctx.accounts.config;
        let package = tier.package();
        let price_lamports = package.sol_price_lamports;

        // Transfer SOL to treasury
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.buyer.to_account_info(),
                    to: ctx.accounts.treasury.to_account_info(),
                },
            ),
            price_lamports,
        )?;

        // Credit the user's balance
        let balance = &mut ctx.accounts.credit_balance;
        if balance.owner == Pubkey::default() {
            balance.owner = ctx.accounts.buyer.key();
        }
        balance.credits += package.credits;
        balance.total_purchased += package.credits;

        let config = &mut ctx.accounts.config;
        config.total_credits_sold += package.credits;
        config.total_sol_revenue += price_lamports;

        emit!(CreditsPurchased {
            buyer: ctx.accounts.buyer.key(),
            credits: package.credits,
            payment_method: PaymentMethod::Sol,
            amount_paid: price_lamports,
            tier: tier as u8,
        });

        Ok(())
    }

    /// Purchase credits with $LOAR (25% margin + 10% bonus).
    pub fn purchase_credits_loar(
        ctx: Context<PurchaseCreditsLoar>,
        tier: CreditTier,
    ) -> Result<()> {
        let package = tier.package();
        let loar_price = package.loar_price; // in LOAR token units

        // Transfer LOAR to treasury
        token_2022::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                token_2022::TransferChecked {
                    from: ctx.accounts.buyer_ata.to_account_info(),
                    mint: ctx.accounts.loar_mint.to_account_info(),
                    to: ctx.accounts.treasury_ata.to_account_info(),
                    authority: ctx.accounts.buyer.to_account_info(),
                },
            ),
            loar_price,
            9, // LOAR decimals
        )?;

        // Credit with bonus (10% extra for paying with LOAR)
        let bonus = package.credits * 10 / 100;
        let total_credits = package.credits + bonus;

        let balance = &mut ctx.accounts.credit_balance;
        if balance.owner == Pubkey::default() {
            balance.owner = ctx.accounts.buyer.key();
        }
        balance.credits += total_credits;
        balance.total_purchased += total_credits;

        let config = &mut ctx.accounts.config;
        config.total_credits_sold += total_credits;
        config.total_loar_revenue += loar_price;

        emit!(CreditsPurchased {
            buyer: ctx.accounts.buyer.key(),
            credits: total_credits,
            payment_method: PaymentMethod::Loar,
            amount_paid: loar_price,
            tier: tier as u8,
        });

        Ok(())
    }

    /// Deduct credits (called by authorized backend signer after generation).
    /// Uses a separate backend_signer key, not the main authority.
    pub fn deduct_credits(
        ctx: Context<DeductCredits>,
        amount: u64,
        generation_type: GenerationType,
    ) -> Result<()> {
        let balance = &mut ctx.accounts.credit_balance;
        require!(balance.credits >= amount, CreditError::InsufficientCredits);

        balance.credits -= amount;
        balance.total_used += amount;

        emit!(CreditsDeducted {
            user: balance.owner,
            amount,
            generation_type: generation_type as u8,
            remaining: balance.credits,
        });

        Ok(())
    }

    /// Update the backend signer (authority only).
    pub fn set_backend_signer(
        ctx: Context<UpdateConfig>,
        new_signer: Pubkey,
    ) -> Result<()> {
        require!(new_signer != Pubkey::default(), CreditError::ZeroAddress);
        ctx.accounts.config.backend_signer = new_signer;
        Ok(())
    }

    /// Update margin settings (authority only).
    pub fn set_margins(
        ctx: Context<UpdateConfig>,
        sol_margin_bps: u16,
        loar_margin_bps: u16,
        loar_bonus_bps: u16,
    ) -> Result<()> {
        require!(sol_margin_bps <= MAX_MARGIN_BPS, CreditError::MarginTooHigh);
        require!(loar_margin_bps <= MAX_MARGIN_BPS, CreditError::MarginTooHigh);
        require!(loar_bonus_bps <= MAX_BONUS_BPS, CreditError::BonusTooHigh);

        let config = &mut ctx.accounts.config;
        config.sol_margin_bps = sol_margin_bps;
        config.loar_margin_bps = loar_margin_bps;
        config.loar_bonus_bps = loar_bonus_bps;

        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Constants & Enums
// ---------------------------------------------------------------------------

pub const MAX_MARGIN_BPS: u16 = 5_000;  // 50% max margin
pub const MAX_BONUS_BPS: u16 = 2_000;   // 20% max bonus

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum CreditTier {
    Starter,    // 100 credits
    Creator,    // 500 credits
    Pro,        // 1,500 credits
    Studio,     // 5,000 credits
    Enterprise, // 20,000 credits
}

pub struct CreditPackage {
    pub credits: u64,
    pub sol_price_lamports: u64,
    pub loar_price: u64, // in LOAR smallest units (9 decimals)
}

impl CreditTier {
    pub fn package(&self) -> CreditPackage {
        match self {
            CreditTier::Starter => CreditPackage {
                credits: 100,
                sol_price_lamports: 540_000,
                loar_price: 125_000_000_000,
            },
            CreditTier::Creator => CreditPackage {
                credits: 500,
                sol_price_lamports: 2_500_000,
                loar_price: 575_000_000_000,
            },
            CreditTier::Pro => CreditPackage {
                credits: 1_500,
                sol_price_lamports: 6_750_000,
                loar_price: 1_550_000_000_000,
            },
            CreditTier::Studio => CreditPackage {
                credits: 5_000,
                sol_price_lamports: 20_000_000,
                loar_price: 4_600_000_000_000,
            },
            CreditTier::Enterprise => CreditPackage {
                credits: 20_000,
                sol_price_lamports: 72_000_000,
                loar_price: 16_500_000_000_000,
            },
        }
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub enum PaymentMethod {
    Sol,
    Loar,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub enum GenerationType {
    Image,
    Story,
    VideoDraft,
    Character,
    Voiceover,
    Scene,
    Spinoff,
    VideoPremium,
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

#[account]
#[derive(InitSpace)]
pub struct CreditConfig {
    pub authority: Pubkey,
    pub backend_signer: Pubkey,
    pub treasury: Pubkey,
    pub loar_mint: Pubkey,
    pub sol_margin_bps: u16,
    pub loar_margin_bps: u16,
    pub loar_bonus_bps: u16,
    pub total_credits_sold: u64,
    pub total_sol_revenue: u64,
    pub total_loar_revenue: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct CreditBalance {
    pub owner: Pubkey,
    pub credits: u64,
    pub total_purchased: u64,
    pub total_used: u64,
}

// ---------------------------------------------------------------------------
// Contexts
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    /// CHECK: Treasury wallet.
    pub treasury: UncheckedAccount<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + CreditConfig::INIT_SPACE,
        seeds = [b"credit_config"],
        bump,
    )]
    pub config: Account<'info, CreditConfig>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct PurchaseCreditsSol<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,

    #[account(
        mut,
        seeds = [b"credit_config"],
        bump = config.bump,
    )]
    pub config: Account<'info, CreditConfig>,

    /// CHECK: Treasury receives SOL.
    #[account(mut, constraint = treasury.key() == config.treasury @ CreditError::InvalidTreasury)]
    pub treasury: UncheckedAccount<'info>,

    #[account(
        init_if_needed,
        payer = buyer,
        space = 8 + CreditBalance::INIT_SPACE,
        seeds = [b"credits", buyer.key().as_ref()],
        bump,
    )]
    pub credit_balance: Account<'info, CreditBalance>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct PurchaseCreditsLoar<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,

    #[account(
        mut,
        seeds = [b"credit_config"],
        bump = config.bump,
    )]
    pub config: Account<'info, CreditConfig>,

    /// CHECK: LOAR Token-2022 mint.
    pub loar_mint: UncheckedAccount<'info>,

    /// Buyer's LOAR token account.
    /// CHECK: Validated by CPI.
    #[account(mut)]
    pub buyer_ata: UncheckedAccount<'info>,

    /// Treasury's LOAR token account.
    /// CHECK: Validated by CPI.
    #[account(mut)]
    pub treasury_ata: UncheckedAccount<'info>,

    #[account(
        init_if_needed,
        payer = buyer,
        space = 8 + CreditBalance::INIT_SPACE,
        seeds = [b"credits", buyer.key().as_ref()],
        bump,
    )]
    pub credit_balance: Account<'info, CreditBalance>,

    /// CHECK: Token-2022 program.
    pub token_program: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DeductCredits<'info> {
    /// Must be the authorized backend signer (or authority as fallback).
    /// Principle of least privilege: prefer backend_signer for automated deductions.
    #[account(
        constraint = (
            config.backend_signer == signer.key()
            || config.authority == signer.key()
        ) @ CreditError::Unauthorized
    )]
    pub signer: Signer<'info>,

    #[account(
        seeds = [b"credit_config"],
        bump = config.bump,
    )]
    pub config: Account<'info, CreditConfig>,

    #[account(
        mut,
        seeds = [b"credits", credit_balance.owner.as_ref()],
        bump,
    )]
    pub credit_balance: Account<'info, CreditBalance>,
}

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    #[account(constraint = config.authority == authority.key() @ CreditError::Unauthorized)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"credit_config"],
        bump = config.bump,
    )]
    pub config: Account<'info, CreditConfig>,
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

#[event]
pub struct CreditsPurchased {
    pub buyer: Pubkey,
    pub credits: u64,
    pub payment_method: PaymentMethod,
    pub amount_paid: u64,
    pub tier: u8,
}

#[event]
pub struct CreditsDeducted {
    pub user: Pubkey,
    pub amount: u64,
    pub generation_type: u8,
    pub remaining: u64,
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[error_code]
pub enum CreditError {
    #[msg("Not authorized")]
    Unauthorized,
    #[msg("Insufficient credits")]
    InsufficientCredits,
    #[msg("Invalid treasury")]
    InvalidTreasury,
    #[msg("Address cannot be zero")]
    ZeroAddress,
    #[msg("Margin exceeds maximum (50%)")]
    MarginTooHigh,
    #[msg("Bonus exceeds maximum (20%)")]
    BonusTooHigh,
}
