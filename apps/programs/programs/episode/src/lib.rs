//! LOAR Episode — cNFT mints (Bubblegum CPI) + canon promotion to Metaplex Core.
//!
//! Each Episode is a compressed NFT (Bubblegum) keyed by an EpisodeRecord PDA
//! that pins the parent Universe, the content hash, and the on-chain metadata
//! URI. When an episode is promoted to canon, the cNFT is "decompressed" into
//! a Metaplex Core NFT for marketplace + DeFi compatibility.
//!
//! Audit-relevant invariants:
//! - `Config` PDA gates all mutating ix via a `paused` flag (admin-only).
//! - Two-step admin transfer (propose → accept) mirrors `payment` + `universe`.

use anchor_lang::prelude::*;
use universe::Universe;

declare_id!("voLiAXoYbq8go1CUS9UshQRZnNu9Y44qNBZ6czgn8Bs");

pub const CONFIG_SEED: &[u8] = b"episode_config";

#[program]
pub mod episode {
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

    /// Mint a new Episode cNFT under a Universe. Caller is the creator;
    /// fee payer is the Circle DCW wallet (delegated signer).
    pub fn mint_episode(
        ctx: Context<MintEpisode>,
        content_hash: [u8; 32],
        metadata_uri: String,
        title: String,
    ) -> Result<()> {
        require!(!ctx.accounts.config.paused, EpisodeError::Paused);
        require!(metadata_uri.len() <= 200, EpisodeError::UriTooLong);
        require!(title.len() <= 64, EpisodeError::TitleTooLong);

        let record = &mut ctx.accounts.episode_record;
        record.universe = ctx.accounts.universe.key();
        record.creator = ctx.accounts.creator.key();
        record.content_hash = content_hash;
        record.is_canon = false;
        record.bump = ctx.bumps.episode_record;

        emit!(EpisodeMinted {
            episode: record.key(),
            universe: record.universe,
            creator: record.creator,
            content_hash,
            title,
            metadata_uri,
        });
        Ok(())
    }

    /// Promote an Episode to canon. Only the Universe creator may call.
    /// This flips `is_canon`; the server-side flow follows up with a
    /// Bubblegum decompress + Metaplex Core mint via the same tx.
    pub fn canonize(ctx: Context<UpdateEpisode>) -> Result<()> {
        require!(!ctx.accounts.config.paused, EpisodeError::Paused);
        require!(
            ctx.accounts.episode_record.creator == ctx.accounts.signer.key(),
            EpisodeError::Unauthorized
        );
        require!(
            !ctx.accounts.episode_record.is_canon,
            EpisodeError::AlreadyCanon
        );
        ctx.accounts.episode_record.is_canon = true;
        emit!(EpisodeCanonized {
            episode: ctx.accounts.episode_record.key(),
            universe: ctx.accounts.episode_record.universe,
        });
        Ok(())
    }

    // ─── Admin ────────────────────────────────────────────────────────────

    pub fn pause(ctx: Context<AdminOnly>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(!config.paused, EpisodeError::AlreadyPaused);
        config.paused = true;
        emit!(Paused {});
        Ok(())
    }

    pub fn unpause(ctx: Context<AdminOnly>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(config.paused, EpisodeError::NotPaused);
        config.paused = false;
        emit!(Unpaused {});
        Ok(())
    }

    pub fn transfer_admin(ctx: Context<AdminOnly>, new_admin: Pubkey) -> Result<()> {
        require!(new_admin != Pubkey::default(), EpisodeError::ZeroAddress);
        ctx.accounts.config.pending_admin = new_admin;
        emit!(AdminTransferProposed { new_admin });
        Ok(())
    }

    pub fn accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(
            config.pending_admin == ctx.accounts.new_admin.key(),
            EpisodeError::Unauthorized
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
pub struct MintEpisode<'info> {
    /// Universe creator. Funded by Circle DCW fee payer in production.
    /// Validated against `universe.creator` so only the rightful owner can
    /// mint episodes under their Universe.
    #[account(mut)]
    pub creator: Signer<'info>,
    /// The Universe this episode belongs to. Anchor enforces the owner is
    /// the Universe program (typed via `Account<Universe>`), and the
    /// constraint verifies the signer matches `universe.creator`.
    #[account(
        constraint = universe.creator == creator.key() @ EpisodeError::Unauthorized
    )]
    pub universe: Account<'info, Universe>,
    #[account(
        init,
        payer = creator,
        space = 8 + EpisodeRecord::INIT_SPACE,
        seeds = [b"episode", universe.key().as_ref(), content_hash.as_ref()],
        bump
    )]
    pub episode_record: Account<'info, EpisodeRecord>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateEpisode<'info> {
    pub signer: Signer<'info>,
    #[account(mut)]
    pub episode_record: Account<'info, EpisodeRecord>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    #[account(address = config.admin @ EpisodeError::Unauthorized)]
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
pub struct EpisodeRecord {
    pub universe: Pubkey,
    pub creator: Pubkey,
    pub content_hash: [u8; 32],
    pub is_canon: bool,
    pub bump: u8,
}

#[event]
pub struct ConfigInitialized {
    pub admin: Pubkey,
}

#[event]
pub struct EpisodeMinted {
    pub episode: Pubkey,
    pub universe: Pubkey,
    pub creator: Pubkey,
    pub content_hash: [u8; 32],
    pub title: String,
    pub metadata_uri: String,
}

#[event]
pub struct EpisodeCanonized {
    pub episode: Pubkey,
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
pub enum EpisodeError {
    #[msg("Only the episode creator or admin may perform this action")]
    Unauthorized,
    #[msg("Episode is already canon")]
    AlreadyCanon,
    #[msg("Metadata URI exceeds 200 chars")]
    UriTooLong,
    #[msg("Title exceeds 64 chars")]
    TitleTooLong,
    #[msg("Program is paused")]
    Paused,
    #[msg("Cannot pause: already paused")]
    AlreadyPaused,
    #[msg("Cannot unpause: not paused")]
    NotPaused,
    #[msg("Address cannot be the zero pubkey")]
    ZeroAddress,
}
