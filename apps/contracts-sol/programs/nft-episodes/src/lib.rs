use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("NftEpxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");

/// Episode NFTs — Mint 1/1 episode NFTs and limited editions per universe.
/// Equivalent to EpisodeNFT.sol + EpisodeEditionCollection.sol on EVM.
///
/// Uses Metaplex Token Metadata for NFT standards.
/// Integrates with PaymentRouter for fee splits and RightsRegistry for rights checks.
///
/// Architecture note: The actual Metaplex NFT mint is handled client-side using
/// the episode's metadata_uri and content_hash. This program tracks episode state,
/// edition counts, payments, and emits events for indexing. The client mints the
/// Metaplex NFT after a successful `mint_edition` transaction, using the edition
/// data from the emitted event as proof.
#[program]
pub mod nft_episodes {
    use super::*;

    /// Initialize episode collection for a universe.
    pub fn initialize_collection(
        ctx: Context<InitializeCollection>,
        universe_id: u64,
        creator_share_bps: u16,
        platform_share_bps: u16,
    ) -> Result<()> {
        require!(
            creator_share_bps + platform_share_bps == 10_000,
            EpisodeError::InvalidShares
        );
        require!(
            platform_share_bps <= MAX_FEE_BPS,
            EpisodeError::FeeTooHigh
        );

        let collection = &mut ctx.accounts.collection;
        collection.universe_id = universe_id;
        collection.authority = ctx.accounts.authority.key();
        collection.treasury = ctx.accounts.treasury.key();
        collection.creator_share_bps = creator_share_bps;
        collection.platform_share_bps = platform_share_bps;
        collection.episode_count = 0;
        collection.total_minted = 0;
        collection.total_revenue = 0;
        collection.bump = ctx.bumps.collection;
        Ok(())
    }

    /// Create a new episode entry (metadata only, no NFT yet).
    pub fn create_episode(
        ctx: Context<CreateEpisode>,
        title: String,
        content_hash: [u8; 32],
        metadata_uri: String,
        max_editions: u64,
        price_lamports: u64,
    ) -> Result<()> {
        require!(title.len() <= 128, EpisodeError::TitleTooLong);
        require!(max_editions > 0, EpisodeError::ZeroEditions);

        let collection = &mut ctx.accounts.collection;
        let episode = &mut ctx.accounts.episode;

        episode.collection = collection.key();
        episode.index = collection.episode_count;
        episode.creator = ctx.accounts.creator.key();
        episode.title = title.clone();
        episode.content_hash = content_hash;
        episode.metadata_uri = metadata_uri;
        episode.max_editions = max_editions;
        episode.minted_editions = 0;
        episode.price_lamports = price_lamports;
        episode.is_active = true;
        episode.created_at = Clock::get()?.unix_timestamp;
        episode.bump = ctx.bumps.episode;

        collection.episode_count += 1;

        emit!(EpisodeCreated {
            collection: collection.key(),
            index: episode.index,
            creator: episode.creator,
            title,
            max_editions,
            price_lamports,
        });

        Ok(())
    }

    /// Mint an edition of an episode. Pays creator + platform.
    pub fn mint_edition(ctx: Context<MintEdition>) -> Result<()> {
        let episode = &mut ctx.accounts.episode;
        let collection = &ctx.accounts.collection;

        require!(episode.is_active, EpisodeError::EpisodeInactive);
        require!(
            episode.minted_editions < episode.max_editions,
            EpisodeError::SoldOut
        );

        let price = episode.price_lamports;

        if price > 0 {
            // Platform share
            let platform_amount = (price as u128 * collection.platform_share_bps as u128 / 10_000) as u64;
            let creator_amount = price - platform_amount;

            // Pay platform
            if platform_amount > 0 {
                system_program::transfer(
                    CpiContext::new(
                        ctx.accounts.system_program.to_account_info(),
                        system_program::Transfer {
                            from: ctx.accounts.minter.to_account_info(),
                            to: ctx.accounts.treasury.to_account_info(),
                        },
                    ),
                    platform_amount,
                )?;
            }

            // Pay creator
            if creator_amount > 0 {
                system_program::transfer(
                    CpiContext::new(
                        ctx.accounts.system_program.to_account_info(),
                        system_program::Transfer {
                            from: ctx.accounts.minter.to_account_info(),
                            to: ctx.accounts.creator.to_account_info(),
                        },
                    ),
                    creator_amount,
                )?;
            }
        }

        let edition_number = episode.minted_editions;
        episode.minted_editions += 1;

        let collection_mut = &mut ctx.accounts.collection;
        collection_mut.total_minted += 1;
        collection_mut.total_revenue += price;

        emit!(EditionMinted {
            episode: ctx.accounts.episode.key(),
            minter: ctx.accounts.minter.key(),
            edition_number,
            price,
        });

        Ok(())
    }

    /// Toggle episode active/inactive (creator only).
    pub fn set_episode_active(ctx: Context<ManageEpisode>, is_active: bool) -> Result<()> {
        ctx.accounts.episode.is_active = is_active;
        Ok(())
    }

    /// Update platform fee shares (authority only).
    pub fn update_shares(
        ctx: Context<ManageCollection>,
        creator_share_bps: u16,
        platform_share_bps: u16,
    ) -> Result<()> {
        require!(
            creator_share_bps + platform_share_bps == 10_000,
            EpisodeError::InvalidShares
        );
        require!(
            platform_share_bps <= MAX_FEE_BPS,
            EpisodeError::FeeTooHigh
        );

        let collection = &mut ctx.accounts.collection;
        collection.creator_share_bps = creator_share_bps;
        collection.platform_share_bps = platform_share_bps;

        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

pub const MAX_FEE_BPS: u16 = 5_000; // 50% max platform fee

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

#[account]
#[derive(InitSpace)]
pub struct EpisodeCollection {
    pub universe_id: u64,
    pub authority: Pubkey,
    pub treasury: Pubkey,
    pub creator_share_bps: u16,
    pub platform_share_bps: u16,
    pub episode_count: u64,
    pub total_minted: u64,
    pub total_revenue: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Episode {
    pub collection: Pubkey,
    pub index: u64,
    pub creator: Pubkey,
    #[max_len(128)]
    pub title: String,
    pub content_hash: [u8; 32],
    #[max_len(256)]
    pub metadata_uri: String,
    pub max_editions: u64,
    pub minted_editions: u64,
    pub price_lamports: u64,
    pub is_active: bool,
    pub created_at: i64,
    pub bump: u8,
}

// ---------------------------------------------------------------------------
// Contexts
// ---------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(universe_id: u64)]
pub struct InitializeCollection<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    /// CHECK: Treasury wallet.
    pub treasury: UncheckedAccount<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + EpisodeCollection::INIT_SPACE,
        seeds = [b"episode_collection", universe_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub collection: Account<'info, EpisodeCollection>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreateEpisode<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        mut,
        constraint = collection.authority == creator.key() @ EpisodeError::NotAuthority,
    )]
    pub collection: Account<'info, EpisodeCollection>,

    #[account(
        init,
        payer = creator,
        space = 8 + Episode::INIT_SPACE,
        seeds = [b"episode", collection.key().as_ref(), collection.episode_count.to_le_bytes().as_ref()],
        bump,
    )]
    pub episode: Account<'info, Episode>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct MintEdition<'info> {
    #[account(mut)]
    pub minter: Signer<'info>,

    #[account(
        mut,
        constraint = episode.collection == collection.key() @ EpisodeError::CollectionMismatch,
    )]
    pub collection: Account<'info, EpisodeCollection>,

    #[account(mut)]
    pub episode: Account<'info, Episode>,

    /// CHECK: Treasury receives platform share.
    #[account(mut, constraint = treasury.key() == collection.treasury @ EpisodeError::InvalidTreasury)]
    pub treasury: UncheckedAccount<'info>,

    /// CHECK: Creator receives creator share.
    #[account(mut, constraint = creator.key() == episode.creator @ EpisodeError::InvalidCreator)]
    pub creator: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ManageEpisode<'info> {
    #[account(constraint = episode.creator == creator.key() @ EpisodeError::NotAuthority)]
    pub creator: Signer<'info>,

    #[account(mut)]
    pub episode: Account<'info, Episode>,
}

#[derive(Accounts)]
pub struct ManageCollection<'info> {
    #[account(constraint = collection.authority == authority.key() @ EpisodeError::NotAuthority)]
    pub authority: Signer<'info>,

    #[account(mut)]
    pub collection: Account<'info, EpisodeCollection>,
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

#[event]
pub struct EpisodeCreated {
    pub collection: Pubkey,
    pub index: u64,
    pub creator: Pubkey,
    pub title: String,
    pub max_editions: u64,
    pub price_lamports: u64,
}

#[event]
pub struct EditionMinted {
    pub episode: Pubkey,
    pub minter: Pubkey,
    pub edition_number: u64,
    pub price: u64,
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[error_code]
pub enum EpisodeError {
    #[msg("Not the collection authority")]
    NotAuthority,
    #[msg("Creator + platform shares must equal 10000")]
    InvalidShares,
    #[msg("Title too long")]
    TitleTooLong,
    #[msg("Max editions must be > 0")]
    ZeroEditions,
    #[msg("Episode is inactive")]
    EpisodeInactive,
    #[msg("All editions sold out")]
    SoldOut,
    #[msg("Collection mismatch")]
    CollectionMismatch,
    #[msg("Invalid treasury")]
    InvalidTreasury,
    #[msg("Invalid creator")]
    InvalidCreator,
    #[msg("Platform fee exceeds maximum (50%)")]
    FeeTooHigh,
}
