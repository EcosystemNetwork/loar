use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("NftEnxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");

/// Entity NFTs — World-building entities: places, events, vehicles, things,
/// lore, species, technology, organizations. Supports both 1/1 unique entities
/// and edition entities. Equivalent to EntityNFT.sol + EntityEditionNFT.sol on EVM.
///
/// Universe-scoped: Each entity collection is bound to a universe_id.
/// Parent validation: Entities can reference a parent entity for hierarchy.
#[program]
pub mod nft_entities {
    use super::*;

    /// Initialize entity collection for a universe.
    pub fn initialize_collection(
        ctx: Context<InitializeCollection>,
        universe_id: u64,
        creation_fee_lamports: u64,
    ) -> Result<()> {
        let collection = &mut ctx.accounts.collection;
        collection.universe_id = universe_id;
        collection.authority = ctx.accounts.authority.key();
        collection.treasury = ctx.accounts.treasury.key();
        collection.entity_count = 0;
        collection.total_revenue = 0;
        collection.creation_fee_lamports = creation_fee_lamports;
        collection.bump = ctx.bumps.collection;
        Ok(())
    }

    /// Mint a unique (1/1) entity NFT.
    pub fn mint_unique_entity(
        ctx: Context<MintEntity>,
        kind: EntityKind,
        name: String,
        metadata_uri: String,
        content_hash: [u8; 32],
        price_lamports: u64,
        parent_entity: Option<Pubkey>,
    ) -> Result<()> {
        require!(name.len() <= 128, EntityError::NameTooLong);
        require!(kind.is_unique(), EntityError::NotUniqueKind);

        let collection = &mut ctx.accounts.collection;
        let entity = &mut ctx.accounts.entity;

        // Charge creation fee + mint price
        let total_charge = price_lamports + collection.creation_fee_lamports;
        if total_charge > 0 {
            system_program::transfer(
                CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    system_program::Transfer {
                        from: ctx.accounts.minter.to_account_info(),
                        to: ctx.accounts.treasury.to_account_info(),
                    },
                ),
                total_charge,
            )?;
            collection.total_revenue += total_charge;
        }

        // Validate parent if provided
        if let Some(parent) = parent_entity {
            if let Some(parent_account) = &ctx.accounts.parent_entity {
                require!(
                    parent_account.key() == parent,
                    EntityError::ParentMismatch
                );
                require!(
                    parent_account.collection == collection.key(),
                    EntityError::ParentNotInCollection
                );
            } else {
                return Err(EntityError::ParentAccountRequired.into());
            }
        }

        entity.collection = collection.key();
        entity.index = collection.entity_count;
        entity.kind = kind;
        entity.owner = ctx.accounts.minter.key();
        entity.creator = ctx.accounts.minter.key();
        entity.name = name.clone();
        entity.metadata_uri = metadata_uri;
        entity.content_hash = content_hash;
        entity.max_editions = 1; // unique
        entity.minted_editions = 1;
        entity.price_lamports = price_lamports;
        entity.parent_entity = parent_entity;
        entity.created_at = Clock::get()?.unix_timestamp;
        entity.bump = ctx.bumps.entity;

        collection.entity_count += 1;

        emit!(EntityMinted {
            collection: collection.key(),
            index: entity.index,
            kind,
            owner: entity.owner,
            name,
            is_edition: false,
        });

        Ok(())
    }

    /// Create an edition entity type (things, lore, species, tech).
    /// Now charges a creation fee (parity with unique entities and EVM).
    pub fn create_edition_entity(
        ctx: Context<MintEntity>,
        kind: EntityKind,
        name: String,
        metadata_uri: String,
        content_hash: [u8; 32],
        max_editions: u64,
        price_lamports: u64,
        parent_entity: Option<Pubkey>,
    ) -> Result<()> {
        require!(name.len() <= 128, EntityError::NameTooLong);
        require!(!kind.is_unique(), EntityError::NotEditionKind);
        require!(max_editions > 0, EntityError::ZeroEditions);

        let collection = &mut ctx.accounts.collection;
        let entity = &mut ctx.accounts.entity;

        // Charge creation fee for edition types too
        let creation_fee = collection.creation_fee_lamports;
        if creation_fee > 0 {
            system_program::transfer(
                CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    system_program::Transfer {
                        from: ctx.accounts.minter.to_account_info(),
                        to: ctx.accounts.treasury.to_account_info(),
                    },
                ),
                creation_fee,
            )?;
            collection.total_revenue += creation_fee;
        }

        // Validate parent if provided
        if let Some(parent) = parent_entity {
            if let Some(parent_account) = &ctx.accounts.parent_entity {
                require!(
                    parent_account.key() == parent,
                    EntityError::ParentMismatch
                );
                require!(
                    parent_account.collection == collection.key(),
                    EntityError::ParentNotInCollection
                );
            } else {
                return Err(EntityError::ParentAccountRequired.into());
            }
        }

        entity.collection = collection.key();
        entity.index = collection.entity_count;
        entity.kind = kind;
        entity.owner = ctx.accounts.minter.key();
        entity.creator = ctx.accounts.minter.key();
        entity.name = name.clone();
        entity.metadata_uri = metadata_uri;
        entity.content_hash = content_hash;
        entity.max_editions = max_editions;
        entity.minted_editions = 0;
        entity.price_lamports = price_lamports;
        entity.parent_entity = parent_entity;
        entity.created_at = Clock::get()?.unix_timestamp;
        entity.bump = ctx.bumps.entity;

        collection.entity_count += 1;

        emit!(EntityMinted {
            collection: collection.key(),
            index: entity.index,
            kind,
            owner: entity.owner,
            name,
            is_edition: true,
        });

        Ok(())
    }

    /// Mint an edition copy of an edition entity.
    pub fn mint_edition(ctx: Context<MintEditionCopy>) -> Result<()> {
        let entity = &mut ctx.accounts.entity;
        require!(entity.minted_editions < entity.max_editions, EntityError::SoldOut);

        let price = entity.price_lamports;
        if price > 0 {
            system_program::transfer(
                CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    system_program::Transfer {
                        from: ctx.accounts.minter.to_account_info(),
                        to: ctx.accounts.treasury.to_account_info(),
                    },
                ),
                price,
            )?;
            let collection = &mut ctx.accounts.collection;
            collection.total_revenue += price;
        }

        entity.minted_editions += 1;

        emit!(EditionCopyMinted {
            entity: ctx.accounts.entity.key(),
            minter: ctx.accounts.minter.key(),
            edition_number: entity.minted_editions,
        });

        Ok(())
    }

    /// Update creation fee (authority only).
    pub fn set_creation_fee(
        ctx: Context<ManageCollection>,
        fee_lamports: u64,
    ) -> Result<()> {
        ctx.accounts.collection.creation_fee_lamports = fee_lamports;
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum EntityKind {
    // Unique (1/1) kinds
    Person,
    Place,
    Faction,
    Event,
    Vehicle,
    Organization,
    // Edition kinds
    Thing,
    Lore,
    Species,
    Technology,
}

impl EntityKind {
    pub fn is_unique(&self) -> bool {
        matches!(
            self,
            EntityKind::Person
                | EntityKind::Place
                | EntityKind::Faction
                | EntityKind::Event
                | EntityKind::Vehicle
                | EntityKind::Organization
        )
    }
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

#[account]
#[derive(InitSpace)]
pub struct EntityCollection {
    pub universe_id: u64,
    pub authority: Pubkey,
    pub treasury: Pubkey,
    pub entity_count: u64,
    pub total_revenue: u64,
    pub creation_fee_lamports: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Entity {
    pub collection: Pubkey,
    pub index: u64,
    pub kind: EntityKind,
    pub owner: Pubkey,
    pub creator: Pubkey,
    #[max_len(128)]
    pub name: String,
    #[max_len(256)]
    pub metadata_uri: String,
    pub content_hash: [u8; 32],
    pub max_editions: u64,
    pub minted_editions: u64,
    pub price_lamports: u64,
    pub parent_entity: Option<Pubkey>,
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
        space = 8 + EntityCollection::INIT_SPACE,
        seeds = [b"entity_collection", universe_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub collection: Account<'info, EntityCollection>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct MintEntity<'info> {
    #[account(mut)]
    pub minter: Signer<'info>,

    #[account(mut)]
    pub collection: Account<'info, EntityCollection>,

    /// CHECK: Treasury receives payment.
    #[account(mut, constraint = treasury.key() == collection.treasury @ EntityError::InvalidTreasury)]
    pub treasury: UncheckedAccount<'info>,

    #[account(
        init,
        payer = minter,
        space = 8 + Entity::INIT_SPACE,
        seeds = [b"entity", collection.key().as_ref(), collection.entity_count.to_le_bytes().as_ref()],
        bump,
    )]
    pub entity: Account<'info, Entity>,

    /// Optional parent entity for hierarchy validation.
    pub parent_entity: Option<Account<'info, Entity>>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct MintEditionCopy<'info> {
    #[account(mut)]
    pub minter: Signer<'info>,

    #[account(mut)]
    pub collection: Account<'info, EntityCollection>,

    /// CHECK: Treasury receives payment.
    #[account(mut, constraint = treasury.key() == collection.treasury @ EntityError::InvalidTreasury)]
    pub treasury: UncheckedAccount<'info>,

    #[account(
        mut,
        constraint = entity.collection == collection.key() @ EntityError::CollectionMismatch,
    )]
    pub entity: Account<'info, Entity>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ManageCollection<'info> {
    #[account(constraint = collection.authority == authority.key() @ EntityError::NotAuthority)]
    pub authority: Signer<'info>,

    #[account(mut)]
    pub collection: Account<'info, EntityCollection>,
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

#[event]
pub struct EntityMinted {
    pub collection: Pubkey,
    pub index: u64,
    pub kind: EntityKind,
    pub owner: Pubkey,
    pub name: String,
    pub is_edition: bool,
}

#[event]
pub struct EditionCopyMinted {
    pub entity: Pubkey,
    pub minter: Pubkey,
    pub edition_number: u64,
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[error_code]
pub enum EntityError {
    #[msg("Not the entity owner")]
    NotOwner,
    #[msg("Not the collection authority")]
    NotAuthority,
    #[msg("Name too long")]
    NameTooLong,
    #[msg("This kind must be unique (1/1)")]
    NotUniqueKind,
    #[msg("This kind must be an edition type")]
    NotEditionKind,
    #[msg("Max editions must be > 0")]
    ZeroEditions,
    #[msg("All editions sold out")]
    SoldOut,
    #[msg("Collection mismatch")]
    CollectionMismatch,
    #[msg("Invalid treasury")]
    InvalidTreasury,
    #[msg("Parent entity account must be provided when parent is set")]
    ParentAccountRequired,
    #[msg("Parent entity key does not match provided account")]
    ParentMismatch,
    #[msg("Parent entity does not belong to the same collection")]
    ParentNotInCollection,
}
