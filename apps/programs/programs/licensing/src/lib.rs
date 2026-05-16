//! LOAR Licensing — content registration + BUY deals on Solana.
//!
//! Sister to `apps/contracts/src/revenue/ContentLicensing.sol`. v1 scope:
//! BUY-only deals. RENT + LICENSE deal types are deferred to S2 because
//! Solana's per-tx fee model + native marketplace conventions (Tensor / ME
//! for secondary, Streamflow for vesting/recurring) make a 1:1 port of the
//! EVM time-bound deal types a misfit; a separate design pass will land
//! those as v2.
//!
//! Rights gate: registration requires the `Rights` PDA from the `rights`
//! program to be passed AND `rights.is_monetizable()` to return true. This
//! mirrors the EVM `RightsRegistry.isMonetizable` check in
//! `ContentLicensing.registerContent` (CONTENT-01 audit fix). Anchor's
//! account-type system enforces the Rights PDA is owned by the configured
//! rights program — a forged account from another program won't deserialize.
//!
//! Audit-relevant invariants (parallels EVM after CONTENT-* / LICENSE-* fixes):
//! - `Registration.creator` is set on first call and never overwritten —
//!   `update_pricing` requires `creator == signer`. (LICENSE-01 analog)
//! - `register_content` checks rights gate before any state writes. (CONTENT-01)
//! - `buy_content` transfers `buy_price` lamports atomically with deal
//!   creation. No partial-pay state.
//! - `content_owner` updates on BUY (last buyer is the new owner).
//! - `Config.paused` blocks all writes; reads remain available.
//! - All u64 arithmetic uses `checked_*` (no silent overflow).
//! - PDAs:
//!     Registration = ["registration", content_hash]
//!     BuyerDeal    = ["buyer_deal", content_hash, buyer.key()]
//!     Config       = ["licensing_config"]

use anchor_lang::prelude::*;
use anchor_lang::system_program;
use rights::{Rights, RightsType};

declare_id!("HTQhzknwF5mnnhHVSaF5ckRbeviwX2UuwayPNjiQybTp");

pub const CONFIG_SEED: &[u8] = b"licensing_config";
pub const REGISTRATION_SEED: &[u8] = b"registration";
pub const BUYER_DEAL_SEED: &[u8] = b"buyer_deal";

#[program]
pub mod licensing {
    use super::*;

    /// Initialize the singleton config. Callable exactly once per program.
    pub fn initialize_config(ctx: Context<InitializeConfig>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.admin = ctx.accounts.admin.key();
        config.pending_admin = Pubkey::default();
        config.paused = false;
        config.bump = ctx.bumps.config;
        emit!(ConfigInitialized { admin: config.admin });
        Ok(())
    }

    /// Register a content piece for sale. Gated by rights cache: the
    /// `Rights` PDA for this content_hash must exist and return
    /// `is_monetizable()` = true.
    ///
    /// Idempotency: PDA derivation locks one Registration per content_hash.
    /// Re-registration of the same hash by the same creator is allowed via
    /// `update_pricing`.
    pub fn register_content(
        ctx: Context<RegisterContent>,
        content_hash: [u8; 32],
        universe: Pubkey,
        buy_price_lamports: u64,
    ) -> Result<()> {
        require!(!ctx.accounts.config.paused, LicensingError::Paused);
        require!(content_hash != [0u8; 32], LicensingError::ZeroHash);
        require!(buy_price_lamports > 0, LicensingError::ZeroPrice);

        // Rights gate. The account must (1) match the content_hash via PDA
        // seeds enforced in the Accounts struct, (2) carry a monetizable
        // classification. (1) is enforced via the constraint below; (2) here.
        let rights = &ctx.accounts.rights;
        require!(
            matches!(
                rights.rights_type,
                RightsType::Original | RightsType::Licensed | RightsType::PublicDomain
            ),
            LicensingError::NotMonetizable
        );

        let registration = &mut ctx.accounts.registration;
        registration.content_hash = content_hash;
        registration.creator = ctx.accounts.creator.key();
        registration.universe = universe;
        registration.buy_price_lamports = buy_price_lamports;
        registration.active = true;
        registration.bump = ctx.bumps.registration;

        emit!(ContentRegistered {
            content_hash,
            creator: registration.creator,
            universe,
            buy_price_lamports,
        });
        Ok(())
    }

    /// Update the buy price for already-registered content. Creator-only.
    pub fn update_pricing(
        ctx: Context<UpdatePricing>,
        new_buy_price_lamports: u64,
    ) -> Result<()> {
        require!(!ctx.accounts.config.paused, LicensingError::Paused);
        require!(new_buy_price_lamports > 0, LicensingError::ZeroPrice);

        let registration = &mut ctx.accounts.registration;
        require!(
            registration.creator == ctx.accounts.creator.key(),
            LicensingError::Unauthorized
        );
        registration.buy_price_lamports = new_buy_price_lamports;
        registration.active = true;
        emit!(PricingUpdated {
            content_hash: registration.content_hash,
            buy_price_lamports: new_buy_price_lamports,
        });
        Ok(())
    }

    /// Permanent sale. Buyer pays `buy_price_lamports` to the creator and
    /// receives a BuyerDeal PDA recording the purchase. `content_owner`
    /// (derived off-chain from the latest BuyerDeal) updates on this call.
    ///
    /// v1: payment goes directly to the creator's wallet. Platform-fee
    /// routing via the `payment` program CPI is a v2 follow-up — keeping
    /// the v1 surface small enough to audit independently of payment.
    pub fn buy_content(ctx: Context<BuyContent>) -> Result<()> {
        require!(!ctx.accounts.config.paused, LicensingError::Paused);
        let registration = &ctx.accounts.registration;
        require!(registration.active, LicensingError::Inactive);
        require!(registration.buy_price_lamports > 0, LicensingError::NotForSale);
        // Creator must match the account passed as recipient — guards against
        // a forged `creator` pubkey rerouting the payout.
        require!(
            registration.creator == ctx.accounts.creator.key(),
            LicensingError::CreatorMismatch
        );

        // Atomic SOL transfer from buyer to creator via the System Program
        // CPI. Done before BuyerDeal init so insufficient-funds reverts
        // surface before we mint storage rent.
        let cpi_ctx = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.buyer.to_account_info(),
                to: ctx.accounts.creator.to_account_info(),
            },
        );
        system_program::transfer(cpi_ctx, registration.buy_price_lamports)?;

        let deal = &mut ctx.accounts.buyer_deal;
        deal.content_hash = registration.content_hash;
        deal.buyer = ctx.accounts.buyer.key();
        deal.price_paid = registration.buy_price_lamports;
        deal.purchased_at = Clock::get()?.unix_timestamp;
        deal.bump = ctx.bumps.buyer_deal;

        emit!(ContentBought {
            content_hash: registration.content_hash,
            buyer: deal.buyer,
            creator: registration.creator,
            price_paid: deal.price_paid,
        });
        Ok(())
    }

    /// Deactivate a registration. Creator-only. Idempotent.
    pub fn deactivate_content(ctx: Context<UpdatePricing>) -> Result<()> {
        require!(!ctx.accounts.config.paused, LicensingError::Paused);
        let registration = &mut ctx.accounts.registration;
        require!(
            registration.creator == ctx.accounts.creator.key(),
            LicensingError::Unauthorized
        );
        registration.active = false;
        emit!(ContentDeactivated { content_hash: registration.content_hash });
        Ok(())
    }

    // ─── Admin ────────────────────────────────────────────────────────────

    pub fn pause(ctx: Context<AdminOnly>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(!config.paused, LicensingError::AlreadyPaused);
        config.paused = true;
        emit!(Paused {});
        Ok(())
    }

    pub fn unpause(ctx: Context<AdminOnly>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(config.paused, LicensingError::NotPaused);
        config.paused = false;
        emit!(Unpaused {});
        Ok(())
    }

    pub fn transfer_admin(ctx: Context<AdminOnly>, new_admin: Pubkey) -> Result<()> {
        require!(new_admin != Pubkey::default(), LicensingError::ZeroAddress);
        ctx.accounts.config.pending_admin = new_admin;
        emit!(AdminTransferProposed { new_admin });
        Ok(())
    }

    pub fn accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(
            config.pending_admin == ctx.accounts.new_admin.key(),
            LicensingError::Unauthorized
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
#[instruction(content_hash: [u8; 32])]
pub struct RegisterContent<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    /// Rights cache PDA from the rights program. Anchor's `Account<Rights>`
    /// type enforces the owner-program check — only an account owned by the
    /// rights program deserializes successfully. The seed constraint ties it
    /// to the same content_hash we're registering, so the caller can't pass
    /// a Rights record for a different (already-monetizable) content piece.
    #[account(
        seeds = [rights::RIGHTS_SEED, content_hash.as_ref()],
        bump = rights.bump,
        seeds::program = rights::ID,
    )]
    pub rights: Account<'info, Rights>,

    #[account(
        init,
        payer = creator,
        space = 8 + Registration::INIT_SPACE,
        seeds = [REGISTRATION_SEED, content_hash.as_ref()],
        bump
    )]
    pub registration: Account<'info, Registration>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdatePricing<'info> {
    pub creator: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [REGISTRATION_SEED, registration.content_hash.as_ref()],
        bump = registration.bump,
    )]
    pub registration: Account<'info, Registration>,
}

#[derive(Accounts)]
pub struct BuyContent<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,

    /// Creator account (recipient of the SOL transfer). Validated against
    /// `registration.creator` inside the instruction body — a forged pubkey
    /// trips the CreatorMismatch error before any lamports move.
    /// CHECK: This is a System-owned account that receives lamports; no
    /// data deserialization required and we verify the pubkey above.
    #[account(mut)]
    pub creator: AccountInfo<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(
        seeds = [REGISTRATION_SEED, registration.content_hash.as_ref()],
        bump = registration.bump,
    )]
    pub registration: Account<'info, Registration>,

    #[account(
        init,
        payer = buyer,
        space = 8 + BuyerDeal::INIT_SPACE,
        seeds = [BUYER_DEAL_SEED, registration.content_hash.as_ref(), buyer.key().as_ref()],
        bump,
    )]
    pub buyer_deal: Account<'info, BuyerDeal>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    #[account(address = config.admin @ LicensingError::Unauthorized)]
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
pub struct Registration {
    pub content_hash: [u8; 32],
    pub creator: Pubkey,
    pub universe: Pubkey,
    pub buy_price_lamports: u64,
    pub active: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct BuyerDeal {
    pub content_hash: [u8; 32],
    pub buyer: Pubkey,
    pub price_paid: u64,
    pub purchased_at: i64,
    pub bump: u8,
}

// ─── Events ──────────────────────────────────────────────────────────────────

#[event]
pub struct ConfigInitialized {
    pub admin: Pubkey,
}

#[event]
pub struct ContentRegistered {
    pub content_hash: [u8; 32],
    pub creator: Pubkey,
    pub universe: Pubkey,
    pub buy_price_lamports: u64,
}

#[event]
pub struct PricingUpdated {
    pub content_hash: [u8; 32],
    pub buy_price_lamports: u64,
}

#[event]
pub struct ContentDeactivated {
    pub content_hash: [u8; 32],
}

#[event]
pub struct ContentBought {
    pub content_hash: [u8; 32],
    pub buyer: Pubkey,
    pub creator: Pubkey,
    pub price_paid: u64,
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
pub enum LicensingError {
    #[msg("Only the configured creator or admin may perform this action")]
    Unauthorized,
    #[msg("Content hash cannot be all zeros")]
    ZeroHash,
    #[msg("Price must be greater than zero")]
    ZeroPrice,
    #[msg("Content is not monetizable per the rights cache (Unset/Fun/Frozen)")]
    NotMonetizable,
    #[msg("Registration is inactive")]
    Inactive,
    #[msg("Content is not listed for sale")]
    NotForSale,
    #[msg("Creator pubkey does not match the registration's recorded creator")]
    CreatorMismatch,
    #[msg("Program is paused")]
    Paused,
    #[msg("Cannot pause: already paused")]
    AlreadyPaused,
    #[msg("Cannot unpause: not paused")]
    NotPaused,
    #[msg("Address cannot be the zero pubkey")]
    ZeroAddress,
}
