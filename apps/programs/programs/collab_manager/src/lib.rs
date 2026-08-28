//! LOAR CollabManager — cross-universe collaborations ("collisions") on Solana.
//!
//! Sister to `apps/contracts/src/revenue/CollabManager.sol`. Two universes
//! can propose, accept, and run a joint collaboration with a revenue-share
//! split agreed at proposal time. Episode counts + total revenue accrue per
//! collab; actual revenue ROUTING is handled by `programs/payment` once
//! callers are wired (deferred to v2).
//!
//! v1 scope:
//! - propose_collab — universe A's creator
//! - accept_collab  — universe B's creator
//! - cancel_collab  — proposer (only while PROPOSED)
//! - activate_collab — either creator after acceptance (sets ACTIVE + times)
//! - complete_collab — either creator after end_time, or admin
//! - record_episode — platform-only; increments episode_count + revenue
//! - admin: pause + two-step transfer
//!
//! v1 deferrals:
//! - Revenue distribution CPI via `programs/payment` — needs explicit
//!   universe-creator payout wallets resolved at distribute time.
//! - Per-universe collab indexes (EVM has `universeCollabs[]`). Indexing
//!   from events is the Solana-idiomatic equivalent — handled off-chain.
//!
//! Audit-relevant invariants:
//! - Both universes' creators read live from Universe PDA (REVENUE-01 analog).
//! - State machine is strictly forward: PROPOSED → ACCEPTED → ACTIVE →
//!   COMPLETED; CANCELLED is terminal from PROPOSED only.
//! - revenue_share_bps capped at 10000 (sum of A + B always = 10000).
//! - All u64 math uses `checked_*` (except `record_episode.total_revenue`,
//!   which uses `saturating_add` per H-3 to keep the cap from bricking the
//!   collab if a compromised platform key pushes garbage values).
//!
//! BREAKING CHANGE (IDL, M-1): `CancelCollab` now carries the `config`
//! account so the `paused` gate can short-circuit. Pre-fix TS clients that
//! built `cancelCollab` without `.accountsPartial({ config: configPda, ... })`
//! will fail account resolution. There are no in-tree callers (the test in
//! `apps/programs/tests/collab_manager.ts` doesn't exercise cancel_collab),
//! but external integrators must regenerate their IDL.

use anchor_lang::prelude::*;
use universe::Universe;

declare_id!("6j9GBZXsdiGTJc7zJbJr3gJsibYQhJUDp2ZCDRBNzo2h");

pub const BPS_DENOM: u64 = 10_000;
pub const MAX_METADATA_URI_LEN: usize = 200;
pub const MIN_DURATION_SECS: i64 = 60 * 60; // 1h min
pub const MAX_DURATION_SECS: i64 = 365 * 24 * 60 * 60; // 1yr max
/// Sanity cap on a single `record_episode` revenue datum to prevent a
/// (potentially compromised) platform key from griefing the collab by
/// pushing `total_revenue` to `u64::MAX` and bricking subsequent calls
/// via `checked_add` revert. 1_000 SOL per episode is ample for any
/// realistic single-episode revenue.
///
/// Defense-in-depth: tightened from 1_000_000 SOL (H-3 fix). At
/// 1_000_000 SOL only ~18,400 maxed episodes were needed to overflow
/// u64; at 1_000 SOL we'd need ~18.4 billion. Pair this with the
/// `saturating_add` on `total_revenue` below so the cap can never brick
/// the collab — accumulation just halts past saturation.
pub const MAX_EPISODE_REVENUE_LAMPORTS: u64 = 1_000 * 1_000_000_000;

pub const CONFIG_SEED: &[u8] = b"collab_config";
pub const COLLAB_SEED: &[u8] = b"collab";

#[program]
pub mod collab_manager {
    use super::*;

    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        platform: Pubkey,
        platform_fee_bps: u16,
    ) -> Result<()> {
        require!(platform != Pubkey::default(), CollabError::ZeroAddress);
        require!(platform_fee_bps <= 5000, CollabError::FeeTooHigh);
        let config = &mut ctx.accounts.config;
        config.admin = ctx.accounts.admin.key();
        config.pending_admin = Pubkey::default();
        config.platform = platform;
        config.platform_fee_bps = platform_fee_bps;
        config.next_collab_id = 1;
        config.paused = false;
        config.bump = ctx.bumps.config;
        emit!(ConfigInitialized {
            admin: config.admin,
            platform,
            platform_fee_bps,
        });
        Ok(())
    }

    /// Universe A's creator proposes a collab with Universe B.
    /// `collab_id` is the auto-incrementing id from Config.next_collab_id;
    /// caller passes the expected id (read just before) for PDA derivation.
    pub fn propose_collab(
        ctx: Context<ProposeCollab>,
        collab_id: u64,
        revenue_share_bps: u16,
        duration_secs: i64,
        metadata_uri: String,
    ) -> Result<()> {
        require!(!ctx.accounts.config.paused, CollabError::Paused);
        require!(revenue_share_bps <= 10_000, CollabError::InvalidShare);
        require!(
            duration_secs >= MIN_DURATION_SECS && duration_secs <= MAX_DURATION_SECS,
            CollabError::InvalidDuration
        );
        require!(
            metadata_uri.len() <= MAX_METADATA_URI_LEN,
            CollabError::MetadataTooLong
        );
        require!(
            ctx.accounts.universe_a.creator == ctx.accounts.proposer.key(),
            CollabError::NotUniverseACreator
        );
        require!(
            ctx.accounts.universe_a.key() != ctx.accounts.universe_b.key(),
            CollabError::SameUniverse
        );

        let config = &mut ctx.accounts.config;
        require!(collab_id == config.next_collab_id, CollabError::IdMismatch);
        config.next_collab_id = config
            .next_collab_id
            .checked_add(1)
            .ok_or(CollabError::MathOverflow)?;

        let collab = &mut ctx.accounts.collab;
        collab.id = collab_id;
        collab.universe_a = ctx.accounts.universe_a.key();
        collab.universe_b = ctx.accounts.universe_b.key();
        collab.proposer = ctx.accounts.proposer.key();
        collab.acceptor = Pubkey::default();
        collab.revenue_share_a_bps = revenue_share_bps;
        collab.duration_secs = duration_secs;
        collab.metadata_uri = metadata_uri.clone();
        collab.total_revenue = 0;
        collab.episode_count = 0;
        collab.start_time = 0;
        collab.end_time = 0;
        collab.proposed_at = Clock::get()?.unix_timestamp;
        collab.status = CollabStatus::Proposed;
        collab.bump = ctx.bumps.collab;

        emit!(CollabProposed {
            id: collab_id,
            universe_a: collab.universe_a,
            universe_b: collab.universe_b,
            proposer: collab.proposer,
            revenue_share_a_bps: revenue_share_bps,
            duration_secs,
            metadata_uri,
        });
        Ok(())
    }

    /// Universe B's creator accepts. Stays in ACCEPTED until activated.
    pub fn accept_collab(ctx: Context<AcceptCollab>) -> Result<()> {
        require!(!ctx.accounts.config.paused, CollabError::Paused);
        require!(
            ctx.accounts.universe_b.creator == ctx.accounts.acceptor.key(),
            CollabError::NotUniverseBCreator
        );
        let collab = &mut ctx.accounts.collab;
        require!(
            collab.status == CollabStatus::Proposed,
            CollabError::InvalidStatus
        );
        require!(
            collab.universe_b == ctx.accounts.universe_b.key(),
            CollabError::UniverseMismatch
        );

        collab.acceptor = ctx.accounts.acceptor.key();
        collab.status = CollabStatus::Accepted;
        emit!(CollabAccepted {
            id: collab.id,
            acceptor: collab.acceptor,
        });
        Ok(())
    }

    /// Activate an accepted collab — either creator can fire. Sets start_time
    /// = now, end_time = now + duration_secs, status = Active.
    pub fn activate_collab(ctx: Context<ActivateOrCompleteCollab>) -> Result<()> {
        require!(!ctx.accounts.config.paused, CollabError::Paused);
        let signer = ctx.accounts.signer.key();
        let collab = &mut ctx.accounts.collab;
        require!(
            collab.status == CollabStatus::Accepted,
            CollabError::InvalidStatus
        );
        require!(
            signer == collab.proposer || signer == collab.acceptor,
            CollabError::NotParticipant
        );

        let now = Clock::get()?.unix_timestamp;
        collab.start_time = now;
        collab.end_time = now.saturating_add(collab.duration_secs);
        collab.status = CollabStatus::Active;
        emit!(CollabActivated {
            id: collab.id,
            start_time: collab.start_time,
            end_time: collab.end_time,
        });
        Ok(())
    }

    /// Mark complete — either participant after end_time, or admin anytime
    /// (e.g. early wind-down by mutual agreement off-chain).
    pub fn complete_collab(ctx: Context<ActivateOrCompleteCollab>) -> Result<()> {
        require!(!ctx.accounts.config.paused, CollabError::Paused);
        let signer = ctx.accounts.signer.key();
        let admin = ctx.accounts.config.admin;
        let collab = &mut ctx.accounts.collab;
        require!(
            collab.status == CollabStatus::Active,
            CollabError::InvalidStatus
        );
        let now = Clock::get()?.unix_timestamp;
        let is_participant = signer == collab.proposer || signer == collab.acceptor;
        let is_admin = signer == admin;
        // Participants can only complete AFTER end_time; admin can anytime.
        require!(
            is_admin || (is_participant && now >= collab.end_time),
            CollabError::CompletionNotReady
        );
        collab.status = CollabStatus::Completed;
        emit!(CollabCompleted {
            id: collab.id,
            total_revenue: collab.total_revenue,
            episode_count: collab.episode_count,
        });
        Ok(())
    }

    /// Cancel — proposer only, only while PROPOSED.
    pub fn cancel_collab(ctx: Context<CancelCollab>) -> Result<()> {
        require!(!ctx.accounts.config.paused, CollabError::Paused);
        let collab = &mut ctx.accounts.collab;
        require!(
            collab.status == CollabStatus::Proposed,
            CollabError::InvalidStatus
        );
        require!(
            collab.proposer == ctx.accounts.signer.key(),
            CollabError::NotProposer
        );
        collab.status = CollabStatus::Cancelled;
        emit!(CollabCancelled { id: collab.id });
        Ok(())
    }

    /// Platform records an episode + the revenue it generated. v1 just
    /// accrues totals; routing the revenue to creators is a v2 follow-up
    /// that CPIs into `programs/payment` once both creator payout wallets
    /// are wired through.
    pub fn record_episode(
        ctx: Context<RecordEpisode>,
        episode_revenue_lamports: u64,
    ) -> Result<()> {
        require!(!ctx.accounts.config.paused, CollabError::Paused);
        require!(
            ctx.accounts.platform.key() == ctx.accounts.config.platform,
            CollabError::NotPlatform
        );
        require!(
            episode_revenue_lamports <= MAX_EPISODE_REVENUE_LAMPORTS,
            CollabError::RevenueExceedsCap
        );
        let collab = &mut ctx.accounts.collab;
        require!(
            collab.status == CollabStatus::Active,
            CollabError::CollabNotActive
        );

        collab.episode_count = collab
            .episode_count
            .checked_add(1)
            .ok_or(CollabError::MathOverflow)?;
        // H-3: saturating_add so the per-episode cap can never brick the
        // collab — accumulation halts at u64::MAX (effectively unreachable
        // given the tightened MAX_EPISODE_REVENUE_LAMPORTS, but kept as
        // defense-in-depth) instead of reverting all subsequent record_episode
        // calls.
        collab.total_revenue = collab
            .total_revenue
            .saturating_add(episode_revenue_lamports);
        emit!(CollabEpisodeRecorded {
            id: collab.id,
            episode_count: collab.episode_count,
            episode_revenue_lamports,
            total_revenue: collab.total_revenue,
        });
        Ok(())
    }

    // ─── Admin ────────────────────────────────────────────────────────────

    pub fn pause(ctx: Context<AdminOnly>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(!config.paused, CollabError::AlreadyPaused);
        config.paused = true;
        emit!(Paused {});
        Ok(())
    }

    pub fn unpause(ctx: Context<AdminOnly>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(config.paused, CollabError::NotPaused);
        config.paused = false;
        emit!(Unpaused {});
        Ok(())
    }

    pub fn transfer_admin(ctx: Context<AdminOnly>, new_admin: Pubkey) -> Result<()> {
        require!(new_admin != Pubkey::default(), CollabError::ZeroAddress);
        ctx.accounts.config.pending_admin = new_admin;
        emit!(AdminTransferProposed { new_admin });
        Ok(())
    }

    pub fn accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(
            config.pending_admin == ctx.accounts.new_admin.key(),
            CollabError::Unauthorized
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
        bump,
    )]
    pub config: Account<'info, Config>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(collab_id: u64)]
pub struct ProposeCollab<'info> {
    #[account(mut)]
    pub proposer: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    pub universe_a: Account<'info, Universe>,
    pub universe_b: Account<'info, Universe>,
    #[account(
        init,
        payer = proposer,
        space = 8 + Collab::INIT_SPACE,
        seeds = [COLLAB_SEED, &collab_id.to_le_bytes()],
        bump,
    )]
    pub collab: Account<'info, Collab>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AcceptCollab<'info> {
    pub acceptor: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    pub universe_b: Account<'info, Universe>,
    #[account(
        mut,
        seeds = [COLLAB_SEED, &collab.id.to_le_bytes()],
        bump = collab.bump,
    )]
    pub collab: Account<'info, Collab>,
}

#[derive(Accounts)]
pub struct ActivateOrCompleteCollab<'info> {
    pub signer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [COLLAB_SEED, &collab.id.to_le_bytes()],
        bump = collab.bump,
    )]
    pub collab: Account<'info, Collab>,
}

#[derive(Accounts)]
pub struct CancelCollab<'info> {
    pub signer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [COLLAB_SEED, &collab.id.to_le_bytes()],
        bump = collab.bump,
    )]
    pub collab: Account<'info, Collab>,
}

#[derive(Accounts)]
pub struct RecordEpisode<'info> {
    pub platform: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [COLLAB_SEED, &collab.id.to_le_bytes()],
        bump = collab.bump,
    )]
    pub collab: Account<'info, Collab>,
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    #[account(address = config.admin @ CollabError::Unauthorized)]
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
    pub platform: Pubkey,
    pub platform_fee_bps: u16,
    pub next_collab_id: u64,
    pub paused: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Collab {
    pub id: u64,
    pub universe_a: Pubkey,
    pub universe_b: Pubkey,
    pub proposer: Pubkey,
    pub acceptor: Pubkey,
    pub revenue_share_a_bps: u16, // share for universe A's creator; B gets the rest
    pub duration_secs: i64,
    #[max_len(200)]
    pub metadata_uri: String,
    pub total_revenue: u64,
    pub episode_count: u64,
    pub proposed_at: i64,
    pub start_time: i64,
    pub end_time: i64,
    pub status: CollabStatus,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum CollabStatus {
    Proposed,
    Accepted,
    Active,
    Completed,
    Cancelled,
}

// ─── Events ──────────────────────────────────────────────────────────────────

#[event]
pub struct ConfigInitialized {
    pub admin: Pubkey,
    pub platform: Pubkey,
    pub platform_fee_bps: u16,
}

#[event]
pub struct CollabProposed {
    pub id: u64,
    pub universe_a: Pubkey,
    pub universe_b: Pubkey,
    pub proposer: Pubkey,
    pub revenue_share_a_bps: u16,
    pub duration_secs: i64,
    pub metadata_uri: String,
}

#[event]
pub struct CollabAccepted {
    pub id: u64,
    pub acceptor: Pubkey,
}

#[event]
pub struct CollabActivated {
    pub id: u64,
    pub start_time: i64,
    pub end_time: i64,
}

#[event]
pub struct CollabCompleted {
    pub id: u64,
    pub total_revenue: u64,
    pub episode_count: u64,
}

#[event]
pub struct CollabCancelled {
    pub id: u64,
}

#[event]
pub struct CollabEpisodeRecorded {
    pub id: u64,
    pub episode_count: u64,
    pub episode_revenue_lamports: u64,
    pub total_revenue: u64,
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
pub enum CollabError {
    #[msg("Only the configured admin may perform this action")]
    Unauthorized,
    #[msg("Caller is not the proposer of this collab")]
    NotProposer,
    #[msg("Caller is not a participant (proposer or acceptor)")]
    NotParticipant,
    #[msg("Caller is not Universe A's creator")]
    NotUniverseACreator,
    #[msg("Caller is not Universe B's creator")]
    NotUniverseBCreator,
    #[msg("Only the configured platform key may perform this action")]
    NotPlatform,
    #[msg("Address cannot be the zero pubkey")]
    ZeroAddress,
    #[msg("Cannot collab a universe with itself")]
    SameUniverse,
    #[msg("Universe argument does not match supplied Universe account")]
    UniverseMismatch,
    #[msg("Collab status doesn't allow this action")]
    InvalidStatus,
    #[msg("Collab is not active")]
    CollabNotActive,
    #[msg("Cannot complete: end_time has not been reached (admin override available)")]
    CompletionNotReady,
    #[msg("revenue_share_a_bps must be in [0, 10000]")]
    InvalidShare,
    #[msg("duration_secs must be in [1h, 1yr]")]
    InvalidDuration,
    #[msg("Metadata URI exceeds 200 chars")]
    MetadataTooLong,
    #[msg("Platform fee exceeds 5000 bps (50%)")]
    FeeTooHigh,
    #[msg("collab_id arg does not match Config.next_collab_id")]
    IdMismatch,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("episode_revenue_lamports exceeds the per-episode sanity cap")]
    RevenueExceedsCap,
    #[msg("Program is paused")]
    Paused,
    #[msg("Cannot pause: already paused")]
    AlreadyPaused,
    #[msg("Cannot unpause: not paused")]
    NotPaused,
}
