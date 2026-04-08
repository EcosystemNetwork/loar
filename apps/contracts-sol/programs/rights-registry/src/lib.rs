use anchor_lang::prelude::*;

declare_id!("RghtRgxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");

/// Rights Registry — Singleton registry tracking content rights classification.
/// Equivalent to RightsRegistry.sol on EVM.
///
/// Rights levels:
/// - Fun: fan-created, no commercial rights
/// - Original: creator-owned original IP
/// - Licensed: third-party licensed content
/// - PublicDomain: free for all
///
/// Monetizable: Original, Licensed (not Fun, not PublicDomain)
/// Once frozen, rights can never be changed.
/// Operators (authorized by authority) can set/freeze rights.
#[program]
pub mod rights_registry {
    use super::*;

    /// Initialize the registry.
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.authority = ctx.accounts.authority.key();
        config.total_registered = 0;
        config.bump = ctx.bumps.config;
        Ok(())
    }

    /// Register content rights. Only authority or authorized operator.
    pub fn register_rights(
        ctx: Context<RegisterRights>,
        content_id: [u8; 32],
        rights_type: RightsType,
        creator: Pubkey,
    ) -> Result<()> {
        // Verify caller is authority or authorized operator
        require!(
            is_authorized(&ctx.accounts.config, &ctx.accounts.operator, &ctx.accounts.operator_record),
            RightsError::Unauthorized
        );

        let record = &mut ctx.accounts.rights_record;
        require!(record.content_id == [0u8; 32], RightsError::AlreadyRegistered);

        record.content_id = content_id;
        record.rights_type = rights_type;
        record.creator = creator;
        record.is_frozen = false;
        record.registered_at = Clock::get()?.unix_timestamp;
        record.updated_at = record.registered_at;
        record.bump = ctx.bumps.rights_record;

        let config = &mut ctx.accounts.config;
        config.total_registered += 1;

        emit!(RightsRegistered {
            content_id,
            rights_type,
            creator,
        });

        Ok(())
    }

    /// Update content rights (operator or authority only). Cannot update frozen content.
    pub fn update_rights(
        ctx: Context<UpdateRights>,
        new_rights_type: RightsType,
    ) -> Result<()> {
        // Verify caller is authority or authorized operator
        require!(
            is_authorized(&ctx.accounts.config, &ctx.accounts.operator, &ctx.accounts.operator_record),
            RightsError::Unauthorized
        );

        let record = &mut ctx.accounts.rights_record;
        require!(!record.is_frozen, RightsError::ContentFrozen);

        let old = record.rights_type;
        record.rights_type = new_rights_type;
        record.updated_at = Clock::get()?.unix_timestamp;

        emit!(RightsUpdated {
            content_id: record.content_id,
            old_rights: old,
            new_rights: new_rights_type,
        });

        Ok(())
    }

    /// Freeze content rights permanently. Cannot be undone.
    pub fn freeze_rights(ctx: Context<UpdateRights>) -> Result<()> {
        // Verify caller is authority or authorized operator
        require!(
            is_authorized(&ctx.accounts.config, &ctx.accounts.operator, &ctx.accounts.operator_record),
            RightsError::Unauthorized
        );

        let record = &mut ctx.accounts.rights_record;
        require!(!record.is_frozen, RightsError::ContentFrozen);

        record.is_frozen = true;
        record.updated_at = Clock::get()?.unix_timestamp;

        emit!(RightsFrozen {
            content_id: record.content_id,
            rights_type: record.rights_type,
        });

        Ok(())
    }

    /// Add an operator who can set/freeze rights.
    pub fn add_operator(ctx: Context<ManageOperator>, operator: Pubkey) -> Result<()> {
        let op = &mut ctx.accounts.operator_record;
        op.operator = operator;
        op.authorized = true;
        op.bump = ctx.bumps.operator_record;

        emit!(OperatorUpdated {
            operator,
            authorized: true,
        });
        Ok(())
    }

    /// Remove an operator.
    pub fn remove_operator(ctx: Context<RemoveOperator>) -> Result<()> {
        let op = &mut ctx.accounts.operator_record;
        let operator = op.operator;
        op.authorized = false;

        emit!(OperatorUpdated {
            operator,
            authorized: false,
        });
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Check if the signer is the authority or an authorized operator.
fn is_authorized(
    config: &Account<RegistryConfig>,
    signer: &Signer,
    operator_record: &Option<Account<OperatorRecord>>,
) -> bool {
    // Authority is always authorized
    if signer.key() == config.authority {
        return true;
    }
    // Check operator record
    if let Some(op) = operator_record {
        return op.operator == signer.key() && op.authorized;
    }
    false
}

/// Check if a rights type is monetizable (Original or Licensed).
/// Matches EVM RightsRegistry.isMonetizable().
pub fn is_monetizable(rights_type: &RightsType) -> bool {
    matches!(rights_type, RightsType::Original | RightsType::Licensed)
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum RightsType {
    Fun,
    Original,
    Licensed,
    PublicDomain,
}

#[account]
#[derive(InitSpace)]
pub struct RegistryConfig {
    pub authority: Pubkey,
    pub total_registered: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct RightsRecord {
    pub content_id: [u8; 32],
    pub rights_type: RightsType,
    pub creator: Pubkey,
    pub is_frozen: bool,
    pub registered_at: i64,
    pub updated_at: i64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct OperatorRecord {
    pub operator: Pubkey,
    pub authorized: bool,
    pub bump: u8,
}

// ---------------------------------------------------------------------------
// Contexts
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + RegistryConfig::INIT_SPACE,
        seeds = [b"rights_config"],
        bump,
    )]
    pub config: Account<'info, RegistryConfig>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(content_id: [u8; 32])]
pub struct RegisterRights<'info> {
    #[account(mut)]
    pub operator: Signer<'info>,

    #[account(
        mut,
        seeds = [b"rights_config"],
        bump = config.bump,
    )]
    pub config: Account<'info, RegistryConfig>,

    /// Optional operator record — pass if signer is not the authority.
    /// If the signer IS the authority, this can be None.
    pub operator_record: Option<Account<'info, OperatorRecord>>,

    #[account(
        init,
        payer = operator,
        space = 8 + RightsRecord::INIT_SPACE,
        seeds = [b"rights", content_id.as_ref()],
        bump,
    )]
    pub rights_record: Account<'info, RightsRecord>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateRights<'info> {
    pub operator: Signer<'info>,

    #[account(
        seeds = [b"rights_config"],
        bump = config.bump,
    )]
    pub config: Account<'info, RegistryConfig>,

    /// Optional operator record — pass if signer is not the authority.
    pub operator_record: Option<Account<'info, OperatorRecord>>,

    #[account(mut)]
    pub rights_record: Account<'info, RightsRecord>,
}

#[derive(Accounts)]
#[instruction(operator: Pubkey)]
pub struct ManageOperator<'info> {
    #[account(mut, constraint = config.authority == authority.key() @ RightsError::Unauthorized)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [b"rights_config"],
        bump = config.bump,
    )]
    pub config: Account<'info, RegistryConfig>,

    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + OperatorRecord::INIT_SPACE,
        seeds = [b"operator", operator.as_ref()],
        bump,
    )]
    pub operator_record: Account<'info, OperatorRecord>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RemoveOperator<'info> {
    #[account(constraint = config.authority == authority.key() @ RightsError::Unauthorized)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [b"rights_config"],
        bump = config.bump,
    )]
    pub config: Account<'info, RegistryConfig>,

    #[account(
        mut,
        seeds = [b"operator", operator_record.operator.as_ref()],
        bump = operator_record.bump,
    )]
    pub operator_record: Account<'info, OperatorRecord>,
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

#[event]
pub struct RightsRegistered {
    pub content_id: [u8; 32],
    pub rights_type: RightsType,
    pub creator: Pubkey,
}

#[event]
pub struct RightsUpdated {
    pub content_id: [u8; 32],
    pub old_rights: RightsType,
    pub new_rights: RightsType,
}

#[event]
pub struct RightsFrozen {
    pub content_id: [u8; 32],
    pub rights_type: RightsType,
}

#[event]
pub struct OperatorUpdated {
    pub operator: Pubkey,
    pub authorized: bool,
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[error_code]
pub enum RightsError {
    #[msg("Not authorized — must be authority or authorized operator")]
    Unauthorized,
    #[msg("Content already registered")]
    AlreadyRegistered,
    #[msg("Content rights are frozen and cannot be changed")]
    ContentFrozen,
}
