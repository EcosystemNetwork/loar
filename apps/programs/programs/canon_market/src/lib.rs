//! LOAR CanonMarketplace — universe-token-weighted voting on canon proposals.
//!
//! Sister to `apps/contracts/src/revenue/CanonMarketplace.sol`. The community
//! of a universe's token holders votes on which content gets canonized.
//!
//! v1 flow:
//!   1. `submit(universe, content_hash, episode_record)` — pays submission
//!      fee in SOL, opens a voting window of `voting_period_secs` seconds.
//!   2. `vote(submission, support, amount)` — voter locks `amount` universe
//!      tokens into a per-voter VoteLock PDA. Lock-during-voting replaces
//!      EVM's snapshot model (CANON-03 alternative).
//!   3. `finalize(submission)` — permissionless after deadline:
//!         - for ≥ quorum AND for > against → Accepted
//!         - against ≥ quorum AND against ≥ for → Rejected
//!         - else → Expired (quorum not met)
//!   4. `claim_vote_lock(submission)` — voter retrieves locked tokens after
//!      finalize. Pull pattern.
//!   5. `claim_submission_refund(submission)` — submitter retrieves fee
//!      ONLY when state = Expired (CANON-04 analog). Accepted and Rejected
//!      both keep the fee in the treasury (CANON-06 anti-spam rationale).
//!
//! Audit-relevant invariants (parallels EVM after CANON-* fixes):
//! - Voting token mint is sourced from `bonding_curve::Curve.token_mint` for
//!   the universe — caller can't pass a sockpuppet mint (CANON-01 analog).
//! - Vote tokens are locked into a vault for the duration of the voting
//!   window — flash-loaned tokens cannot vote and immediately return,
//!   because the program holds the tokens until finalize (CANON-03 analog).
//! - All vote tallies use checked u128 math; SPL transfers use
//!   `transfer_checked` (mint+decimals integrity).
//! - Finalize transitions are one-way; can't re-finalize.
//! - Fee refund only on Expired — Accepted/Rejected both keep fee
//!   (anti-spam, CANON-06 analog).
//! - `paused` blocks new submissions + new votes; finalize + refunds always
//!   accessible so the program can't strand funds while paused.

use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{
    self, Mint, TokenAccount, TokenInterface, TransferChecked,
};
use bonding_curve::Curve;
use universe::Universe;

declare_id!("2T6WzMCrSRLzUp6zwPhWPuguk84pDqozs6VwrykTR25u");

pub const BPS_DENOM: u64 = 10_000;
pub const MAX_QUORUM_BPS: u16 = 10_000; // up to 100% of curve supply
pub const MIN_VOTING_PERIOD_SECS: i64 = 60 * 60; // 1h min
pub const MAX_VOTING_PERIOD_SECS: i64 = 30 * 24 * 60 * 60; // 30d max

pub const CONFIG_SEED: &[u8] = b"canon_config";
pub const SUBMISSION_SEED: &[u8] = b"canon_submission";
pub const VOTE_LOCK_SEED: &[u8] = b"canon_vote_lock";
pub const VOTE_VAULT_SEED: &[u8] = b"canon_vote_vault";

#[program]
pub mod canon_market {
    use super::*;

    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        treasury: Pubkey,
        submission_fee_lamports: u64,
        voting_period_secs: i64,
        quorum_bps: u16,
    ) -> Result<()> {
        require!(treasury != Pubkey::default(), CanonError::ZeroAddress);
        require!(
            voting_period_secs >= MIN_VOTING_PERIOD_SECS
                && voting_period_secs <= MAX_VOTING_PERIOD_SECS,
            CanonError::InvalidVotingPeriod
        );
        require!(quorum_bps > 0 && quorum_bps <= MAX_QUORUM_BPS, CanonError::InvalidQuorum);

        let config = &mut ctx.accounts.config;
        config.admin = ctx.accounts.admin.key();
        config.pending_admin = Pubkey::default();
        config.treasury = treasury;
        config.submission_fee_lamports = submission_fee_lamports;
        config.voting_period_secs = voting_period_secs;
        config.quorum_bps = quorum_bps;
        config.next_submission_id = 1;
        config.paused = false;
        config.bump = ctx.bumps.config;
        emit!(ConfigInitialized {
            admin: config.admin,
            treasury,
            submission_fee_lamports,
            voting_period_secs,
            quorum_bps,
        });
        Ok(())
    }

    /// Submit a canon proposal for `content_hash` in `universe`. Pays
    /// `submission_fee_lamports` SOL to the program's treasury vault.
    pub fn submit(
        ctx: Context<Submit>,
        content_hash: [u8; 32],
        episode_record: Pubkey,
    ) -> Result<()> {
        require!(!ctx.accounts.config.paused, CanonError::Paused);
        require!(content_hash != [0u8; 32], CanonError::ZeroHash);

        let curve = &ctx.accounts.curve;
        require!(
            curve.universe == ctx.accounts.universe_account.key(),
            CanonError::UniverseMismatch
        );

        let now = Clock::get()?.unix_timestamp;
        let config = &mut ctx.accounts.config;
        let submission_id = config.next_submission_id;
        config.next_submission_id = config
            .next_submission_id
            .checked_add(1)
            .ok_or(CanonError::MathOverflow)?;

        // Move submission fee to treasury wallet (configured as a System
        // account — we don't escrow it in a program-owned vault since refunds
        // come from the submitter's balance, not the treasury, on Expired.
        // For the Expired refund path we hold the fee in a per-submission
        // SOL escrow PDA instead.
        let fee = config.submission_fee_lamports;
        if fee > 0 {
            system_program::transfer(
                CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    system_program::Transfer {
                        from: ctx.accounts.submitter.to_account_info(),
                        to: ctx.accounts.submission.to_account_info(),
                    },
                ),
                fee,
            )?;
        }

        let submission = &mut ctx.accounts.submission;
        submission.id = submission_id;
        submission.universe = ctx.accounts.universe_account.key();
        submission.token_mint = curve.token_mint;
        submission.submitter = ctx.accounts.submitter.key();
        submission.content_hash = content_hash;
        submission.episode_record = episode_record;
        submission.submission_fee = fee;
        submission.submitted_at = now;
        submission.deadline = now.saturating_add(config.voting_period_secs);
        // Quorum = quorum_bps of curve.total_curve_supply at submission time
        // (snapshot of the cap, not snapshot of votes — votes use lock model).
        submission.quorum_threshold = (curve.total_curve_supply as u128)
            .checked_mul(config.quorum_bps as u128)
            .ok_or(CanonError::MathOverflow)?
            .checked_div(BPS_DENOM as u128)
            .ok_or(CanonError::MathOverflow)? as u64;
        submission.votes_for = 0;
        submission.votes_against = 0;
        submission.state = SubmissionState::Active;
        submission.bump = ctx.bumps.submission;
        submission.vote_vault_bump = ctx.bumps.vote_vault;

        emit!(SubmissionCreated {
            id: submission_id,
            universe: submission.universe,
            content_hash,
            episode_record,
            submitter: submission.submitter,
            deadline: submission.deadline,
            quorum_threshold: submission.quorum_threshold,
        });
        Ok(())
    }

    /// Vote on a submission. Locks `amount` of universe tokens into the
    /// per-voter VoteLock PDA + the per-submission token vault. Votes can
    /// be added (same direction) but NOT switched — calling vote() again
    /// with opposite direction reverts.
    pub fn vote(
        ctx: Context<Vote>,
        support: bool,
        amount: u64,
    ) -> Result<()> {
        require!(!ctx.accounts.config.paused, CanonError::Paused);
        require!(amount > 0, CanonError::ZeroAmount);
        let now = Clock::get()?.unix_timestamp;
        let submission = &ctx.accounts.submission;
        require!(submission.state == SubmissionState::Active, CanonError::NotActive);
        require!(now < submission.deadline, CanonError::VotingEnded);

        // Lock tokens: voter ATA → submission vote vault. Voter signs.
        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.voter_token_ata.to_account_info(),
                    mint: ctx.accounts.token_mint.to_account_info(),
                    to: ctx.accounts.vote_vault.to_account_info(),
                    authority: ctx.accounts.voter.to_account_info(),
                },
            ),
            amount,
            ctx.accounts.token_mint.decimals,
        )?;

        let vote_lock = &mut ctx.accounts.vote_lock;
        if vote_lock.voter == Pubkey::default() {
            vote_lock.voter = ctx.accounts.voter.key();
            vote_lock.submission = submission.key();
            vote_lock.support = support;
            vote_lock.bump = ctx.bumps.vote_lock;
        } else {
            // Adding to an existing lock — direction must match.
            require!(vote_lock.support == support, CanonError::DirectionConflict);
        }
        vote_lock.amount = vote_lock
            .amount
            .checked_add(amount)
            .ok_or(CanonError::MathOverflow)?;
        vote_lock.claimed = false;

        let submission = &mut ctx.accounts.submission;
        if support {
            submission.votes_for = submission
                .votes_for
                .checked_add(amount)
                .ok_or(CanonError::MathOverflow)?;
        } else {
            submission.votes_against = submission
                .votes_against
                .checked_add(amount)
                .ok_or(CanonError::MathOverflow)?;
        }

        emit!(Voted {
            submission_id: submission.id,
            voter: vote_lock.voter,
            support,
            amount,
            new_for: submission.votes_for,
            new_against: submission.votes_against,
        });
        Ok(())
    }

    /// Finalize a submission after its deadline. Permissionless. Transitions
    /// state to Accepted / Rejected / Expired based on tallies.
    pub fn finalize(ctx: Context<Finalize>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let submission = &mut ctx.accounts.submission;
        require!(submission.state == SubmissionState::Active, CanonError::NotActive);
        require!(now >= submission.deadline, CanonError::VotingNotEnded);

        let total = submission
            .votes_for
            .checked_add(submission.votes_against)
            .ok_or(CanonError::MathOverflow)?;
        let new_state = if total < submission.quorum_threshold {
            SubmissionState::Expired
        } else if submission.votes_for > submission.votes_against {
            SubmissionState::Accepted
        } else {
            SubmissionState::Rejected
        };

        // Capture fields needed for the event + lamport move before we drop
        // the &mut borrow on `submission` — the lamport manipulation needs an
        // immutable AccountInfo on the same account, and Rust's borrow checker
        // won't let an `&mut Account` and an `AccountInfo` coexist within the
        // same instruction's writes. (This is a write-order concern within
        // this instruction, NOT cross-instruction reentrancy — Solana does
        // not have cross-instruction reentrancy in the EVM sense.)
        let fee_to_forward = if new_state != SubmissionState::Expired {
            submission.submission_fee
        } else {
            0
        };
        let event = SubmissionFinalized {
            id: submission.id,
            universe: submission.universe,
            content_hash: submission.content_hash,
            episode_record: submission.episode_record,
            state: new_state,
            votes_for: submission.votes_for,
            votes_against: submission.votes_against,
        };
        submission.state = new_state;
        submission.finalized_at = now;
        if fee_to_forward > 0 {
            // Zero the fee field BEFORE the lamport move so refund path can't
            // double-spend even if the lamport CPI somehow re-enters.
            submission.submission_fee = 0;
        }

        // Fee disposition: only Expired refunds; Accepted/Rejected forward
        // the fee to treasury (anti-spam, CANON-06 analog).
        //
        // M-5: proactive rent cap. Cap the withdrawal so the residual is
        // always at least rent-exempt minimum. The previous version relied
        // on a reactive `RentExemptionViolated` assertion AFTER the move,
        // which is correct but harder to audit (the panic fires from a
        // place that's already mutated state). Clamping `actual_fee` makes
        // the invariant impossible to violate; we keep the reactive assert
        // below as defense-in-depth in case a future refactor changes the
        // rent calculation.
        if fee_to_forward > 0 {
            let submission_info = ctx.accounts.submission.to_account_info();
            let treasury_info = ctx.accounts.treasury.to_account_info();
            let rent_min = Rent::get()?.minimum_balance(submission_info.data_len());

            let mut sub_lamports = submission_info.try_borrow_mut_lamports()?;
            let available = (**sub_lamports).saturating_sub(rent_min);
            let actual_fee = fee_to_forward.min(available);
            // Restore the fee-tracking field if we clamped — otherwise the
            // submitter would lose the unforwarded portion silently.
            // (`submission.submission_fee` was already zeroed above; we set
            // it to the unforwarded remainder so any future operator audit
            // can see what's stuck in the PDA.)
            // NOTE: this state write happens AFTER we drop the lamport
            // borrow, below.
            require!(**sub_lamports >= actual_fee, CanonError::EscrowUnderfunded);
            **sub_lamports = sub_lamports
                .checked_sub(actual_fee)
                .ok_or(CanonError::MathOverflow)?;
            drop(sub_lamports);

            if actual_fee < fee_to_forward {
                // Re-borrow the submission to record the clamped remainder.
                ctx.accounts.submission.submission_fee =
                    fee_to_forward.saturating_sub(actual_fee);
                msg!(
                    "canon_market: fee clamp engaged; intended={} actual={} stranded={}",
                    fee_to_forward,
                    actual_fee,
                    fee_to_forward - actual_fee
                );
            }

            if actual_fee > 0 {
                let mut treas_lamports = treasury_info.try_borrow_mut_lamports()?;
                **treas_lamports = treas_lamports
                    .checked_add(actual_fee)
                    .ok_or(CanonError::MathOverflow)?;
                drop(treas_lamports);
            }

            // Defense-in-depth: assert the post-withdrawal balance is still
            // rent-exempt. With the proactive clamp above this should be
            // unreachable, but it pins the invariant for future refactors.
            require!(
                **ctx.accounts.submission.to_account_info().lamports.borrow() >= rent_min,
                CanonError::RentExemptionViolated
            );
        }

        emit!(event);
        Ok(())
    }

    /// Voter claims their locked tokens after finalize. Available regardless
    /// of which terminal state was reached.
    pub fn claim_vote_lock(ctx: Context<ClaimVoteLock>) -> Result<()> {
        let submission = &ctx.accounts.submission;
        require!(
            submission.state != SubmissionState::Active,
            CanonError::NotFinalized
        );

        let lock = &mut ctx.accounts.vote_lock;
        require!(!lock.claimed, CanonError::AlreadyClaimed);
        let amount = lock.amount;
        require!(amount > 0, CanonError::ZeroAmount);

        // Vote vault PDA signs via seeds.
        let submission_key = submission.key();
        let vault_bump = submission.vote_vault_bump;
        let seeds: &[&[u8]] = &[VOTE_VAULT_SEED, submission_key.as_ref(), &[vault_bump]];
        let signer_seeds: &[&[&[u8]]] = &[seeds];

        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.vote_vault.to_account_info(),
                    mint: ctx.accounts.token_mint.to_account_info(),
                    to: ctx.accounts.voter_token_ata.to_account_info(),
                    authority: ctx.accounts.vote_vault_authority.to_account_info(),
                },
                signer_seeds,
            ),
            amount,
            ctx.accounts.token_mint.decimals,
        )?;

        lock.claimed = true;
        lock.amount = 0;
        emit!(VoteLockClaimed {
            submission_id: submission.id,
            voter: lock.voter,
            amount,
        });
        Ok(())
    }

    /// Submitter claims their submission-fee refund — only on Expired state.
    pub fn claim_submission_refund(ctx: Context<ClaimSubmissionRefund>) -> Result<()> {
        let submission = &mut ctx.accounts.submission;
        require!(
            submission.state == SubmissionState::Expired,
            CanonError::RefundNotAvailable
        );
        require!(
            submission.submitter == ctx.accounts.submitter.key(),
            CanonError::NotSubmitter
        );
        let amount = submission.submission_fee;
        require!(amount > 0, CanonError::AlreadyClaimed);

        let submission_info = submission.to_account_info();
        let submitter_info = ctx.accounts.submitter.to_account_info();
        let mut sub_lamports = submission_info.try_borrow_mut_lamports()?;
        require!(**sub_lamports >= amount, CanonError::EscrowUnderfunded);
        **sub_lamports = sub_lamports
            .checked_sub(amount)
            .ok_or(CanonError::MathOverflow)?;
        drop(sub_lamports);
        let mut sm_lamports = submitter_info.try_borrow_mut_lamports()?;
        **sm_lamports = sm_lamports
            .checked_add(amount)
            .ok_or(CanonError::MathOverflow)?;
        drop(sm_lamports);

        submission.submission_fee = 0;
        emit!(SubmissionRefunded {
            id: submission.id,
            submitter: submission.submitter,
            amount,
        });
        Ok(())
    }

    // ─── Admin ────────────────────────────────────────────────────────────

    pub fn set_params(
        ctx: Context<AdminOnly>,
        submission_fee_lamports: u64,
        voting_period_secs: i64,
        quorum_bps: u16,
    ) -> Result<()> {
        require!(
            voting_period_secs >= MIN_VOTING_PERIOD_SECS
                && voting_period_secs <= MAX_VOTING_PERIOD_SECS,
            CanonError::InvalidVotingPeriod
        );
        require!(quorum_bps > 0 && quorum_bps <= MAX_QUORUM_BPS, CanonError::InvalidQuorum);
        let config = &mut ctx.accounts.config;
        config.submission_fee_lamports = submission_fee_lamports;
        config.voting_period_secs = voting_period_secs;
        config.quorum_bps = quorum_bps;
        emit!(ParamsUpdated {
            submission_fee_lamports,
            voting_period_secs,
            quorum_bps,
        });
        Ok(())
    }

    pub fn pause(ctx: Context<AdminOnly>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(!config.paused, CanonError::AlreadyPaused);
        config.paused = true;
        emit!(Paused {});
        Ok(())
    }

    pub fn unpause(ctx: Context<AdminOnly>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(config.paused, CanonError::NotPaused);
        config.paused = false;
        emit!(Unpaused {});
        Ok(())
    }

    pub fn transfer_admin(ctx: Context<AdminOnly>, new_admin: Pubkey) -> Result<()> {
        require!(new_admin != Pubkey::default(), CanonError::ZeroAddress);
        ctx.accounts.config.pending_admin = new_admin;
        emit!(AdminTransferProposed { new_admin });
        Ok(())
    }

    pub fn accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(
            config.pending_admin == ctx.accounts.new_admin.key(),
            CanonError::Unauthorized
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
#[instruction(content_hash: [u8; 32])]
pub struct Submit<'info> {
    #[account(mut)]
    pub submitter: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    pub universe_account: Account<'info, Universe>,
    /// The bonding-curve PDA for this universe. We source the canonical
    /// voting-token mint from here — caller can't pass a sockpuppet.
    #[account(
        constraint = curve.universe == universe_account.key() @ CanonError::UniverseMismatch,
    )]
    pub curve: Account<'info, Curve>,
    #[account(
        init,
        payer = submitter,
        space = 8 + Submission::INIT_SPACE,
        seeds = [SUBMISSION_SEED, universe_account.key().as_ref(), content_hash.as_ref()],
        bump,
    )]
    pub submission: Account<'info, Submission>,
    /// CHECK: PDA authority for the vote vault ATA. Initialized lazily on
    /// the first vote — we just derive its address here so the bump can be
    /// stored on the submission.
    #[account(
        seeds = [VOTE_VAULT_SEED, submission.key().as_ref()],
        bump,
    )]
    pub vote_vault: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Vote<'info> {
    #[account(mut)]
    pub voter: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [
            SUBMISSION_SEED,
            submission.universe.as_ref(),
            submission.content_hash.as_ref(),
        ],
        bump = submission.bump,
    )]
    pub submission: Account<'info, Submission>,
    #[account(address = submission.token_mint @ CanonError::MintMismatch)]
    pub token_mint: InterfaceAccount<'info, Mint>,
    /// CHECK: vote vault authority, seed-derived.
    #[account(
        seeds = [VOTE_VAULT_SEED, submission.key().as_ref()],
        bump = submission.vote_vault_bump,
    )]
    pub vote_vault_authority: UncheckedAccount<'info>,
    /// Vote vault ATA: holds locked tokens for this submission. Lazy-init
    /// on first vote.
    #[account(
        init_if_needed,
        payer = voter,
        associated_token::mint = token_mint,
        associated_token::authority = vote_vault_authority,
    )]
    pub vote_vault: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = voter,
    )]
    pub voter_token_ata: InterfaceAccount<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = voter,
        space = 8 + VoteLock::INIT_SPACE,
        seeds = [VOTE_LOCK_SEED, submission.key().as_ref(), voter.key().as_ref()],
        bump,
    )]
    pub vote_lock: Account<'info, VoteLock>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Finalize<'info> {
    #[account(
        mut,
        seeds = [
            SUBMISSION_SEED,
            submission.universe.as_ref(),
            submission.content_hash.as_ref(),
        ],
        bump = submission.bump,
    )]
    pub submission: Account<'info, Submission>,
    /// CHECK: Treasury — receives the fee on Accepted/Rejected. Validated
    /// against `config.treasury` via the address constraint.
    #[account(mut, address = config.treasury @ CanonError::TreasuryMismatch)]
    pub treasury: AccountInfo<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
}

#[derive(Accounts)]
pub struct ClaimVoteLock<'info> {
    #[account(mut)]
    pub voter: Signer<'info>,
    #[account(
        seeds = [
            SUBMISSION_SEED,
            submission.universe.as_ref(),
            submission.content_hash.as_ref(),
        ],
        bump = submission.bump,
    )]
    pub submission: Account<'info, Submission>,
    #[account(address = submission.token_mint @ CanonError::MintMismatch)]
    pub token_mint: InterfaceAccount<'info, Mint>,
    /// CHECK: seed-derived
    #[account(
        seeds = [VOTE_VAULT_SEED, submission.key().as_ref()],
        bump = submission.vote_vault_bump,
    )]
    pub vote_vault_authority: UncheckedAccount<'info>,
    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = vote_vault_authority,
    )]
    pub vote_vault: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = voter,
    )]
    pub voter_token_ata: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [VOTE_LOCK_SEED, submission.key().as_ref(), voter.key().as_ref()],
        bump = vote_lock.bump,
        constraint = vote_lock.voter == voter.key() @ CanonError::Unauthorized,
    )]
    pub vote_lock: Account<'info, VoteLock>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct ClaimSubmissionRefund<'info> {
    #[account(mut)]
    pub submitter: Signer<'info>,
    #[account(
        mut,
        seeds = [
            SUBMISSION_SEED,
            submission.universe.as_ref(),
            submission.content_hash.as_ref(),
        ],
        bump = submission.bump,
    )]
    pub submission: Account<'info, Submission>,
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    #[account(address = config.admin @ CanonError::Unauthorized)]
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
    pub treasury: Pubkey,
    pub submission_fee_lamports: u64,
    pub voting_period_secs: i64,
    pub quorum_bps: u16,
    pub next_submission_id: u64,
    pub paused: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Submission {
    pub id: u64,
    pub universe: Pubkey,
    pub token_mint: Pubkey,
    pub submitter: Pubkey,
    pub content_hash: [u8; 32],
    pub episode_record: Pubkey,
    pub submission_fee: u64,
    pub submitted_at: i64,
    pub deadline: i64,
    pub finalized_at: i64,
    pub quorum_threshold: u64,
    pub votes_for: u64,
    pub votes_against: u64,
    pub state: SubmissionState,
    pub bump: u8,
    pub vote_vault_bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum SubmissionState {
    Active,
    Accepted,
    Rejected,
    Expired,
}

#[account]
#[derive(InitSpace)]
pub struct VoteLock {
    pub voter: Pubkey,
    pub submission: Pubkey,
    pub amount: u64,
    pub support: bool,
    pub claimed: bool,
    pub bump: u8,
}

// ─── Events ──────────────────────────────────────────────────────────────────

#[event]
pub struct ConfigInitialized {
    pub admin: Pubkey,
    pub treasury: Pubkey,
    pub submission_fee_lamports: u64,
    pub voting_period_secs: i64,
    pub quorum_bps: u16,
}

#[event]
pub struct ParamsUpdated {
    pub submission_fee_lamports: u64,
    pub voting_period_secs: i64,
    pub quorum_bps: u16,
}

#[event]
pub struct SubmissionCreated {
    pub id: u64,
    pub universe: Pubkey,
    pub content_hash: [u8; 32],
    pub episode_record: Pubkey,
    pub submitter: Pubkey,
    pub deadline: i64,
    pub quorum_threshold: u64,
}

#[event]
pub struct Voted {
    pub submission_id: u64,
    pub voter: Pubkey,
    pub support: bool,
    pub amount: u64,
    pub new_for: u64,
    pub new_against: u64,
}

#[event]
pub struct SubmissionFinalized {
    pub id: u64,
    pub universe: Pubkey,
    pub content_hash: [u8; 32],
    pub episode_record: Pubkey,
    pub state: SubmissionState,
    pub votes_for: u64,
    pub votes_against: u64,
}

#[event]
pub struct VoteLockClaimed {
    pub submission_id: u64,
    pub voter: Pubkey,
    pub amount: u64,
}

#[event]
pub struct SubmissionRefunded {
    pub id: u64,
    pub submitter: Pubkey,
    pub amount: u64,
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
pub enum CanonError {
    #[msg("Only the configured admin or owner may perform this action")]
    Unauthorized,
    #[msg("Address cannot be the zero pubkey")]
    ZeroAddress,
    #[msg("Content hash cannot be all zeros")]
    ZeroHash,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("voting_period_secs out of [1h, 30d] range")]
    InvalidVotingPeriod,
    #[msg("quorum_bps must be in (0, 10000]")]
    InvalidQuorum,
    #[msg("Universe argument does not match supplied Universe account")]
    UniverseMismatch,
    #[msg("Provided token mint does not match Submission.token_mint")]
    MintMismatch,
    #[msg("Treasury account does not match Config.treasury")]
    TreasuryMismatch,
    #[msg("Submission is not active (already finalized or non-existent)")]
    NotActive,
    #[msg("Submission has not been finalized yet")]
    NotFinalized,
    #[msg("Voting period has ended")]
    VotingEnded,
    #[msg("Voting period has not ended yet")]
    VotingNotEnded,
    #[msg("Cannot switch vote direction — submit a separate vote first")]
    DirectionConflict,
    #[msg("Vote lock has already been claimed")]
    AlreadyClaimed,
    #[msg("Refund not available for the current submission state")]
    RefundNotAvailable,
    #[msg("Caller is not the submitter of this proposal")]
    NotSubmitter,
    #[msg("Submission escrow underfunded — should be impossible if state is consistent")]
    EscrowUnderfunded,
    #[msg("Post-withdrawal submission balance fell below rent-exempt minimum")]
    RentExemptionViolated,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("Program is paused")]
    Paused,
    #[msg("Cannot pause: already paused")]
    AlreadyPaused,
    #[msg("Cannot unpause: not paused")]
    NotPaused,
}
