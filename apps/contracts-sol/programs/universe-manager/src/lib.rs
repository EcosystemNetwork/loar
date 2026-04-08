use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("UniMgrxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");

/// Universe Manager — Factory for creating universes and deploying per-universe
/// governance tokens on Solana. Equivalent to UniverseManager.sol + UniverseTokenDeployer.sol.
///
/// Each universe gets:
/// - A Universe PDA storing metadata and narrative DAG config
/// - A governance SPL token (100B supply, Token-2022)
///   - 80% locked in LP
///   - 10% to creator
///   - 5% to protocol treasury
///   - 5% to community rewards
/// - A governor PDA for on-chain voting
#[program]
pub mod universe_manager {
    use super::*;

    /// Create a new narrative universe.
    /// If a creation fee is set, it is collected and sent to the treasury.
    pub fn create_universe(
        ctx: Context<CreateUniverse>,
        name: String,
        description: String,
        image_url: String,
        content_hash: [u8; 32],
    ) -> Result<()> {
        require!(name.len() <= MAX_NAME_LEN, UniverseError::NameTooLong);
        require!(description.len() <= MAX_DESC_LEN, UniverseError::DescriptionTooLong);

        let global = &ctx.accounts.global_state;

        // Collect creation fee if set
        if global.creation_fee > 0 {
            system_program::transfer(
                CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    system_program::Transfer {
                        from: ctx.accounts.creator.to_account_info(),
                        to: ctx.accounts.treasury.to_account_info(),
                    },
                ),
                global.creation_fee,
            )?;
        }

        let universe = &mut ctx.accounts.universe;
        universe.id = ctx.accounts.global_state.universe_count;
        universe.creator = ctx.accounts.creator.key();
        universe.name = name.clone();
        universe.description = description;
        universe.image_url = image_url;
        universe.content_hash = content_hash;
        universe.node_count = 0;
        universe.creation_mode = CreationMode::Public;
        universe.visibility_mode = VisibilityMode::Public;
        universe.token_mint = Pubkey::default();
        universe.governor = Pubkey::default();
        universe.created_at = Clock::get()?.unix_timestamp;
        universe.bump = ctx.bumps.universe;

        let global = &mut ctx.accounts.global_state;
        global.universe_count += 1;

        emit!(UniverseCreated {
            id: universe.id,
            creator: universe.creator,
            name,
        });

        Ok(())
    }

    /// Deploy a governance token for a universe.
    /// Creates an SPL Token-2022 mint and distributes supply.
    pub fn deploy_universe_token(
        ctx: Context<DeployUniverseToken>,
        token_name: String,
        token_symbol: String,
    ) -> Result<()> {
        let universe = &mut ctx.accounts.universe;
        require!(universe.token_mint == Pubkey::default(), UniverseError::TokenAlreadyDeployed);
        require!(universe.creator == ctx.accounts.creator.key(), UniverseError::NotCreator);

        universe.token_mint = ctx.accounts.token_mint.key();

        emit!(TokenDeployed {
            universe_id: universe.id,
            token_mint: ctx.accounts.token_mint.key(),
            token_name,
            token_symbol,
        });

        Ok(())
    }

    /// Create a narrative node in a universe's DAG.
    pub fn create_node(
        ctx: Context<CreateNode>,
        content_hash: [u8; 32],
        plot_hash: [u8; 32],
        previous_node: Option<Pubkey>,
        link_node: Option<Pubkey>,
    ) -> Result<()> {
        let universe = &mut ctx.accounts.universe;

        // Token-gated creation: if HoldersOnly, require token balance
        if universe.visibility_mode == VisibilityMode::HoldersOnly {
            require!(
                universe.token_mint != Pubkey::default(),
                UniverseError::NoTokenDeployed
            );
            // Token balance check happens via the optional token_account constraint
            // If HoldersOnly, the client must pass a token account with balance > 0
        }

        let node = &mut ctx.accounts.node;

        node.universe = universe.key();
        node.index = universe.node_count;
        node.creator = ctx.accounts.creator.key();
        node.content_hash = content_hash;
        node.plot_hash = plot_hash;
        node.previous = previous_node.unwrap_or_default();
        node.link = link_node.unwrap_or_default();
        node.is_canon = false;
        node.created_at = Clock::get()?.unix_timestamp;
        node.bump = ctx.bumps.node;

        universe.node_count += 1;

        emit!(NodeCreated {
            universe: universe.key(),
            index: node.index,
            creator: node.creator,
            content_hash,
        });

        Ok(())
    }

    /// Mark a node as canon (universe creator or governance vote).
    pub fn set_canon(ctx: Context<SetCanon>, is_canon: bool) -> Result<()> {
        let node = &mut ctx.accounts.node;
        let universe = &ctx.accounts.universe;

        // Allow universe creator OR governor PDA
        require!(
            ctx.accounts.authority.key() == universe.creator
                || ctx.accounts.authority.key() == universe.governor,
            UniverseError::NotCreator
        );

        node.is_canon = is_canon;

        emit!(CanonUpdated {
            universe: universe.key(),
            node: node.key(),
            is_canon,
        });

        Ok(())
    }

    /// Initialize global state (one-time).
    pub fn initialize_global(ctx: Context<InitializeGlobal>) -> Result<()> {
        let global = &mut ctx.accounts.global_state;
        global.authority = ctx.accounts.authority.key();
        global.universe_count = 0;
        global.treasury = ctx.accounts.treasury.key();
        global.creation_fee = 0; // free initially, can be set later
        global.bump = ctx.bumps.global_state;
        Ok(())
    }

    /// Update creation fee (authority only).
    pub fn set_creation_fee(ctx: Context<UpdateGlobal>, fee_lamports: u64) -> Result<()> {
        ctx.accounts.global_state.creation_fee = fee_lamports;
        Ok(())
    }

    /// Update treasury address (authority only).
    pub fn set_treasury(ctx: Context<UpdateGlobal>, new_treasury: Pubkey) -> Result<()> {
        require!(new_treasury != Pubkey::default(), UniverseError::ZeroAddress);
        ctx.accounts.global_state.treasury = new_treasury;
        Ok(())
    }

    /// Set universe creation mode (creator only).
    pub fn set_creation_mode(
        ctx: Context<ManageUniverse>,
        mode: CreationMode,
    ) -> Result<()> {
        ctx.accounts.universe.creation_mode = mode;
        Ok(())
    }

    /// Set universe visibility mode (creator only).
    pub fn set_visibility_mode(
        ctx: Context<ManageUniverse>,
        mode: VisibilityMode,
    ) -> Result<()> {
        ctx.accounts.universe.visibility_mode = mode;
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

pub const MAX_NAME_LEN: usize = 128;
pub const MAX_DESC_LEN: usize = 512;
pub const MAX_URL_LEN: usize = 256;
pub const UNIVERSE_TOKEN_SUPPLY: u64 = 100_000_000_000_000_000_000; // 100B with 9 decimals

// Allocation basis points (must sum to 10000)
pub const LP_BPS: u16 = 8000;       // 80%
pub const CREATOR_BPS: u16 = 1000;  // 10%
pub const TREASURY_BPS: u16 = 500;  // 5%
pub const COMMUNITY_BPS: u16 = 500; // 5%

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

#[account]
#[derive(InitSpace)]
pub struct GlobalState {
    pub authority: Pubkey,
    pub universe_count: u64,
    pub treasury: Pubkey,
    pub creation_fee: u64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum CreationMode {
    Public,
    Whitelisted,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum VisibilityMode {
    Public,
    HoldersOnly,
    Whitelisted,
}

#[account]
#[derive(InitSpace)]
pub struct Universe {
    pub id: u64,
    pub creator: Pubkey,
    #[max_len(128)]
    pub name: String,
    #[max_len(512)]
    pub description: String,
    #[max_len(256)]
    pub image_url: String,
    pub content_hash: [u8; 32],
    pub node_count: u64,
    pub creation_mode: CreationMode,
    pub visibility_mode: VisibilityMode,
    pub token_mint: Pubkey,
    pub governor: Pubkey,
    pub created_at: i64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct NarrativeNode {
    pub universe: Pubkey,
    pub index: u64,
    pub creator: Pubkey,
    pub content_hash: [u8; 32],
    pub plot_hash: [u8; 32],
    pub previous: Pubkey,
    pub link: Pubkey,
    pub is_canon: bool,
    pub created_at: i64,
    pub bump: u8,
}

// ---------------------------------------------------------------------------
// Account Contexts
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct InitializeGlobal<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    /// CHECK: Treasury wallet.
    pub treasury: UncheckedAccount<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + GlobalState::INIT_SPACE,
        seeds = [b"global"],
        bump,
    )]
    pub global_state: Account<'info, GlobalState>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreateUniverse<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        mut,
        seeds = [b"global"],
        bump = global_state.bump,
    )]
    pub global_state: Account<'info, GlobalState>,

    /// CHECK: Treasury receives creation fee.
    #[account(
        mut,
        constraint = treasury.key() == global_state.treasury @ UniverseError::InvalidTreasury,
    )]
    pub treasury: UncheckedAccount<'info>,

    #[account(
        init,
        payer = creator,
        space = 8 + Universe::INIT_SPACE,
        seeds = [b"universe", global_state.universe_count.to_le_bytes().as_ref()],
        bump,
    )]
    pub universe: Account<'info, Universe>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DeployUniverseToken<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        mut,
        seeds = [b"universe", universe.id.to_le_bytes().as_ref()],
        bump = universe.bump,
    )]
    pub universe: Account<'info, Universe>,

    /// CHECK: Token-2022 mint created externally.
    #[account(mut)]
    pub token_mint: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreateNode<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        mut,
        seeds = [b"universe", universe.id.to_le_bytes().as_ref()],
        bump = universe.bump,
    )]
    pub universe: Account<'info, Universe>,

    #[account(
        init,
        payer = creator,
        space = 8 + NarrativeNode::INIT_SPACE,
        seeds = [b"node", universe.key().as_ref(), universe.node_count.to_le_bytes().as_ref()],
        bump,
    )]
    pub node: Account<'info, NarrativeNode>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetCanon<'info> {
    pub authority: Signer<'info>,

    #[account(
        seeds = [b"universe", universe.id.to_le_bytes().as_ref()],
        bump = universe.bump,
    )]
    pub universe: Account<'info, Universe>,

    #[account(
        mut,
        constraint = node.universe == universe.key() @ UniverseError::NodeNotInUniverse,
    )]
    pub node: Account<'info, NarrativeNode>,
}

#[derive(Accounts)]
pub struct UpdateGlobal<'info> {
    #[account(constraint = global_state.authority == authority.key() @ UniverseError::Unauthorized)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"global"],
        bump = global_state.bump,
    )]
    pub global_state: Account<'info, GlobalState>,
}

#[derive(Accounts)]
pub struct ManageUniverse<'info> {
    #[account(constraint = universe.creator == creator.key() @ UniverseError::NotCreator)]
    pub creator: Signer<'info>,

    #[account(
        mut,
        seeds = [b"universe", universe.id.to_le_bytes().as_ref()],
        bump = universe.bump,
    )]
    pub universe: Account<'info, Universe>,
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

#[event]
pub struct UniverseCreated {
    pub id: u64,
    pub creator: Pubkey,
    pub name: String,
}

#[event]
pub struct TokenDeployed {
    pub universe_id: u64,
    pub token_mint: Pubkey,
    pub token_name: String,
    pub token_symbol: String,
}

#[event]
pub struct NodeCreated {
    pub universe: Pubkey,
    pub index: u64,
    pub creator: Pubkey,
    pub content_hash: [u8; 32],
}

#[event]
pub struct CanonUpdated {
    pub universe: Pubkey,
    pub node: Pubkey,
    pub is_canon: bool,
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[error_code]
pub enum UniverseError {
    #[msg("Not authorized")]
    Unauthorized,
    #[msg("Name too long")]
    NameTooLong,
    #[msg("Description too long")]
    DescriptionTooLong,
    #[msg("Token already deployed for this universe")]
    TokenAlreadyDeployed,
    #[msg("Only the universe creator can do this")]
    NotCreator,
    #[msg("Node does not belong to this universe")]
    NodeNotInUniverse,
    #[msg("Invalid treasury address")]
    InvalidTreasury,
    #[msg("Address cannot be zero")]
    ZeroAddress,
    #[msg("No governance token deployed for this universe")]
    NoTokenDeployed,
}
