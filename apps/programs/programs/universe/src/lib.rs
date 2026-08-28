//! LOAR Universe — canonical IP container on Solana.
//!
//! Sister to apps/contracts/src/Universe.sol. A Universe PDA tracks the
//! creator, a content hash (matching the bytes32 hash used on EVM so
//! cross-chain identity is preserved), and a monotonic canon counter.
//! Episodes mint cNFTs via the `episode` program and reference the
//! Universe PDA by seed.
//!
//! Audit-relevant invariants:
//! - `Config` PDA gates all mutating ix via a `paused` flag. Pause is
//!   admin-only; existing Universe PDAs remain readable but no new writes
//!   land while paused.
//! - Two-step admin transfer (propose → accept) mirrors `payment`.

use anchor_lang::prelude::*;

declare_id!("6YTQVSeauk4x5gycMM2wzkR8mdHEnHAYsz3Ygg26UPtD");

pub const CONFIG_SEED: &[u8] = b"universe_config";

#[program]
pub mod universe {
    use super::*;

    /// Initialize the singleton config. Callable exactly once per program.
    pub fn initialize_config(ctx: Context<InitializeConfig>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.admin = ctx.accounts.admin.key();
        config.pending_admin = Pubkey::default();
        config.paused = false;
        config.bump = ctx.bumps.config;
        emit!(ConfigInitialized {
            admin: config.admin,
        });
        Ok(())
    }

    /// Initialize a Universe. Idempotent on (creator, content_hash) — the PDA
    /// derivation prevents duplicate creation.
    pub fn initialize_universe(
        ctx: Context<InitializeUniverse>,
        content_hash: [u8; 32],
        plot_hash: [u8; 32],
        visibility: Visibility,
    ) -> Result<()> {
        require!(!ctx.accounts.config.paused, UniverseError::Paused);

        let universe = &mut ctx.accounts.universe;
        universe.creator = ctx.accounts.creator.key();
        universe.content_hash = content_hash;
        universe.plot_hash = plot_hash;
        universe.visibility = visibility;
        universe.canon_count = 0;
        universe.bump = ctx.bumps.universe;

        emit!(UniverseCreated {
            universe: universe.key(),
            creator: universe.creator,
            content_hash,
            plot_hash,
            visibility,
        });
        Ok(())
    }

    /// Promote a private universe to public (launchpad gate flips on).
    pub fn publish_universe(ctx: Context<UpdateUniverse>) -> Result<()> {
        require!(!ctx.accounts.config.paused, UniverseError::Paused);
        require!(
            ctx.accounts.universe.creator == ctx.accounts.signer.key(),
            UniverseError::Unauthorized
        );
        require!(
            ctx.accounts.universe.visibility == Visibility::Private,
            UniverseError::AlreadyPublic
        );
        ctx.accounts.universe.visibility = Visibility::Public;
        emit!(UniversePublished { universe: ctx.accounts.universe.key() });
        Ok(())
    }

    /// Bump canon counter. Called by the `episode` program via CPI when
    /// an episode is canonized.
    pub fn canonize_episode(ctx: Context<UpdateUniverse>) -> Result<()> {
        require!(!ctx.accounts.config.paused, UniverseError::Paused);
        require!(
            ctx.accounts.universe.creator == ctx.accounts.signer.key(),
            UniverseError::Unauthorized
        );
        let universe = &mut ctx.accounts.universe;
        universe.canon_count = universe
            .canon_count
            .checked_add(1)
            .ok_or(UniverseError::CounterOverflow)?;
        Ok(())
    }

    // ─── Admin ────────────────────────────────────────────────────────────

    pub fn pause(ctx: Context<AdminOnly>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(!config.paused, UniverseError::AlreadyPaused);
        config.paused = true;
        emit!(Paused {});
        Ok(())
    }

    pub fn unpause(ctx: Context<AdminOnly>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(config.paused, UniverseError::NotPaused);
        config.paused = false;
        emit!(Unpaused {});
        Ok(())
    }

    /// Step 1 of admin transfer — current admin proposes the new admin.
    pub fn transfer_admin(ctx: Context<AdminOnly>, new_admin: Pubkey) -> Result<()> {
        require!(new_admin != Pubkey::default(), UniverseError::ZeroAddress);
        ctx.accounts.config.pending_admin = new_admin;
        emit!(AdminTransferProposed { new_admin });
        Ok(())
    }

    /// Step 2 of admin transfer — pending admin accepts. Atomic flip.
    pub fn accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(
            config.pending_admin == ctx.accounts.new_admin.key(),
            UniverseError::Unauthorized
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
pub struct InitializeUniverse<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(
        init,
        payer = creator,
        space = 8 + Universe::INIT_SPACE,
        seeds = [b"universe", creator.key().as_ref(), content_hash.as_ref()],
        bump
    )]
    pub universe: Account<'info, Universe>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateUniverse<'info> {
    pub signer: Signer<'info>,
    #[account(mut)]
    pub universe: Account<'info, Universe>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    #[account(address = config.admin @ UniverseError::Unauthorized)]
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
pub struct Universe {
    pub creator: Pubkey,
    pub content_hash: [u8; 32],
    pub plot_hash: [u8; 32],
    pub visibility: Visibility,
    pub canon_count: u64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum Visibility {
    Private,
    Public,
}

#[event]
pub struct ConfigInitialized {
    pub admin: Pubkey,
}

#[event]
pub struct UniverseCreated {
    pub universe: Pubkey,
    pub creator: Pubkey,
    pub content_hash: [u8; 32],
    pub plot_hash: [u8; 32],
    pub visibility: Visibility,
}

#[event]
pub struct UniversePublished {
    pub universe: Pubkey,
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

#[error_code]
pub enum UniverseError {
    #[msg("Only the universe creator or admin may perform this action")]
    Unauthorized,
    #[msg("Universe is already public")]
    AlreadyPublic,
    #[msg("Canon counter overflowed")]
    CounterOverflow,
    #[msg("Program is paused")]
    Paused,
    #[msg("Cannot pause: already paused")]
    AlreadyPaused,
    #[msg("Cannot unpause: not paused")]
    NotPaused,
    #[msg("Address cannot be the zero pubkey")]
    ZeroAddress,
}
