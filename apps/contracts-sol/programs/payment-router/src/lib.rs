use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("PayRtrxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");

/// Payment Router — Centralizes SOL payment routing with platform fee splits.
/// Equivalent to PaymentRouter.sol + SplitRouter.sol on EVM.
///
/// Supports:
/// - Single-recipient payments with platform fee
/// - Multi-recipient split payments (up to 10 recipients)
/// - Configurable platform fee (basis points, max 50%)
/// - Dust-safe splits: last recipient receives remainder
#[program]
pub mod payment_router {
    use super::*;

    /// Initialize the payment router.
    pub fn initialize(
        ctx: Context<Initialize>,
        platform_fee_bps: u16,
    ) -> Result<()> {
        require!(platform_fee_bps <= MAX_FEE_BPS, RouterError::FeeTooHigh);

        let config = &mut ctx.accounts.config;
        config.authority = ctx.accounts.authority.key();
        config.treasury = ctx.accounts.treasury.key();
        config.platform_fee_bps = platform_fee_bps;
        config.total_routed = 0;
        config.total_fees_collected = 0;
        config.bump = ctx.bumps.config;

        Ok(())
    }

    /// Route a SOL payment: platform fee to treasury, remainder to creator.
    pub fn route_payment(
        ctx: Context<RoutePayment>,
        amount: u64,
    ) -> Result<()> {
        require!(amount > 0, RouterError::ZeroAmount);

        let config = &ctx.accounts.config;
        let fee = (amount as u128 * config.platform_fee_bps as u128 / BPS_DENOMINATOR as u128) as u64;
        let creator_amount = amount - fee;

        // Transfer fee to treasury
        if fee > 0 {
            system_program::transfer(
                CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    system_program::Transfer {
                        from: ctx.accounts.payer.to_account_info(),
                        to: ctx.accounts.treasury.to_account_info(),
                    },
                ),
                fee,
            )?;
        }

        // Transfer remainder to creator
        if creator_amount > 0 {
            system_program::transfer(
                CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    system_program::Transfer {
                        from: ctx.accounts.payer.to_account_info(),
                        to: ctx.accounts.recipient.to_account_info(),
                    },
                ),
                creator_amount,
            )?;
        }

        // Update stats
        let config = &mut ctx.accounts.config;
        config.total_routed += amount;
        config.total_fees_collected += fee;

        emit!(PaymentRouted {
            payer: ctx.accounts.payer.key(),
            recipient: ctx.accounts.recipient.key(),
            total: amount,
            fee,
            creator_amount,
        });

        Ok(())
    }

    /// Route a split payment to multiple recipients.
    /// Last recipient receives remainder to prevent dust loss.
    pub fn route_split_payment(
        ctx: Context<RouteSplitPayment>,
        amount: u64,
        recipients: Vec<Pubkey>,
        shares_bps: Vec<u16>,
    ) -> Result<()> {
        require!(amount > 0, RouterError::ZeroAmount);
        require!(recipients.len() == shares_bps.len(), RouterError::MismatchedArrays);
        require!(!recipients.is_empty(), RouterError::MismatchedArrays);
        require!(recipients.len() <= MAX_SPLIT_RECIPIENTS, RouterError::TooManyRecipients);

        let total_bps: u16 = shares_bps.iter().sum();
        require!(total_bps == 10_000, RouterError::SharesDontSumTo100);

        let config = &ctx.accounts.config;
        let fee = (amount as u128 * config.platform_fee_bps as u128 / BPS_DENOMINATOR as u128) as u64;
        let distributable = amount - fee;

        // Transfer fee to treasury
        if fee > 0 {
            system_program::transfer(
                CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    system_program::Transfer {
                        from: ctx.accounts.payer.to_account_info(),
                        to: ctx.accounts.treasury.to_account_info(),
                    },
                ),
                fee,
            )?;
        }

        // Validate remaining accounts match recipient list
        let remaining = &ctx.remaining_accounts;
        require!(remaining.len() == recipients.len(), RouterError::MismatchedArrays);

        // Distribute to recipients — last one gets remainder (dust fix)
        let last_idx = recipients.len() - 1;
        let mut distributed: u64 = 0;

        for (i, recipient_account) in remaining.iter().enumerate() {
            require!(recipient_account.key() == recipients[i], RouterError::RecipientMismatch);
            require!(recipient_account.is_writable, RouterError::RecipientNotWritable);

            let share = if i == last_idx {
                // Last recipient gets remainder to prevent dust loss
                distributable - distributed
            } else {
                (distributable as u128 * shares_bps[i] as u128 / BPS_DENOMINATOR as u128) as u64
            };

            if share > 0 {
                system_program::transfer(
                    CpiContext::new(
                        ctx.accounts.system_program.to_account_info(),
                        system_program::Transfer {
                            from: ctx.accounts.payer.to_account_info(),
                            to: recipient_account.to_account_info(),
                        },
                    ),
                    share,
                )?;
            }

            distributed += share;
        }

        let config = &mut ctx.accounts.config;
        config.total_routed += amount;
        config.total_fees_collected += fee;

        emit!(SplitPaymentRouted {
            payer: ctx.accounts.payer.key(),
            total: amount,
            fee,
            recipient_count: recipients.len() as u8,
        });

        Ok(())
    }

    /// Update platform fee (authority only).
    pub fn set_platform_fee(ctx: Context<UpdateConfig>, new_fee_bps: u16) -> Result<()> {
        require!(new_fee_bps <= MAX_FEE_BPS, RouterError::FeeTooHigh);
        ctx.accounts.config.platform_fee_bps = new_fee_bps;
        Ok(())
    }

    /// Update treasury address (authority only).
    pub fn set_treasury(ctx: Context<UpdateConfig>, new_treasury: Pubkey) -> Result<()> {
        require!(new_treasury != Pubkey::default(), RouterError::ZeroAddress);
        ctx.accounts.config.treasury = new_treasury;
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

pub const BPS_DENOMINATOR: u64 = 10_000;
pub const MAX_FEE_BPS: u16 = 5_000; // 50% max
pub const MAX_SPLIT_RECIPIENTS: usize = 10;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

#[account]
#[derive(InitSpace)]
pub struct RouterConfig {
    pub authority: Pubkey,
    pub treasury: Pubkey,
    pub platform_fee_bps: u16,
    pub total_routed: u64,
    pub total_fees_collected: u64,
    pub bump: u8,
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
        space = 8 + RouterConfig::INIT_SPACE,
        seeds = [b"router_config"],
        bump,
    )]
    pub config: Account<'info, RouterConfig>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RoutePayment<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        seeds = [b"router_config"],
        bump = config.bump,
    )]
    pub config: Account<'info, RouterConfig>,

    /// CHECK: Treasury receives fees.
    #[account(mut, constraint = treasury.key() == config.treasury @ RouterError::InvalidTreasury)]
    pub treasury: UncheckedAccount<'info>,

    /// CHECK: Creator/recipient receives payment.
    #[account(mut)]
    pub recipient: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RouteSplitPayment<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        seeds = [b"router_config"],
        bump = config.bump,
    )]
    pub config: Account<'info, RouterConfig>,

    /// CHECK: Treasury receives fees.
    #[account(mut, constraint = treasury.key() == config.treasury @ RouterError::InvalidTreasury)]
    pub treasury: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
    // Remaining accounts: recipient wallets (mutable, in order matching `recipients` vec)
}

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    #[account(constraint = config.authority == authority.key() @ RouterError::Unauthorized)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"router_config"],
        bump = config.bump,
    )]
    pub config: Account<'info, RouterConfig>,
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

#[event]
pub struct PaymentRouted {
    pub payer: Pubkey,
    pub recipient: Pubkey,
    pub total: u64,
    pub fee: u64,
    pub creator_amount: u64,
}

#[event]
pub struct SplitPaymentRouted {
    pub payer: Pubkey,
    pub total: u64,
    pub fee: u64,
    pub recipient_count: u8,
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[error_code]
pub enum RouterError {
    #[msg("Not authorized")]
    Unauthorized,
    #[msg("Amount must be > 0")]
    ZeroAmount,
    #[msg("Platform fee too high (max 50%)")]
    FeeTooHigh,
    #[msg("Address cannot be zero")]
    ZeroAddress,
    #[msg("Invalid treasury address")]
    InvalidTreasury,
    #[msg("Recipients and shares arrays must match")]
    MismatchedArrays,
    #[msg("Too many recipients (max 10)")]
    TooManyRecipients,
    #[msg("Shares must sum to 10000 bps")]
    SharesDontSumTo100,
    #[msg("Recipient account mismatch")]
    RecipientMismatch,
    #[msg("Recipient account must be writable")]
    RecipientNotWritable,
}
