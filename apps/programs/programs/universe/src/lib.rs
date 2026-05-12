//! LOAR Universe — canonical IP container on Solana.
//!
//! Sister to apps/contracts/src/Universe.sol. A Universe PDA tracks the
//! creator, a content hash (matching the bytes32 hash used on EVM so
//! cross-chain identity is preserved), and a monotonic canon counter.
//! Episodes mint cNFTs via the `episode` program and reference the
//! Universe PDA by seed.

use anchor_lang::prelude::*;

// Placeholder — replaced with the real program ID by `anchor keys sync` on
// first build. Until then, this is the System Program ID (all-zeros pubkey),
// which is a valid base58-32 value so the macro compiles.
declare_id!("6YTQVSeauk4x5gycMM2wzkR8mdHEnHAYsz3Ygg26UPtD");

#[program]
pub mod universe {
    use super::*;

    /// Initialize a Universe. Idempotent on (creator, content_hash) — the PDA
    /// derivation prevents duplicate creation.
    pub fn initialize_universe(
        ctx: Context<InitializeUniverse>,
        content_hash: [u8; 32],
        plot_hash: [u8; 32],
        visibility: Visibility,
    ) -> Result<()> {
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
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateUniverse<'info> {
    pub signer: Signer<'info>,
    #[account(mut)]
    pub universe: Account<'info, Universe>,
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

#[error_code]
pub enum UniverseError {
    #[msg("Only the universe creator may perform this action")]
    Unauthorized,
    #[msg("Universe is already public")]
    AlreadyPublic,
    #[msg("Canon counter overflowed")]
    CounterOverflow,
}
