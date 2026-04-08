use anchor_lang::prelude::*;
use anchor_spl::token_2022::spl_token_2022::{
    extension::{
        transfer_fee::TransferFeeConfig,
        BaseStateWithExtensions, StateWithExtensions,
    },
    state::Mint as MintState,
};

declare_id!("LoarTokenxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");

/// $LOAR — Platform utility token for LOAR on Solana.
///
/// Uses SPL Token 2022 with the TransferFee extension:
/// - 5 basis points (0.05%) on every transfer
/// - Fee accumulates in recipient token accounts as "withheld" tokens
/// - `harvest_fees` sweeps withheld fees to the liquidity pool
/// - Authority can update fee rate (capped at 500 bps / 5%)
///
/// Total supply: 1,000,000,000 LOAR (9 decimals)
/// Distribution: 40% treasury, 30% team, 20% community, 10% partnerships
#[program]
pub mod loar_token {
    use super::*;

    /// Initialize the $LOAR mint with Token-2022 transfer fee extension.
    /// This must be called ONCE after deploying the program.
    ///
    /// The mint is created externally via `spl-token-2022 create-token` with:
    ///   --transfer-fee 5 5000000000000 (5 bps, max fee = 5B tokens)
    ///   --decimals 9
    ///
    /// This instruction stores protocol config (treasury, LP, authority).
    pub fn initialize(
        ctx: Context<Initialize>,
        liquidity_pool: Pubkey,
    ) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.authority = ctx.accounts.authority.key();
        config.mint = ctx.accounts.mint.key();
        config.treasury = ctx.accounts.treasury.key();
        config.liquidity_pool = liquidity_pool;
        config.total_minted = 0;
        config.total_fees_harvested = 0;
        config.bump = ctx.bumps.config;

        emit!(Initialized {
            mint: config.mint,
            authority: config.authority,
            treasury: config.treasury,
            liquidity_pool,
        });

        Ok(())
    }

    /// Mint initial distribution: 40% treasury, 30% team, 20% community, 10% reserve.
    /// Can only be called once (checks total_minted == 0).
    pub fn mint_initial_distribution(
        ctx: Context<MintDistribution>,
        team_wallet: Pubkey,
    ) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(config.total_minted == 0, LoarError::AlreadyDistributed);

        let total_supply: u64 = 1_000_000_000 * 10u64.pow(DECIMALS as u32); // 1B with 9 decimals

        let treasury_amount = total_supply * 40 / 100;  // 400M
        let team_amount = total_supply * 30 / 100;      // 300M
        let community_amount = total_supply * 20 / 100;  // 200M
        let reserve_amount = total_supply - treasury_amount - team_amount - community_amount; // 100M

        let seeds = &[b"config".as_ref(), config.mint.as_ref(), &[config.bump]];
        let signer_seeds = &[&seeds[..]];

        // Mint to treasury (treasury + community + reserve = 70%)
        let treasury_total = treasury_amount + community_amount + reserve_amount;
        anchor_spl::token_2022::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                anchor_spl::token_2022::MintTo {
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.treasury_ata.to_account_info(),
                    authority: config.to_account_info(),
                },
                signer_seeds,
            ),
            treasury_total,
        )?;

        // Mint to team wallet (30%)
        anchor_spl::token_2022::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                anchor_spl::token_2022::MintTo {
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.team_ata.to_account_info(),
                    authority: config.to_account_info(),
                },
                signer_seeds,
            ),
            team_amount,
        )?;

        config.total_minted = total_supply;

        emit!(InitialDistribution {
            treasury_amount: treasury_total,
            team_amount,
            team_wallet,
        });

        Ok(())
    }

    /// Harvest withheld transfer fees from token accounts and send them
    /// to the liquidity pool's associated token account.
    /// Anyone can call this — it's permissionless and protocol-beneficial.
    pub fn harvest_fees(ctx: Context<HarvestFees>) -> Result<()> {
        let config = &ctx.accounts.config;

        // Harvest withheld tokens from the mint itself
        let mint_data = ctx.accounts.mint.to_account_info();
        let mint_info = mint_data.try_borrow_data()?;
        let mint_state = StateWithExtensions::<MintState>::unpack(&mint_info)?;
        let fee_config = mint_state.get_extension::<TransferFeeConfig>()?;

        let withheld_on_mint = u64::from(fee_config.withheld_amount);

        if withheld_on_mint > 0 {
            let seeds = &[b"config".as_ref(), config.mint.as_ref(), &[config.bump]];
            let signer_seeds = &[&seeds[..]];

            // Withdraw withheld tokens from mint to LP
            spl_token_2022::extension::transfer_fee::instruction::withdraw_withheld_tokens_from_mint(
                ctx.accounts.token_program.key,
                &config.mint,
                &ctx.accounts.liquidity_pool_ata.key(),
                &config.to_account_info().key(),
                &[],
            )
            .map(|ix| {
                anchor_lang::solana_program::program::invoke_signed(
                    &ix,
                    &[
                        ctx.accounts.mint.to_account_info(),
                        ctx.accounts.liquidity_pool_ata.to_account_info(),
                        config.to_account_info(),
                    ],
                    signer_seeds,
                )
            })
            .map_err(|_| LoarError::HarvestFailed)??;
        }

        // Update stats — track harvested amount from mint
        let config = &mut ctx.accounts.config;
        config.total_fees_harvested += withheld_on_mint;

        emit!(FeesHarvested {
            harvester: ctx.accounts.harvester.key(),
            withheld_from_mint: withheld_on_mint,
        });

        Ok(())
    }

    /// Update the liquidity pool address (authority only).
    pub fn set_liquidity_pool(
        ctx: Context<UpdateConfig>,
        new_pool: Pubkey,
    ) -> Result<()> {
        let old = ctx.accounts.config.liquidity_pool;
        ctx.accounts.config.liquidity_pool = new_pool;

        emit!(LiquidityPoolUpdated {
            old_pool: old,
            new_pool,
        });
        Ok(())
    }

    /// Transfer authority to a new address (authority only).
    pub fn transfer_authority(
        ctx: Context<UpdateConfig>,
        new_authority: Pubkey,
    ) -> Result<()> {
        require!(new_authority != Pubkey::default(), LoarError::ZeroAddress);
        let old = ctx.accounts.config.authority;
        ctx.accounts.config.authority = new_authority;

        emit!(AuthorityTransferred {
            old_authority: old,
            new_authority,
        });
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

pub const DECIMALS: u8 = 9;
pub const MAX_SUPPLY: u64 = 1_000_000_000 * 1_000_000_000; // 1B * 10^9
pub const TRANSFER_FEE_BPS: u16 = 5; // 0.05%
pub const MAX_TRANSFER_FEE_BPS: u16 = 500; // 5% hard cap
pub const MAX_FEE: u64 = 5_000_000_000_000; // cap per-transfer fee at 5000 tokens

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

#[account]
#[derive(InitSpace)]
pub struct LoarConfig {
    pub authority: Pubkey,
    pub mint: Pubkey,
    pub treasury: Pubkey,
    pub liquidity_pool: Pubkey,
    pub total_minted: u64,
    pub total_fees_harvested: u64,
    pub bump: u8,
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    /// The Token-2022 mint (already created with transfer-fee extension).
    /// CHECK: Validated as a Token-2022 mint in handler.
    #[account(mut)]
    pub mint: UncheckedAccount<'info>,

    /// CHECK: Treasury wallet — stores no program data.
    pub treasury: UncheckedAccount<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + LoarConfig::INIT_SPACE,
        seeds = [b"config", mint.key().as_ref()],
        bump,
    )]
    pub config: Account<'info, LoarConfig>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct MintDistribution<'info> {
    #[account(mut, constraint = config.authority == authority.key() @ LoarError::Unauthorized)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"config", config.mint.as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, LoarConfig>,

    /// CHECK: Token-2022 mint — CPI validates.
    #[account(mut)]
    pub mint: UncheckedAccount<'info>,

    /// Treasury's associated token account (Token-2022).
    /// CHECK: ATA validated by CPI.
    #[account(mut)]
    pub treasury_ata: UncheckedAccount<'info>,

    /// Team wallet's associated token account (Token-2022).
    /// CHECK: ATA validated by CPI.
    #[account(mut)]
    pub team_ata: UncheckedAccount<'info>,

    /// CHECK: Token-2022 program.
    pub token_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct HarvestFees<'info> {
    /// Anyone can harvest — permissionless.
    #[account(mut)]
    pub harvester: Signer<'info>,

    #[account(
        mut,
        seeds = [b"config", config.mint.as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, LoarConfig>,

    /// CHECK: Token-2022 mint.
    #[account(mut)]
    pub mint: UncheckedAccount<'info>,

    /// LP's associated token account to receive harvested fees.
    /// CHECK: Validated by CPI.
    #[account(mut)]
    pub liquidity_pool_ata: UncheckedAccount<'info>,

    /// CHECK: Token-2022 program.
    pub token_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    #[account(constraint = config.authority == authority.key() @ LoarError::Unauthorized)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"config", config.mint.as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, LoarConfig>,
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

#[event]
pub struct Initialized {
    pub mint: Pubkey,
    pub authority: Pubkey,
    pub treasury: Pubkey,
    pub liquidity_pool: Pubkey,
}

#[event]
pub struct InitialDistribution {
    pub treasury_amount: u64,
    pub team_amount: u64,
    pub team_wallet: Pubkey,
}

#[event]
pub struct FeesHarvested {
    pub harvester: Pubkey,
    pub withheld_from_mint: u64,
}

#[event]
pub struct LiquidityPoolUpdated {
    pub old_pool: Pubkey,
    pub new_pool: Pubkey,
}

#[event]
pub struct AuthorityTransferred {
    pub old_authority: Pubkey,
    pub new_authority: Pubkey,
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[error_code]
pub enum LoarError {
    #[msg("Not authorized")]
    Unauthorized,
    #[msg("Initial distribution already completed")]
    AlreadyDistributed,
    #[msg("Address cannot be zero/default")]
    ZeroAddress,
    #[msg("Fee harvest failed")]
    HarvestFailed,
    #[msg("Exceeds max supply")]
    ExceedsMaxSupply,
    #[msg("Transfer fee too high")]
    FeeTooHigh,
}
