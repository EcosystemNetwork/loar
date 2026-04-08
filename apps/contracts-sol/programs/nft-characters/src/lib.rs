use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("NftChxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");

/// Character NFTs — 1/1 character NFTs per universe with appearance tracking
/// and royalty accumulation. Equivalent to CharacterNFT.sol on EVM.
///
/// Each character NFT tracks:
/// - Appearances in episodes (earns royalties per appearance)
/// - Accumulated royalties claimable by the NFT owner
/// - Metadata URI for character art/profile
///
/// Royalties are escrowed in a vault PDA. When an appearance is recorded,
/// the caller deposits the royalty into the vault. The character owner can
/// then claim accumulated royalties from the vault.
#[program]
pub mod nft_characters {
    use super::*;

    /// Initialize character collection for a universe.
    pub fn initialize_collection(
        ctx: Context<InitializeCollection>,
        universe_id: u64,
        appearance_royalty_lamports: u64,
    ) -> Result<()> {
        let collection = &mut ctx.accounts.collection;
        collection.universe_id = universe_id;
        collection.authority = ctx.accounts.authority.key();
        collection.treasury = ctx.accounts.treasury.key();
        collection.character_count = 0;
        collection.appearance_royalty_lamports = appearance_royalty_lamports;
        collection.total_appearances = 0;
        collection.total_royalties_paid = 0;
        collection.bump = ctx.bumps.collection;
        collection.vault_bump = ctx.bumps.vault;
        Ok(())
    }

    /// Mint a new character NFT.
    pub fn mint_character(
        ctx: Context<MintCharacter>,
        name: String,
        metadata_uri: String,
        content_hash: [u8; 32],
        price_lamports: u64,
    ) -> Result<()> {
        require!(name.len() <= 64, CharacterError::NameTooLong);

        let collection = &mut ctx.accounts.collection;
        let character = &mut ctx.accounts.character;

        // Pay mint price to treasury if set
        if price_lamports > 0 {
            system_program::transfer(
                CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    system_program::Transfer {
                        from: ctx.accounts.minter.to_account_info(),
                        to: ctx.accounts.treasury.to_account_info(),
                    },
                ),
                price_lamports,
            )?;
        }

        character.collection = collection.key();
        character.index = collection.character_count;
        character.owner = ctx.accounts.minter.key();
        character.creator = ctx.accounts.minter.key();
        character.name = name.clone();
        character.metadata_uri = metadata_uri;
        character.content_hash = content_hash;
        character.appearances = 0;
        character.accrued_royalties = 0;
        character.claimed_royalties = 0;
        character.created_at = Clock::get()?.unix_timestamp;
        character.bump = ctx.bumps.character;

        collection.character_count += 1;

        emit!(CharacterMinted {
            collection: collection.key(),
            index: character.index,
            owner: character.owner,
            name,
        });

        Ok(())
    }

    /// Record an appearance of a character in an episode.
    /// The caller (collection authority) deposits the royalty into the vault PDA.
    pub fn record_appearance(
        ctx: Context<RecordAppearance>,
        episode_index: u64,
    ) -> Result<()> {
        let collection = &ctx.accounts.collection;
        let royalty = collection.appearance_royalty_lamports;

        // Transfer royalty from authority to vault PDA
        if royalty > 0 {
            system_program::transfer(
                CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    system_program::Transfer {
                        from: ctx.accounts.authority.to_account_info(),
                        to: ctx.accounts.vault.to_account_info(),
                    },
                ),
                royalty,
            )?;
        }

        let character = &mut ctx.accounts.character;
        character.appearances += 1;
        character.accrued_royalties += royalty;

        let collection = &mut ctx.accounts.collection;
        collection.total_appearances += 1;

        emit!(AppearanceRecorded {
            character: ctx.accounts.character.key(),
            episode_index,
            total_appearances: character.appearances,
            royalty_earned: royalty,
        });

        Ok(())
    }

    /// Claim accrued royalties from the vault PDA (character owner only).
    pub fn claim_royalties(ctx: Context<ClaimRoyalties>) -> Result<()> {
        let character = &mut ctx.accounts.character;
        require!(
            character.accrued_royalties >= character.claimed_royalties,
            CharacterError::NothingToClaim
        );
        let claimable = character.accrued_royalties - character.claimed_royalties;
        require!(claimable > 0, CharacterError::NothingToClaim);

        let collection = &ctx.accounts.collection;
        let universe_id = collection.universe_id;

        // Transfer from vault PDA to owner
        let vault_seeds = &[
            b"char_vault",
            universe_id.to_le_bytes().as_ref(),
            &[collection.vault_bump],
        ];
        let signer_seeds = &[&vault_seeds[..]];

        system_program::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.owner.to_account_info(),
                },
                signer_seeds,
            ),
            claimable,
        )?;

        character.claimed_royalties = character.accrued_royalties;

        let collection = &mut ctx.accounts.collection;
        collection.total_royalties_paid += claimable;

        emit!(RoyaltiesClaimed {
            character: ctx.accounts.character.key(),
            owner: ctx.accounts.owner.key(),
            amount: claimable,
        });

        Ok(())
    }

    /// Transfer character ownership.
    pub fn transfer_character(ctx: Context<TransferCharacter>, new_owner: Pubkey) -> Result<()> {
        let character = &mut ctx.accounts.character;
        let old_owner = character.owner;
        character.owner = new_owner;

        emit!(CharacterTransferred {
            character: ctx.accounts.character.key(),
            from: old_owner,
            to: new_owner,
        });

        Ok(())
    }
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

#[account]
#[derive(InitSpace)]
pub struct CharacterCollection {
    pub universe_id: u64,
    pub authority: Pubkey,
    pub treasury: Pubkey,
    pub character_count: u64,
    pub appearance_royalty_lamports: u64,
    pub total_appearances: u64,
    pub total_royalties_paid: u64,
    pub bump: u8,
    pub vault_bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Character {
    pub collection: Pubkey,
    pub index: u64,
    pub owner: Pubkey,
    pub creator: Pubkey,
    #[max_len(64)]
    pub name: String,
    #[max_len(256)]
    pub metadata_uri: String,
    pub content_hash: [u8; 32],
    pub appearances: u64,
    pub accrued_royalties: u64,
    pub claimed_royalties: u64,
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
        space = 8 + CharacterCollection::INIT_SPACE,
        seeds = [b"char_collection", universe_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub collection: Account<'info, CharacterCollection>,

    /// CHECK: Vault PDA for royalty escrow — system-owned, holds SOL.
    #[account(
        mut,
        seeds = [b"char_vault", universe_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub vault: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct MintCharacter<'info> {
    #[account(mut)]
    pub minter: Signer<'info>,

    #[account(mut)]
    pub collection: Account<'info, CharacterCollection>,

    /// CHECK: Treasury receives mint fee.
    #[account(mut, constraint = treasury.key() == collection.treasury @ CharacterError::InvalidTreasury)]
    pub treasury: UncheckedAccount<'info>,

    #[account(
        init,
        payer = minter,
        space = 8 + Character::INIT_SPACE,
        seeds = [b"character", collection.key().as_ref(), collection.character_count.to_le_bytes().as_ref()],
        bump,
    )]
    pub character: Account<'info, Character>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RecordAppearance<'info> {
    /// Must be collection authority.
    #[account(mut, constraint = collection.authority == authority.key() @ CharacterError::Unauthorized)]
    pub authority: Signer<'info>,

    #[account(mut)]
    pub collection: Account<'info, CharacterCollection>,

    #[account(
        mut,
        constraint = character.collection == collection.key() @ CharacterError::CollectionMismatch,
    )]
    pub character: Account<'info, Character>,

    /// CHECK: Vault PDA receives royalty deposits.
    #[account(
        mut,
        seeds = [b"char_vault", collection.universe_id.to_le_bytes().as_ref()],
        bump = collection.vault_bump,
    )]
    pub vault: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClaimRoyalties<'info> {
    #[account(mut, constraint = character.owner == owner.key() @ CharacterError::NotOwner)]
    pub owner: Signer<'info>,

    #[account(mut)]
    pub collection: Account<'info, CharacterCollection>,

    #[account(
        mut,
        constraint = character.collection == collection.key() @ CharacterError::CollectionMismatch,
    )]
    pub character: Account<'info, Character>,

    /// CHECK: Vault PDA holds escrowed royalties.
    #[account(
        mut,
        seeds = [b"char_vault", collection.universe_id.to_le_bytes().as_ref()],
        bump = collection.vault_bump,
    )]
    pub vault: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct TransferCharacter<'info> {
    #[account(constraint = character.owner == owner.key() @ CharacterError::NotOwner)]
    pub owner: Signer<'info>,

    #[account(mut)]
    pub character: Account<'info, Character>,
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

#[event]
pub struct CharacterMinted {
    pub collection: Pubkey,
    pub index: u64,
    pub owner: Pubkey,
    pub name: String,
}

#[event]
pub struct AppearanceRecorded {
    pub character: Pubkey,
    pub episode_index: u64,
    pub total_appearances: u64,
    pub royalty_earned: u64,
}

#[event]
pub struct RoyaltiesClaimed {
    pub character: Pubkey,
    pub owner: Pubkey,
    pub amount: u64,
}

#[event]
pub struct CharacterTransferred {
    pub character: Pubkey,
    pub from: Pubkey,
    pub to: Pubkey,
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[error_code]
pub enum CharacterError {
    #[msg("Not authorized")]
    Unauthorized,
    #[msg("Not the character owner")]
    NotOwner,
    #[msg("Name too long")]
    NameTooLong,
    #[msg("Collection mismatch")]
    CollectionMismatch,
    #[msg("Invalid treasury")]
    InvalidTreasury,
    #[msg("Nothing to claim")]
    NothingToClaim,
}
