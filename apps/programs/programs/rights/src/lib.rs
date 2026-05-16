//! LOAR Rights — attestation-driven rights cache on Solana.
//!
//! Sister to `apps/contracts/src/RightsRegistry.sol`. EVM stays canonical for
//! rights state (creator signatures, two-step freeze, owner appeals). This
//! program mirrors the result of that canonical state on Solana via signed
//! attestations from the platform's `rights_operator` wallet, so Solana-side
//! monetization programs (canon marketplace, licensing, escrow) can gate
//! `is_monetizable()` checks without a cross-chain RPC.
//!
//! Trust model:
//! - `rights_operator` is the only key allowed to write rights state.
//! - At mainnet handover this key is held by Squads multisig — see
//!   `docs/solana-mainnet-runbook.md` Step 6.
//! - If the operator is compromised, EVM remains canonical; the next
//!   legitimate attestation overwrites cache poisoning. Per-content
//!   `version` numbers reject replays of stale attestations.
//! - `admin` (separate from operator) gates pause + key rotation only.
//!
//! Audit-relevant invariants:
//! - `Config.paused` blocks all rights writes. Reads (via the `Rights` PDA)
//!   remain available so downstream programs don't fail-open if classification
//!   data already exists.
//! - `Rights.version` is strictly monotonic per content_hash — older
//!   attestations are rejected, preventing rollback attacks.
//! - PDA derivation is `[b"rights", content_hash]` — exactly one Rights
//!   account per content_hash, so `init_if_needed` cannot be re-init-abused.
//! - Two-step admin AND two-step operator transfers (mirrors `payment`).
//! - All u64 arithmetic uses `checked_*` (no silent overflow).

use anchor_lang::prelude::*;

declare_id!("NDpYpB49e3yzEcsPK1o34h9Zgrw9CPnVTnZLvDowL4m");

pub const CONFIG_SEED: &[u8] = b"rights_config";
pub const RIGHTS_SEED: &[u8] = b"rights";

#[program]
pub mod rights {
    use super::*;

    /// Initialize the singleton config. Callable exactly once per program.
    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        rights_operator: Pubkey,
    ) -> Result<()> {
        require!(rights_operator != Pubkey::default(), RightsError::ZeroAddress);
        let config = &mut ctx.accounts.config;
        config.admin = ctx.accounts.admin.key();
        config.pending_admin = Pubkey::default();
        config.rights_operator = rights_operator;
        config.pending_rights_operator = Pubkey::default();
        config.paused = false;
        config.bump = ctx.bumps.config;
        emit!(ConfigInitialized {
            admin: config.admin,
            rights_operator,
        });
        Ok(())
    }

    /// Write a rights classification for `content_hash`, attesting that the
    /// platform's canonical EVM RightsRegistry has this content recorded as
    /// `rights_type` at the time of attestation.
    ///
    /// Mirrors `RightsRegistry.setRights`/`setRightsWithCreatorSig` /
    /// `confirmFreeze` / `emergencyFreeze` / `unfreeze` — the operator picks
    /// the resulting RightsType and the program records it without
    /// re-validating the creator signature (validation already happened on
    /// EVM; this is a cache write).
    ///
    /// Idempotency: `version` must be strictly greater than any prior
    /// version recorded for this content_hash. The server is responsible for
    /// emitting monotonic versions per content_hash (typically the EVM
    /// block.number * MAX_LOG_INDEX + log_index, or any monotonic counter).
    pub fn set_rights_via_attestation(
        ctx: Context<SetRightsViaAttestation>,
        content_hash: [u8; 32],
        rights_type: RightsType,
        creator: Pubkey,
        evm_creator: [u8; 20],
        version: u64,
        evm_tx_hash: [u8; 32],
        evm_block_number: u64,
    ) -> Result<()> {
        require!(!ctx.accounts.config.paused, RightsError::Paused);
        require!(content_hash != [0u8; 32], RightsError::ZeroHash);

        let rights = &mut ctx.accounts.rights;

        if rights.version != 0 {
            // Existing record — must be strictly newer.
            require!(version > rights.version, RightsError::VersionNotMonotonic);
        } else {
            // First attestation for this content_hash.
            require!(version > 0, RightsError::ZeroVersion);
            rights.content_hash = content_hash;
            rights.bump = ctx.bumps.rights;
        }

        rights.rights_type = rights_type;
        rights.creator = creator;
        rights.evm_creator = evm_creator;
        rights.version = version;
        rights.evm_tx_hash = evm_tx_hash;
        rights.evm_block_number = evm_block_number;
        rights.last_attested_slot = Clock::get()?.slot;

        emit!(RightsSetViaAttestation {
            content_hash,
            rights_type,
            creator,
            evm_creator,
            version,
            evm_tx_hash,
            evm_block_number,
        });
        Ok(())
    }

    // ─── Admin: pause ─────────────────────────────────────────────────────

    pub fn pause(ctx: Context<AdminOnly>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(!config.paused, RightsError::AlreadyPaused);
        config.paused = true;
        emit!(Paused {});
        Ok(())
    }

    pub fn unpause(ctx: Context<AdminOnly>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(config.paused, RightsError::NotPaused);
        config.paused = false;
        emit!(Unpaused {});
        Ok(())
    }

    // ─── Admin: two-step admin transfer ───────────────────────────────────

    /// Step 1 of admin transfer — current admin proposes the new admin.
    pub fn transfer_admin(ctx: Context<AdminOnly>, new_admin: Pubkey) -> Result<()> {
        require!(new_admin != Pubkey::default(), RightsError::ZeroAddress);
        ctx.accounts.config.pending_admin = new_admin;
        emit!(AdminTransferProposed { new_admin });
        Ok(())
    }

    /// Step 2 of admin transfer — pending admin accepts. Atomic flip.
    pub fn accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(
            config.pending_admin == ctx.accounts.new_admin.key(),
            RightsError::Unauthorized
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

    // ─── Admin: two-step rights-operator rotation ─────────────────────────
    //
    // Separate from admin transfer so that compromise of the operator key
    // doesn't require an admin rotation, and vice versa.

    pub fn transfer_rights_operator(
        ctx: Context<AdminOnly>,
        new_operator: Pubkey,
    ) -> Result<()> {
        require!(new_operator != Pubkey::default(), RightsError::ZeroAddress);
        ctx.accounts.config.pending_rights_operator = new_operator;
        emit!(RightsOperatorTransferProposed { new_operator });
        Ok(())
    }

    pub fn accept_rights_operator(ctx: Context<AcceptRightsOperator>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(
            config.pending_rights_operator == ctx.accounts.new_operator.key(),
            RightsError::Unauthorized
        );
        let old = config.rights_operator;
        config.rights_operator = config.pending_rights_operator;
        config.pending_rights_operator = Pubkey::default();
        emit!(RightsOperatorTransferred {
            old_operator: old,
            new_operator: config.rights_operator,
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
pub struct SetRightsViaAttestation<'info> {
    /// The platform's rights operator — only key allowed to write rights.
    /// Constrained against `config.rights_operator` so a wrong signer fails
    /// loudly instead of silently writing cache state.
    #[account(
        mut,
        address = config.rights_operator @ RightsError::Unauthorized,
    )]
    pub operator: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    /// Rights cache PDA. Unique per content_hash via the seed; `init_if_needed`
    /// is safe because the seed uniqueness prevents re-init attacks.
    #[account(
        init_if_needed,
        payer = operator,
        space = 8 + Rights::INIT_SPACE,
        seeds = [RIGHTS_SEED, content_hash.as_ref()],
        bump
    )]
    pub rights: Account<'info, Rights>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    #[account(address = config.admin @ RightsError::Unauthorized)]
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

#[derive(Accounts)]
pub struct AcceptRightsOperator<'info> {
    pub new_operator: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
}

// ─── State ───────────────────────────────────────────────────────────────────

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub pending_admin: Pubkey,
    pub rights_operator: Pubkey,
    pub pending_rights_operator: Pubkey,
    pub paused: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Rights {
    pub content_hash: [u8; 32],
    pub rights_type: RightsType,
    /// Solana creator pubkey if the content originates on Solana, else
    /// Pubkey::default(). Used by Solana-native monetization programs to
    /// route payouts when the creator's primary wallet is Solana.
    pub creator: Pubkey,
    /// 20-byte EVM address from the canonical RightsRegistry.contentCreator
    /// mapping. Always populated — this is the cross-chain provenance link.
    pub evm_creator: [u8; 20],
    /// Strictly monotonic per content_hash. Older attestations are rejected.
    pub version: u64,
    /// EVM tx hash that emitted the canonical RightsSet event for forensics.
    pub evm_tx_hash: [u8; 32],
    /// EVM block number for forensics.
    pub evm_block_number: u64,
    /// Solana slot when this attestation landed.
    pub last_attested_slot: u64,
    pub bump: u8,
}

impl Rights {
    /// Default-deny: only ORIGINAL, LICENSED, and PUBLIC_DOMAIN are monetizable.
    /// UNSET, FUN, and FROZEN are blocked — matches EVM `isMonetizable` semantics.
    pub fn is_monetizable(&self) -> bool {
        matches!(
            self.rights_type,
            RightsType::Original | RightsType::Licensed | RightsType::PublicDomain
        )
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum RightsType {
    Unset,
    Fun,
    Original,
    Licensed,
    PublicDomain,
    Frozen,
}

// ─── Events ──────────────────────────────────────────────────────────────────

#[event]
pub struct ConfigInitialized {
    pub admin: Pubkey,
    pub rights_operator: Pubkey,
}

#[event]
pub struct RightsSetViaAttestation {
    pub content_hash: [u8; 32],
    pub rights_type: RightsType,
    pub creator: Pubkey,
    pub evm_creator: [u8; 20],
    pub version: u64,
    pub evm_tx_hash: [u8; 32],
    pub evm_block_number: u64,
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

#[event]
pub struct RightsOperatorTransferProposed {
    pub new_operator: Pubkey,
}

#[event]
pub struct RightsOperatorTransferred {
    pub old_operator: Pubkey,
    pub new_operator: Pubkey,
}

// ─── Errors ──────────────────────────────────────────────────────────────────

#[error_code]
pub enum RightsError {
    #[msg("Only the configured admin or rights_operator may perform this action")]
    Unauthorized,
    #[msg("Content hash cannot be all zeros")]
    ZeroHash,
    #[msg("Version must be strictly greater than any prior attestation for this content")]
    VersionNotMonotonic,
    #[msg("Initial attestation must have version > 0")]
    ZeroVersion,
    #[msg("Program is paused")]
    Paused,
    #[msg("Cannot pause: already paused")]
    AlreadyPaused,
    #[msg("Cannot unpause: not paused")]
    NotPaused,
    #[msg("Address cannot be the zero pubkey")]
    ZeroAddress,
}
